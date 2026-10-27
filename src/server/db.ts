/**
 * Postgres adapter for Supabase (transaction pooler).
 * Keeps the same query / get / run helpers the routes already use, and
 * converts `?` placeholders to `$1`-style for postgres.js.
 */
import postgres from "postgres";

type Sql = ReturnType<typeof postgres>;

let sql: Sql | null = null;

export type DbEnv = { DATABASE_URL?: string };

export function initDB(env: DbEnv): void {
  const fromProcess =
    typeof globalThis !== "undefined" &&
    "process" in globalThis &&
    (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.DATABASE_URL;
  const url = env.DATABASE_URL ?? fromProcess;
  if (!url) {
    throw new Error("DATABASE_URL is not set. Add it to .dev.vars (local) or wrangler secrets (prod).");
  }
  if (sql) return;
  sql = postgres(url, {
    prepare: false, // required for Supabase transaction pooler (port 6543)
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
  });
}

function client(): Sql {
  if (!sql) throw new Error("Database not initialised — call initDB first");
  return sql;
}

/** Convert `?` placeholders to `$1, $2, …`. */
function toPg(query: string): string {
  let i = 0;
  return query.replace(/\?/g, () => `$${++i}`);
}

export async function query<T = Record<string, unknown>>(
  q: string,
  params: unknown[] = [],
): Promise<T[]> {
  const rows = await client().unsafe(toPg(q), params as (string | number | boolean | null)[]);
  return rows as unknown as T[];
}

export async function get<T = Record<string, unknown>>(
  q: string,
  params: unknown[] = [],
): Promise<T | undefined> {
  const rows = await query<T>(q, params);
  return rows[0];
}

export async function run(
  q: string,
  params: unknown[] = [],
): Promise<{ lastInsertRowid: number | bigint; changes: number }> {
  let sqlText = q.trim().replace(/;?\s*$/, "");
  const isInsert = /^\s*INSERT\b/i.test(sqlText);
  const hasReturning = /\bRETURNING\b/i.test(sqlText);

  if (isInsert && !hasReturning) {
    sqlText = `${sqlText} RETURNING id`;
  }

  const rows = await client().unsafe(toPg(sqlText), params as (string | number | boolean | null)[]);
  const list = rows as unknown as Array<{ id?: number | string }>;
  const count = typeof (rows as { count?: number }).count === "number"
    ? (rows as { count: number }).count
    : list.length;

  let lastInsertRowid: number | bigint = 0;
  if (isInsert && list[0]?.id != null) {
    lastInsertRowid = typeof list[0].id === "string" ? Number(list[0].id) : (list[0].id as number);
  }

  return { lastInsertRowid, changes: count };
}

export async function closeDB(): Promise<void> {
  if (sql) {
    await sql.end({ timeout: 5 });
    sql = null;
  }
}
