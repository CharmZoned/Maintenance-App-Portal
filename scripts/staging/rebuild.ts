/**
 * Rebuild staging database: helper for the "Rebuild staging database" workflow,
 * which drops everything in the STAGING database and re-applies every file in
 * supabase/migrations/ from zero (docs/staging/BUILD_PLAN.md task 2.3).
 *
 * The drop-and-reapply itself is done by the Supabase CLI. This file does the
 * two things around it:
 *
 *   tsx scripts/staging/rebuild.ts check    refuse unless the target is staging
 *   tsx scripts/staging/rebuild.ts verify   confirm the database now matches the repo
 *
 * Input is environment variables only:
 *
 *   STAGING_DB_URL        Session pooler connection string for the staging database
 *   CONFIRM_STAGING_REF   the staging project ref, typed by whoever runs this
 *   STAGING_DB_CA_CERT    optional: Supabase CA certificate (PEM)
 *
 * It cannot run against production: the guard refuses before any connection is
 * opened. The connection string and its password are never printed.
 */
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { openDatabase, type Queryable } from "./database";
import { createRedactor, describeDbTarget, parseDbUrl, PRODUCTION_PROJECT_REF, type DbTarget } from "./guard";

export interface RebuildEnv {
  STAGING_DB_URL?: string;
  CONFIRM_STAGING_REF?: string;
  STAGING_DB_CA_CERT?: string;
}

export type RebuildGuardResult = { ok: true; db: DbTarget; caCert: string | null } | { ok: false; errors: string[] };

/**
 * Decide whether the environment names a safe database to rebuild. Pure.
 * Returns every problem found; error text never includes a secret value.
 */
export function checkRebuildTarget(env: RebuildEnv): RebuildGuardResult {
  const errors: string[] = [];

  let db: DbTarget | null = null;
  if (!env.STAGING_DB_URL?.trim()) {
    errors.push("STAGING_DB_URL is not set.");
  } else {
    const parsed = parseDbUrl(env.STAGING_DB_URL);
    if (!parsed.ok) {
      errors.push(`STAGING_DB_URL ${parsed.reason}`);
    } else if (parsed.db.ref === PRODUCTION_PROJECT_REF) {
      errors.push("STAGING_DB_URL is the PRODUCTION database. This script never runs against production.");
    } else {
      db = parsed.db;
    }
  }

  const confirm = env.CONFIRM_STAGING_REF?.trim() ?? "";
  if (confirm === "") {
    errors.push("CONFIRM_STAGING_REF is not set. Type the staging project ref to confirm the target.");
  } else if (confirm === PRODUCTION_PROJECT_REF) {
    errors.push("CONFIRM_STAGING_REF is the PRODUCTION project ref. This script never runs against production.");
  } else if (db !== null && confirm !== db.ref) {
    errors.push(`CONFIRM_STAGING_REF does not match the database in STAGING_DB_URL (project ${db.ref}).`);
  }

  if (errors.length > 0 || db === null) {
    return { ok: false, errors: errors.length > 0 ? errors : ["The staging database could not be determined."] };
  }
  // Unreachable unless a branch above is edited incorrectly.
  if (db.ref === PRODUCTION_PROJECT_REF) return { ok: false, errors: ["Refusing to target the production project."] };

  return { ok: true, db, caCert: env.STAGING_DB_CA_CERT?.trim() || null };
}

/** The 14-digit version prefix of every migration file in the repo, in order. */
export function repoMigrationVersions(migrationsDir: string): string[] {
  return readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .map((file) => /^(\d{14})_/.exec(file)?.[1])
    .filter((version): version is string => Boolean(version))
    .sort();
}

export interface MigrationDiff {
  /** In the repo, not recorded in the database. */
  missing: string[];
  /** Recorded in the database, no file in the repo. */
  unexpected: string[];
}

