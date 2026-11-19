/**
 * Reset staging data: wipe the STAGING Supabase database and re-seed the demo
 * world (docs/adr/0007-staging-data-and-seeding.md). Run by the "Reset staging
 * data" workflow, or by hand with `pnpm staging:seed`.
 *
 * Input is environment variables only - no arguments, no files:
 *
 *   STAGING_SUPABASE_URL      Project URL, exactly https://<ref>.supabase.co
 *   STAGING_SERVICE_ROLE_KEY  service_role (or secret) API key
 *   STAGING_DB_URL            Postgres connection string. Use the SESSION POOLER
 *                             string (postgres.<ref>@...pooler.supabase.com:5432):
 *                             GitHub's runners are IPv4-only and the direct host
 *                             is IPv6. The direct string also works where IPv6 does.
 *   STAGING_DEMO_PASSWORD     password for every demo login, 16+ characters
 *   CONFIRM_STAGING_REF       the staging project ref, typed by whoever runs this
 *   STAGING_ANON_KEY          optional: publishable/anon key; enables the sign-in check
 *   STAGING_DB_CA_CERT        optional: Supabase CA certificate (PEM); verifies the
 *                             database server's certificate instead of only encrypting
 *
 * It cannot run against production: scripts/staging/guard.ts refuses before any
 * connection is opened. None of the values above is ever printed.
 */
import { pathToFileURL } from "node:url";
import { seedWorld } from "../../tests/emulator/seed";
import { countRows, openDatabase, resetDatabase, seedDbOver } from "./database";
import { checkStagingTarget, createRedactor, describeDbTarget, PRODUCTION_PROJECT_REF, type StagingEnv } from "./guard";
import {
  assertAdminAccess,
  emptyStorageBuckets,
  seedAuthOver,
  statelessClient,
  uploadDemoDocuments,
  verifySignIns,
} from "./supabase";

function table(rows: string[][]): string {
  const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => row[column].length)));
  return rows.map((row) => "  " + row.map((cell, column) => cell.padEnd(widths[column])).join("  ").trimEnd()).join("\n");
}

function messageOf(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const extra = error as Error & { code?: string; detail?: string; hint?: string };
  return [error.message, extra.code && `code ${extra.code}`, extra.detail, extra.hint].filter(Boolean).join(" | ");
}

function secretsIn(env: StagingEnv): Array<string | undefined> {
  return [env.STAGING_SERVICE_ROLE_KEY, env.STAGING_DB_URL, env.STAGING_DEMO_PASSWORD, env.STAGING_ANON_KEY];
}

export async function main(env: StagingEnv): Promise<number> {
  // Everything printed goes through `say`, which blanks the secret values.
  const secrets = secretsIn(env);
  let redact = createRedactor(secrets);
  const say = (line = "") => console.log(redact(line));

  // 1. Production guard. Pure; nothing has been contacted yet.
  const guard = checkStagingTarget(env);
  if (!guard.ok) {
    say("Refusing to run:");
    for (const problem of guard.errors) say(`  - ${problem}`);
    return 1;
  }
  const target = guard.target;
  if (target.ref === PRODUCTION_PROJECT_REF) {
    say("Refusing to run: the target is the production project.");
    return 1;
  }
  redact = createRedactor([...secrets, target.db.password, target.serviceRoleKey, target.anonKey]);

  say(`Target project ref: ${target.ref} (confirmed)`);
  say(`Database: ${describeDbTarget(target.db)}`);
  say(`TLS: on, server certificate ${target.dbCaCert ? "verified against the supplied CA" : "not verified (no STAGING_DB_CA_CERT)"}`);

  const admin = statelessClient(target.apiUrl, target.serviceRoleKey);
  let failed = false;
  let stage = "connect to the database";
  let state: "untouched" | "wiped" | "seeded" = "untouched";
  let db: Awaited<ReturnType<typeof openDatabase>> | undefined;

  try {
    db = await openDatabase(target.db, target.dbCaCert);

    // Everything the seed needs must work before anything is removed.
    stage = "check the service-role key";
    await assertAdminAccess(admin);

    // 2. Wipe: the portal's tables (schemas public and private) and auth.users, one transaction.
    stage = "reset the database";
    say("\nResetting ...");
    const reset = await resetDatabase(db);
    state = "wiped";
    say(`  truncated ${reset.tables.length} tables, restarted ${reset.sequences.length} sequence(s)`);
    say(`  deleted ${reset.usersDeleted} auth user(s)`);

    // 3. Storage objects. Best effort: a leftover file is harmless.
    stage = "empty the storage buckets";
    for (const bucket of await emptyStorageBuckets(admin)) {
      say(`  storage ${bucket.bucket}: ${bucket.emptied ? "emptied" : `NOT emptied - ${bucket.detail}`}`);
    }

    // 4. Seed the demo world, with logins already email-confirmed.
    stage = "seed the demo world";
    say("\nSeeding the demo world ...");
    const world = await seedWorld(seedDbOver(db), seedAuthOver(admin), { password: target.demoPassword, demo: true });
    state = "seeded";
    say(`  created ${Object.keys(world.users).length} logins`);

    // 5. Sample files for the seeded document rows, so Download works.
    stage = "upload the sample documents";
    const uploads = await uploadDemoDocuments(admin, world.demo?.documents ?? []);
    const notUploaded = uploads.filter((u) => !u.ok);
    say(`  uploaded ${uploads.length - notUploaded.length} of ${uploads.length} sample document(s)`);
    for (const upload of notUploaded) say(`  NOT uploaded ${upload.path}: ${upload.detail}`);
    if (notUploaded.length > 0) failed = true;

    // 6. Report.
    stage = "count rows";
    const counts = await countRows(db);
    say("\nRow counts:");
    say(table([["table", "rows"], ...counts.map((c) => [c.table, String(c.rows)])]));

    stage = "verify the demo sign-ins";
    say("\nSign-in check:");
    if (!target.anonKey) {
      say("  skipped - STAGING_ANON_KEY is not set, so the four demo logins were not tested.");
    } else {
      const checks = await verifySignIns(target.apiUrl, target.anonKey, target.demoPassword);
      say(table([["persona", "email", "result"], ...checks.map((c) => [c.persona, c.email, `${c.ok ? "ok" : "FAILED"} - ${c.detail}`])]));
      if (checks.some((c) => !c.ok)) {
        failed = true;
        say("\nThe data was seeded, but not every demo login works as expected.");
      }
    }
  } catch (error) {
    failed = true;
    say(`\nFAILED while trying to ${stage}: ${messageOf(error)}`);
    if (state === "untouched") say("Nothing was changed.");
    if (state === "wiped") {
      say("Staging has been wiped and is only partly seeded. Fix the cause and run this again - it is safe to repeat.");
    }
    if (state === "seeded") say("The data was seeded; only the checks afterwards did not complete.");
  } finally {
    await db?.end().catch(() => undefined);
  }

  say(failed ? "\nReset staging data: FAILED" : "\nReset staging data: done");
  return failed ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = process.env as StagingEnv;
  main(env).then(
    (code) => process.exit(code),
    (error) => {
      console.error(`Reset staging data: FAILED - ${createRedactor(secretsIn(env))(messageOf(error))}`);
      process.exit(1);
    },
  );
}
