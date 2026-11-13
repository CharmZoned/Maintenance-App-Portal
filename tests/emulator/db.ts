import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import type { JwtClaims } from "./jwt";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, "../..");
const BASELINE_DIR = join(HERE, "baseline");
const MIGRATIONS_DIR = join(REPO_ROOT, "supabase", "migrations");

export type DbRole = "anon" | "authenticated" | "service_role";

export interface AppliedMigration {
  source: "baseline" | "repo";
  file: string;
}

export interface PgError extends Error {
  code?: string;
  detail?: string;
  hint?: string;
}

function sqlFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

/**
 * A real Postgres (PGlite, in-process) carrying the project's schema:
 *   1. tests/emulator/baseline/*  — platform shim + schema history that predates this repo
 *   2. supabase/migrations/*      — every migration in the repo, in filename order
 *
 * New files dropped into supabase/migrations are picked up automatically.
 */
export class EmulatorDb {
  private constructor(
    private readonly pg: PGlite,
    readonly migrations: AppliedMigration[],
  ) {}

  static async create(): Promise<EmulatorDb> {
    const pg = new PGlite();
    await pg.waitReady;
    const applied: AppliedMigration[] = [];
    const plan: Array<AppliedMigration & { path: string }> = [
      ...sqlFiles(BASELINE_DIR).map((file) => ({
        source: "baseline" as const,
        file,
        path: join(BASELINE_DIR, file),
      })),
      ...sqlFiles(MIGRATIONS_DIR).map((file) => ({
        source: "repo" as const,
        file,
        path: join(MIGRATIONS_DIR, file),
      })),
    ];
    for (const step of plan) {
      try {
        await pg.exec(readFileSync(step.path, "utf8"));
      } catch (err) {
        const e = err as PgError;
        throw new Error(
          `Migration failed: ${step.source}/${step.file}\n  ${e.code ?? ""} ${e.message}` +
            (e.detail ? `\n  detail: ${e.detail}` : ""),
        );
      }
      applied.push({ source: step.source, file: step.file });
    }
    return new EmulatorDb(pg, applied);
  }

  /** Superuser query — the equivalent of the Supabase SQL editor. */
  async admin<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const res = await this.pg.query<T>(sql, params);
    return res.rows;
  }

  async adminExec(sql: string): Promise<void> {
    await this.pg.exec(sql);
  }

  /**
   * Run `fn` the way PostgREST / Storage would: inside a transaction, as the
   * request's database role, with the JWT claims visible to auth.uid() and RLS.
   */
  async asRole<T>(role: DbRole, claims: JwtClaims, fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.pg.transaction(async (tx) => {
      await tx.query(
        `select set_config('role', $1, true), set_config('request.jwt.claims', $2, true)`,
        [role, JSON.stringify(claims)],
      );
      return fn(tx);
    }) as Promise<T>;
  }

  /** Wipe all data (schema, policies and storage buckets stay). */
  async reset(): Promise<void> {
    const tables = await this.admin<{ t: string }>(
      `select format('%I.%I', schemaname, tablename) as t
         from pg_tables
        where schemaname = 'public'
           or (schemaname = 'auth' and tablename = 'users')
           or (schemaname = 'storage' and tablename = 'objects')`,
    );
    await this.pg.exec(
      `truncate table ${tables.map((r) => r.t).join(", ")} restart identity cascade;
       alter sequence public.maintenance_request_number_seq restart;`,
    );
  }

  async close(): Promise<void> {
    await this.pg.close();
  }
}
