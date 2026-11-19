/**
 * Rebuild staging database: helper for the "Rebuild staging database" workflow,
 * which drops everything in the STAGING database and re-applies every file in
 * supabase/migrations/ from zero (docs/staging/BUILD_PLAN.md task 2.3).
 *
 * The drop-and-reapply itself is done by the Supabase CLI, but only ever
 * started from here, after the guard has passed, and with a connection string
 * rebuilt from what the guard checked - never the raw secret:
 *
 *   tsx scripts/staging/rebuild.ts rebuild  guard, drop and re-apply, then verify (the workflow runs this)
 *   tsx scripts/staging/rebuild.ts check    guard only: refuse unless the target is staging
 *   tsx scripts/staging/rebuild.ts verify   guard, then confirm the database matches the repo
 *
 * Verify compares the migration history AND the schema itself (tables, columns,
 * functions, policies, triggers, buckets, ...) with what the repo's migrations
 * build; see ./schema.ts.
 *
 * Input is environment variables only:
 *
 *   STAGING_DB_URL        Session pooler connection string for the staging database
 *   CONFIRM_STAGING_REF   the staging project ref, typed by whoever runs this
 *   STAGING_DB_CA_CERT    optional: Supabase CA certificate (PEM)
 *   SUPABASE_CLI_VERSION  rebuild only: the Supabase CLI version to run (pinned by the workflow)
 *
 * It cannot run against production: the guard refuses before any connection is
 * opened. The connection string and its password are never printed.
 */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { openDatabase, type Queryable } from "./database";
import {
  createRedactor,
  describeDbTarget,
  notStagingReason,
  parseDbUrl,
  PRODUCTION_PROJECT_REF,
  STAGING_PROJECT_REF,
  type DbTarget,
} from "./guard";
import { diffSchemas, expectedSchema, snapshotSchema, type RunSql } from "./schema";

export interface RebuildEnv {
  STAGING_DB_URL?: string;
  CONFIRM_STAGING_REF?: string;
  STAGING_DB_CA_CERT?: string;
  SUPABASE_CLI_VERSION?: string;
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
      const reason = notStagingReason("STAGING_DB_URL", parsed.db.ref);
      if (reason) errors.push(reason);
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
  if (db.ref === PRODUCTION_PROJECT_REF || db.ref !== STAGING_PROJECT_REF) {
    return { ok: false, errors: ["Refusing to target anything but the staging project."] };
  }

  return { ok: true, db, caCert: env.STAGING_DB_CA_CERT?.trim() || null };
}

/**
 * The connection string handed to the Supabase CLI, rebuilt from the parts the
 * guard checked (so a value the guard did not see cannot reach the CLI). TLS required.
 */
export function cliDbUrl(db: DbTarget): string {
  const user = encodeURIComponent(db.user);
  const password = encodeURIComponent(db.password);
  return `postgresql://${user}:${password}@${db.host}:${db.port}/${encodeURIComponent(db.database)}?sslmode=require`;
}

export const DEFAULT_SUPABASE_CLI_VERSION = "3.2.0";
const CLI_VERSION = /^\d+\.\d+\.\d+$/;

/** The command that drops and re-applies every migration. Arguments only: no shell. */
export function resetCommand(db: DbTarget, cliVersion: string): { command: string; args: string[] } {
  return {
    command: "npx",
    args: ["--yes", `supabase@${cliVersion}`, "db", "reset", `--remote=${cliDbUrl(db)}`, "--no-seed", "--yes"],
  };
}

export interface CliResult {
  status: number | null;
  output: string;
}

/** Runs the CLI. Output is captured so it can be redacted before it is printed. */
export type CliRunner = (command: string, args: string[]) => CliResult;

const runCli: CliRunner = (command, args) => {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  const output = [result.stdout, result.stderr, result.error?.message].filter(Boolean).join("\n");
  return { status: result.status, output };
};

export interface RebuildDeps {
  runCli: CliRunner;
  /** Opens the database for verify; returns something that runs SQL and can be closed. */
  openDb: (db: DbTarget, caCert: string | null) => Promise<Queryable & { end(): Promise<void> }>;
  expectedSchema: () => Promise<string[]>;
}

const DEFAULT_DEPS: RebuildDeps = { runCli, openDb: openDatabase, expectedSchema };

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