/** Compare repo versions with the versions the database records. Pure. */
export function diffMigrations(repo: string[], recorded: string[]): MigrationDiff {
  const inRepo = new Set(repo);
  const inDb = new Set(recorded);
  return {
    missing: repo.filter((version) => !inDb.has(version)),
    unexpected: recorded.filter((version) => !inRepo.has(version)),
  };
}

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "supabase", "migrations");

async function inventory(client: Queryable): Promise<Array<[string, number]>> {
  const one = async (sql: string) => Number(((await client.query(sql)).rows[0] as { n?: unknown } | undefined)?.n ?? 0);
  const app = `('public', 'private')`;
  return [
    ["tables", await one(`select count(*) as n from pg_tables where schemaname in ${app}`)],
    ["views", await one(`select count(*) as n from pg_views where schemaname in ${app}`)],
    [
      "functions",
      await one(
        `select count(*) as n from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname in ${app}`,
      ),
    ],
    ["row-level-security policies", await one(`select count(*) as n from pg_policies where schemaname in ${app}`)],
    ["storage policies", await one(`select count(*) as n from pg_policies where schemaname = 'storage'`)],
    ["storage buckets", await one(`select count(*) as n from storage.buckets`)],
  ];
}

function messageOf(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const extra = error as Error & { code?: string };
  return [error.message, extra.code && `code ${extra.code}`].filter(Boolean).join(" | ");
}

export async function main(mode: string | undefined, env: RebuildEnv): Promise<number> {
  let redact = createRedactor([env.STAGING_DB_URL]);
  const say = (line = "") => console.log(redact(line));

  if (mode !== "check" && mode !== "verify") {
    say("Usage: tsx scripts/staging/rebuild.ts check|verify");
    return 1;
  }

  const guard = checkRebuildTarget(env);
  if (!guard.ok) {
    say("Refusing to run:");
    for (const problem of guard.errors) say(`  - ${problem}`);
    return 1;
  }
  const { db, caCert } = guard;
  redact = createRedactor([env.STAGING_DB_URL, db.password]);

  // In GitHub Actions, also register the password with the runner so that
  // output from later steps (the Supabase CLI) is masked too.
  if (process.env.GITHUB_ACTIONS === "true") {
    console.log(`::add-mask::${db.password}`);
    console.log(`::add-mask::${encodeURIComponent(db.password)}`);
  }

  say(`Target project ref: ${db.ref} (confirmed, not production)`);
  say(`Database: ${describeDbTarget(db)}`);
  if (mode === "check") return 0;

  const repo = repoMigrationVersions(MIGRATIONS_DIR);
  let client: Awaited<ReturnType<typeof openDatabase>> | null = null;
  try {
    client = await openDatabase(db, caCert);
    const recorded = (
      await client.query(`select version from supabase_migrations.schema_migrations order by version`)
    ).rows.map((row) => String((row as { version: unknown }).version));
    const diff = diffMigrations(repo, recorded);

    say(`\nMigration files in the repo:        ${repo.length}`);
    say(`Migrations recorded in the database: ${recorded.length}`);
    for (const [label, count] of await inventory(client)) say(`  ${label}: ${count}`);

    if (diff.missing.length > 0) say(`\nNOT applied (in the repo, missing from the database): ${diff.missing.join(", ")}`);
    if (diff.unexpected.length > 0) say(`\nUnexpected (in the database, no file in the repo): ${diff.unexpected.join(", ")}`);
    if (diff.missing.length > 0 || diff.unexpected.length > 0) {
      say("\nRebuild staging database: FAILED - the database does not match the repo.");
      return 1;
    }
    say("\nRebuild staging database: verified - the database matches the repo exactly.");
    return 0;
  } catch (error) {
    say(`\nRebuild staging database: FAILED while verifying - ${messageOf(error)}`);
    return 1;
  } finally {
    await client?.end().catch(() => undefined);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = process.env as RebuildEnv;
  main(process.argv[2], env).then(
    (code) => process.exit(code),
    (error) => {
      console.error(`Rebuild staging database: FAILED - ${createRedactor([env.STAGING_DB_URL])(messageOf(error))}`);
      process.exit(1);
    },
  );
}
