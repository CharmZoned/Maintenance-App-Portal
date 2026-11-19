/**
 * Schema snapshot for "Rebuild staging database" verify: what the migrations
 * in the repo build, compared object by object with what the staging database
 * actually has. Matching migration version numbers alone does not prove that:
 * a record can exist with no SQL behind it (24 of production's do), and a
 * dashboard edit leaves the history untouched.
 *
 * The expected side comes from applying every file in supabase/migrations/ to
 * an in-process Postgres (PGlite, via the test emulator), so the comparison
 * needs no second database and nothing is hand-maintained.
 *
 * Covered: the portal's schemas (public, private) - tables with their
 * row-level-security flags, columns, views, functions (signature and body),
 * enum types, indexes, triggers and policies - plus storage buckets, policies
 * on storage tables, and triggers on auth.users that call the portal's
 * functions. Objects installed by extensions are left out. Platform-owned
 * schemas (auth, storage tables themselves, extensions) are not compared:
 * Supabase manages them and the emulator only imitates them.
 */

export type RunSql = (sql: string) => Promise<Array<Record<string, unknown>>>;

const APP = `('public', 'private')`;

/** Not created by an extension. `oid` is a pg_class / pg_proc / pg_type oid. */
const notExtension = (classTable: string, oid: string) =>
  `not exists (select 1 from pg_depend d where d.classid = '${classTable}'::regclass and d.objid = ${oid} and d.deptype = 'e')`;

/** Each query returns one column, `line`: a stable, human-readable description of one object. */
const QUERIES: Array<[kind: string, sql: string]> = [
  [
    "table",
    `select format('%I.%I rls=%s force_rls=%s', n.nspname, c.relname, c.relrowsecurity, c.relforcerowsecurity) as line
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ${APP} and c.relkind in ('r', 'p') and ${notExtension("pg_class", "c.oid")}`,
  ],
  [
    "view",
    `select format('%I.%I', n.nspname, c.relname) as line
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ${APP} and c.relkind in ('v', 'm') and ${notExtension("pg_class", "c.oid")}`,
  ],
  [
    "column",
    `select format('%I.%I.%I %s%s', n.nspname, c.relname, a.attname, format_type(a.atttypid, a.atttypmod),
                   case when a.attnotnull then ' not null' else '' end) as line
       from pg_attribute a
       join pg_class c on c.oid = a.attrelid
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ${APP} and c.relkind in ('r', 'p', 'v', 'm')
        and a.attnum > 0 and not a.attisdropped and ${notExtension("pg_class", "c.oid")}`,
  ],
  [
    "function",
    `select format('%I.%I(%s) returns %s%s body=%s', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid),
                   pg_get_function_result(p.oid), case when p.prosecdef then ' security definer' else '' end,
                   md5(coalesce(p.prosrc, ''))) as line
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ${APP} and ${notExtension("pg_proc", "p.oid")}`,
  ],
  [
    "type",
    `select format('%I.%I enum(%s)', n.nspname, t.typname,
                   (select string_agg(e.enumlabel, ',' order by e.enumsortorder) from pg_enum e where e.enumtypid = t.oid)) as line
       from pg_type t join pg_namespace n on n.oid = t.typnamespace
      where n.nspname in ${APP} and t.typtype = 'e' and ${notExtension("pg_type", "t.oid")}`,
  ],
  [
    "index",
    `select format('%I.%I on %I', n.nspname, i.relname, t.relname) as line
       from pg_index x
       join pg_class i on i.oid = x.indexrelid
       join pg_class t on t.oid = x.indrelid
       join pg_namespace n on n.oid = i.relnamespace
      where n.nspname in ${APP} and ${notExtension("pg_class", "t.oid")}`,
  ],
  [
    "trigger",
    `select format('%I.%I %I -> %I.%I', tn.nspname, t.relname, g.tgname, fn.nspname, f.proname) as line
       from pg_trigger g
       join pg_class t on t.oid = g.tgrelid
       join pg_namespace tn on tn.oid = t.relnamespace
       join pg_proc f on f.oid = g.tgfoid
       join pg_namespace fn on fn.oid = f.pronamespace
      where not g.tgisinternal
        and (tn.nspname in ${APP} or (tn.nspname = 'auth' and t.relname = 'users' and fn.nspname in ${APP}))`,
  ],
  [
    "policy",
    `select format('%I.%I %I %s %s to %s', schemaname, tablename, policyname, permissive, cmd,
                   array_to_string(array(select unnest(roles) order by 1), ',')) as line
       from pg_policies
      where schemaname in ('public', 'private', 'storage')`,
  ],
  [
    "bucket",
    `select format('%s public=%s size_limit=%s types=%s', id, public, coalesce(file_size_limit::text, '-'),
                   coalesce(array_to_string(array(select unnest(allowed_mime_types) order by 1), ','), '-')) as line
       from storage.buckets`,
  ],
];

/** Every object, as "kind line", sorted. */
export async function snapshotSchema(run: RunSql): Promise<string[]> {
  const lines: string[] = [];
  for (const [kind, sql] of QUERIES) {
    for (const row of await run(sql)) lines.push(`${kind} ${String(row.line)}`);
  }
  return lines.sort();
}

export interface SchemaDiff {
  /** Built by the repo's migrations, not in the database (or different there). */
  missing: string[];
  /** In the database, not built by the migrations (or different there). */
  unexpected: string[];
}

/** Compare two snapshots. Pure. */
export function diffSchemas(expected: string[], actual: string[]): SchemaDiff {
  const inExpected = new Set(expected);
  const inActual = new Set(actual);
  return {
    missing: expected.filter((line) => !inActual.has(line)),
    unexpected: actual.filter((line) => !inExpected.has(line)),
  };
}

/** The snapshot of a fresh database with every repo migration applied (PGlite, in-process). */
export async function expectedSchema(): Promise<string[]> {
  const { EmulatorDb } = await import("../../tests/emulator/db");
  const db = await EmulatorDb.create();
  try {
    return await snapshotSchema((sql) => db.admin(sql));
  } finally {
    await db.close();
  }
}