export async function main(mode: string | undefined, env: RebuildEnv, deps: RebuildDeps = DEFAULT_DEPS): Promise<number> {
  let redact = createRedactor([env.STAGING_DB_URL]);
  const say = (line = "") => console.log(redact(line));

  if (mode !== "check" && mode !== "verify" && mode !== "rebuild") {
    say("Usage: tsx scripts/staging/rebuild.ts rebuild|check|verify");
    return 1;
  }

  const guard = checkRebuildTarget(env);
  if (!guard.ok) {
    say("Refusing to run:");
    for (const problem of guard.errors) say(`  - ${problem}`);
    return 1;
  }
  const { db, caCert } = guard;
  const cliUrl = cliDbUrl(db);
  redact = createRedactor([env.STAGING_DB_URL, db.password, cliUrl]);

  // In GitHub Actions, also register the password with the runner so that
  // anything printed later in the job is masked too.
  if (process.env.GITHUB_ACTIONS === "true") {
    console.log(`::add-mask::${db.password}`);
    console.log(`::add-mask::${encodeURIComponent(db.password)}`);
  }

  say(`Target project ref: ${db.ref} (confirmed, the staging project)`);
  say(`Database: ${describeDbTarget(db)}`);
  if (mode === "check") return 0;

  if (mode === "rebuild") {
    const version = env.SUPABASE_CLI_VERSION?.trim() || DEFAULT_SUPABASE_CLI_VERSION;
    if (!CLI_VERSION.test(version)) {
      say(`Refusing to run: SUPABASE_CLI_VERSION must be an exact version like ${DEFAULT_SUPABASE_CLI_VERSION}.`);
      return 1;
    }
    say(`\nDropping and re-applying every migration (Supabase CLI ${version}) ...`);
    const { command, args } = resetCommand(db, version);
    const result = deps.runCli(command, args);
    if (result.output.trim()) say(result.output.trimEnd());
    if (result.status !== 0) {
      say(`\nRebuild staging database: FAILED - the Supabase CLI exited with ${result.status ?? "no status"}.`);
      return 1;
    }
  }

  return verify(db, caCert, say, deps);
}

async function verify(
  db: DbTarget,
  caCert: string | null,
  say: (line?: string) => void,
  deps: RebuildDeps,
): Promise<number> {
  const repo = repoMigrationVersions(MIGRATIONS_DIR);
  let client: Awaited<ReturnType<RebuildDeps["openDb"]>> | null = null;
  try {
    say("\nBuilding the expected schema from supabase/migrations/ ...");
    const expected = await deps.expectedSchema();

    client = await deps.openDb(db, caCert);
    const run: RunSql = async (sql) => (await client!.query(sql)).rows as Array<Record<string, unknown>>;

    const history = (await run(
      `select version, coalesce(cardinality(statements), 0) as statements
         from supabase_migrations.schema_migrations order by version`,
    )) as Array<{ version: unknown; statements: unknown }>;
    const recorded = history.map((row) => String(row.version));
    const empty = history.filter((row) => Number(row.statements) === 0).map((row) => String(row.version));
    const migrations = diffMigrations(repo, recorded);

    const actual = await snapshotSchema(run);
    const schema = diffSchemas(expected, actual);

    say(`\nMigration files in the repo:        ${repo.length}`);
    say(`Migrations recorded in the database: ${recorded.length}`);
    for (const [label, count] of await inventory(client)) say(`  ${label}: ${count}`);
    say(`Schema objects built by the repo:    ${expected.length}`);
    say(`Schema objects in the database:      ${actual.length}`);

    const problems: Array<[string, string[]]> = [
      ["NOT applied (in the repo, missing from the database's history)", migrations.missing],
      ["Unexpected in the history (no file in the repo)", migrations.unexpected],
      ["Recorded with no SQL (the history says applied; nothing was run)", empty],
      ["Missing or different in the database (the repo builds these)", schema.missing],
      ["Unexpected or different in the database (the repo does not build these)", schema.unexpected],
    ];
    let failed = false;
    for (const [label, items] of problems) {
      if (items.length === 0) continue;
      failed = true;
      say(`\n${label}: ${items.length}`);
      for (const item of items.slice(0, 50)) say(`  ${item}`);
      if (items.length > 50) say(`  ... and ${items.length - 50} more`);
    }
    if (failed) {
      say("\nRebuild staging database: FAILED - the database does not match the repo.");
      return 1;
    }
    say("\nRebuild staging database: verified - the history and the schema match the repo exactly.");
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
