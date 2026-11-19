/**
 * Postgres side of the staging reset: the connection, the wipe, and the
 * `SeedDb` adapter the shared world definition writes through.
 *
 * Nothing here decides *where* to connect; that is scripts/staging/guard.ts.
 */
import { Client, types } from "pg";
import type { SeedDb } from "../../tests/emulator/seed";
import type { DbTarget } from "./guard";

const INT8_OID = 20;
const JSON_TYPES = new Set(["json", "jsonb"]);

/**
 * Open the one connection the script uses. TLS is always on. The server
 * certificate is verified when a CA certificate is supplied; Supabase signs
 * its database certificates with its own CA, so without one the connection is
 * encrypted but the server's identity is not checked (libpq `sslmode=require`).
 */
export async function openDatabase(db: DbTarget, caCert: string | null): Promise<Client> {
  // node-postgres falls back to libpq-style environment variables (PGHOST,
  // PGOPTIONS, PGSSLMODE, ...) for anything not passed explicitly. PGOPTIONS in
  // particular can re-route a pooler connection, so none may leak in.
  for (const name of Object.keys(process.env)) {
    if (/^PG[A-Z]/.test(name)) delete process.env[name];
  }

  const client = new Client({
    host: db.host,
    port: db.port,
    user: db.user,
    password: db.password,
    database: db.database,
    ssl: caCert ? { ca: caCert, rejectUnauthorized: true } : { rejectUnauthorized: false },
    application_name: "staging-seed",
    connectionTimeoutMillis: 20_000,
    statement_timeout: 120_000,
    // bigint columns as numbers (when exact), the same as the emulator's
    // database, so the world definition sees identical values on both targets.
    types: {
      getTypeParser: ((oid: number, format?: "text" | "binary") => {
        if (oid === INT8_OID && format !== "binary") return parseInt8;
        return types.getTypeParser(oid, format);
      }) as typeof types.getTypeParser,
    },
  });
  await client.connect();
  return client;
}

function parseInt8(value: string): number | bigint {
  const big = BigInt(value);
  return big >= BigInt(Number.MIN_SAFE_INTEGER) && big <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(big) : big;
}

/** The slice of a pg client this module needs. */
export interface Queryable {
  query(sql: string, values?: unknown[]): Promise<{ rows: unknown[]; rowCount: number | null }>;
}

async function rows<T>(client: Queryable, sql: string, values?: unknown[]): Promise<T[]> {
  const result = await client.query(sql, values);
  // A parameterless string with several statements comes back as a list of results.
  const last = Array.isArray(result) ? result[result.length - 1] : result;
  return (last?.rows ?? []) as T[];
}

/**
 * Server-side parameter types of a statement, as type names (`jsonb`,
 * `integer[]`, ...). Null when the statement cannot be prepared on its own.
 */
async function parameterTypes(client: Queryable, sql: string): Promise<string[] | null> {
  const name = `staging_seed_describe`;
  try {
    await client.query(`prepare ${name} as ${sql}`);
  } catch {
    return null;
  }
  try {
    const [row] = await rows<{ types: string[] }>(
      client,
      `select parameter_types::text[] as types from pg_prepared_statements where name = $1`,
      [name],
    );
    return row?.types ?? null;
  } finally {
    await client.query(`deallocate ${name}`);
  }
}

/**
 * Convert seed parameters to what node-postgres should send, matching how the
 * emulator's database treats them: dates as ISO strings, plain objects as JSON,
 * and a JavaScript array as JSON when the parameter is json/jsonb and as a
 * Postgres array otherwise. Only an array needs the server asked for its type.
 */
async function prepareParams(client: Queryable, sql: string, params: unknown[]): Promise<unknown[]> {
  let serverTypes: string[] | null | undefined;
  const out: unknown[] = [];
  for (const [index, value] of params.entries()) {
    if (value === undefined || value === null) {
      out.push(null);
    } else if (typeof value === "bigint") {
      out.push(value.toString());
    } else if (value instanceof Date) {
      out.push(value.toISOString());
    } else if (value instanceof Uint8Array) {
      out.push(Buffer.from(value));
    } else if (Array.isArray(value)) {
      if (serverTypes === undefined) serverTypes = await parameterTypes(client, sql);
      out.push(JSON_TYPES.has(serverTypes?.[index] ?? "") ? JSON.stringify(value) : value);
    } else if (typeof value === "object") {
      out.push(JSON.stringify(value));
    } else {
      out.push(value);
    }
  }
  return out;
}

/** `SeedDb` over a real Postgres connection (the "SQL editor" target). */
export function seedDbOver(client: Queryable): SeedDb {
  return {
    async admin<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
      if (params.length === 0) return rows<T>(client, sql);
      return rows<T>(client, sql, await prepareParams(client, sql, params));
    },
  };
}

/** Ordinary tables in schema `public`, discovered at run time, quoted and schema-qualified. */
export async function listPublicTables(client: Queryable): Promise<string[]> {
  const found = await rows<{ name: string }>(
    client,
    `select format('%I.%I', n.nspname, c.relname) as name
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind in ('r', 'p')
        and not c.relispartition
        and not exists (
          select 1 from pg_depend d
           where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e')
      order by 1`,
  );
  return found.map((r) => r.name);
}

export interface ResetSummary {
  tables: string[];
  sequences: string[];
  usersDeleted: number;
}

/**
 * Empty the database of data, in one transaction:
 *   - TRUNCATE every table in schema `public` (RESTART IDENTITY CASCADE)
 *   - restart the free-standing sequences in `public` (request numbers)
 *   - DELETE every row of auth.users (sessions, identities and other dependent
 *     auth rows go with them through their own foreign keys)
 *
 * Nothing is dropped. No other schema is written: before truncating it checks
 * that no table outside `public` references one inside it, so CASCADE cannot
 * reach beyond the tables listed. Migration history, storage buckets and
 * storage objects are untouched.
 */
export async function resetDatabase(client: Queryable): Promise<ResetSummary> {
  await client.query("begin");
  try {
    // Fail rather than queue forever behind another session's lock.
    await client.query("set local lock_timeout = '30s'");

    const tables = await listPublicTables(client);

    const outside = await rows<{ name: string }>(
      client,
      `select distinct format('%I.%I', n.nspname, c.relname) as name
         from pg_constraint k
         join pg_class c on c.oid = k.conrelid
         join pg_namespace n on n.oid = c.relnamespace
         join pg_class rc on rc.oid = k.confrelid
         join pg_namespace rn on rn.oid = rc.relnamespace
        where k.contype = 'f' and rn.nspname = 'public' and n.nspname <> 'public'`,
    );
    if (outside.length > 0) {
      throw new Error(
        `Refusing to truncate: tables outside schema public reference it and would be emptied too ` +
          `(${outside.map((r) => r.name).join(", ")}).`,
      );
    }

    if (tables.length > 0) {
      await client.query(`truncate table ${tables.join(", ")} restart identity cascade`);
    }

    // Sequences not owned by a column are not covered by RESTART IDENTITY.
    const sequences = (
      await rows<{ name: string }>(
        client,
        `select format('%I.%I', n.nspname, c.relname) as name
           from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public'
            and c.relkind = 'S'
            and not exists (
              select 1 from pg_depend d
               where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype in ('a', 'i', 'e'))
          order by 1`,
      )
    ).map((r) => r.name);
    for (const sequence of sequences) {
      await client.query(`alter sequence ${sequence} restart`);
    }

    const deleted = await client.query("delete from auth.users");

    await client.query("commit");
    return { tables, sequences, usersDeleted: deleted.rowCount ?? 0 };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  }
}

/** Row count per public table, plus auth.users, in name order. */
export async function countRows(client: Queryable): Promise<Array<{ table: string; rows: number }>> {
  const tables = [...(await listPublicTables(client)), "auth.users"];
  const counts: Array<{ table: string; rows: number }> = [];
  for (const table of tables) {
    const [row] = await rows<{ n: number }>(client, `select count(*)::int as n from ${table}`);
    counts.push({ table, rows: row?.n ?? 0 });
  }
  return counts;
}
