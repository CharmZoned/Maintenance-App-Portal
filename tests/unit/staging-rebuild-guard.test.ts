import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { PRODUCTION_PROJECT_REF, STAGING_PROJECT_REF } from "../../scripts/staging/guard";
import {
  checkRebuildTarget,
  cliDbUrl,
  diffMigrations,
  main,
  repoMigrationVersions,
  resetCommand,
  type CliRunner,
  type RebuildDeps,
  type RebuildEnv,
} from "../../scripts/staging/rebuild";
import { diffSchemas } from "../../scripts/staging/schema";

// The real staging ref (the guard accepts no other); OTHER is made up, 20 lowercase letters like a real one.
const STAGING = STAGING_PROJECT_REF;
const OTHER = "otherotherotherother";
const PROD = PRODUCTION_PROJECT_REF;

const DB_PASSWORD = "db-pass-not-real";
const poolerUrl = (ref: string) =>
  `postgresql://postgres.${ref}:${DB_PASSWORD}@aws-0-us-east-1.pooler.supabase.com:5432/postgres`;
const directUrl = (ref: string) => `postgresql://postgres:${DB_PASSWORD}@db.${ref}.supabase.co:5432/postgres`;

const goodEnv = (overrides: Partial<RebuildEnv> = {}): RebuildEnv => ({
  STAGING_DB_URL: poolerUrl(STAGING),
  CONFIRM_STAGING_REF: STAGING,
  ...overrides,
});

const errorsOf = (env: RebuildEnv): string[] => {
  const result = checkRebuildTarget(env);
  return result.ok ? [] : result.errors;
};

describe("staging rebuild guard", () => {
  test("accepts a confirmed staging database, by pooler or direct string", () => {
    const pooler = checkRebuildTarget(goodEnv());
    expect(pooler.ok && pooler.db.ref).toBe(STAGING);
    const direct = checkRebuildTarget(goodEnv({ STAGING_DB_URL: directUrl(STAGING) }));
    expect(direct.ok && direct.db.ref).toBe(STAGING);
  });

  test("refuses the production database, however it is addressed", () => {
    for (const url of [poolerUrl(PROD), directUrl(PROD)]) {
      // Even when the confirmation also names production.
      for (const confirm of [PROD, STAGING]) {
        const result = checkRebuildTarget({ STAGING_DB_URL: url, CONFIRM_STAGING_REF: confirm });
        expect(result.ok).toBe(false);
        expect(errorsOf({ STAGING_DB_URL: url, CONFIRM_STAGING_REF: confirm }).join(" ")).toMatch(/PRODUCTION/);
      }
    }
  });

  test("refuses when the confirmation is missing, wrong, or production", () => {
    expect(errorsOf(goodEnv({ CONFIRM_STAGING_REF: undefined })).join(" ")).toMatch(/CONFIRM_STAGING_REF is not set/);
    expect(errorsOf(goodEnv({ CONFIRM_STAGING_REF: "  " })).join(" ")).toMatch(/CONFIRM_STAGING_REF is not set/);
    expect(errorsOf(goodEnv({ CONFIRM_STAGING_REF: OTHER })).join(" ")).toMatch(/does not match/);
    expect(errorsOf(goodEnv({ CONFIRM_STAGING_REF: PROD })).join(" ")).toMatch(/PRODUCTION/);
  });

  test("refuses any database other than staging, even when the confirmation matches it", () => {
    for (const url of [poolerUrl(OTHER), directUrl(OTHER)]) {
      const errors = errorsOf({ STAGING_DB_URL: url, CONFIRM_STAGING_REF: OTHER });
      expect(errors.join(" ")).toMatch(/names project otherotherotherother, which is not the staging project/);
    }
  });

  test("refuses a missing or unusable connection string", () => {
    expect(errorsOf(goodEnv({ STAGING_DB_URL: undefined })).join(" ")).toMatch(/STAGING_DB_URL is not set/);
    expect(checkRebuildTarget(goodEnv({ STAGING_DB_URL: "not a url" })).ok).toBe(false);
    expect(checkRebuildTarget(goodEnv({ STAGING_DB_URL: "postgresql://postgres:x@example.com:5432/postgres" })).ok).toBe(
      false,
    );
    // Transaction pooler.
    expect(checkRebuildTarget(goodEnv({ STAGING_DB_URL: poolerUrl(STAGING).replace(":5432", ":6543") })).ok).toBe(false);
  });

  test("never puts the database password in an error message", () => {
    const messages = [
      ...errorsOf({ STAGING_DB_URL: poolerUrl(PROD), CONFIRM_STAGING_REF: PROD }),
      ...errorsOf(goodEnv({ CONFIRM_STAGING_REF: OTHER })),
      ...errorsOf(goodEnv({ STAGING_DB_URL: poolerUrl(STAGING).replace(":5432", ":6543") })),
    ].join("\n");
    expect(messages).not.toContain(DB_PASSWORD);
  });

  test("the entrypoint refuses production before connecting, and rejects unknown modes", async () => {
    expect(await main("verify", { STAGING_DB_URL: poolerUrl(PROD), CONFIRM_STAGING_REF: PROD })).toBe(1);
    expect(await main("check", { STAGING_DB_URL: poolerUrl(PROD), CONFIRM_STAGING_REF: PROD })).toBe(1);
    expect(await main("drop-everything", goodEnv())).toBe(1);
    expect(await main(undefined, goodEnv())).toBe(1);
    // `check` on a good target succeeds without opening any connection.
    expect(await main("check", goodEnv())).toBe(0);
  });
});

/** Fake dependencies: records CLI calls, serves canned SQL results, never touches a network. */
function fakeDeps(options: {
  cliStatus?: number;
  expected?: string[];
  actual?: string[];
  history?: Array<{ version: string; statements: number }>;
}) {
  const calls: Array<{ command: string; args: string[] }> = [];
  const runCli: CliRunner = (command, args) => {
    calls.push({ command, args });
    return { status: options.cliStatus ?? 0, output: `connected to ${args.join(" ")}` };
  };
  const repo = repoMigrationVersions(join(__dirname, "..", "..", "supabase", "migrations"));
  const history = options.history ?? repo.map((version) => ({ version, statements: 3 }));
  const actual = options.actual ?? ["table public.a rls=true force_rls=false"];
  let opened = 0;
  const deps: RebuildDeps = {
    runCli,
    expectedSchema: async () => options.expected ?? ["table public.a rls=true force_rls=false"],
    openDb: async () => {
      opened++;
      return {
        async query(sql: string) {
          if (sql.includes("supabase_migrations.schema_migrations")) return { rows: history, rowCount: history.length };
          if (sql.includes("as line")) {
            // Hand the whole snapshot back on the first (table) query, nothing for the rest.
            const lines = sql.includes("rls=%s") ? actual.map((line) => ({ line: line.replace(/^table /, "") })) : [];
            return { rows: lines, rowCount: lines.length };
          }
          return { rows: [{ n: 0 }], rowCount: 1 };
        },
        async end() {},
      };
    },
  };
  return { deps, calls, opened: () => opened };
}

describe("staging rebuild: the drop runs only behind the guard", () => {
  test("a refused target never starts the CLI or opens a connection", async () => {
    for (const env of [
      { STAGING_DB_URL: poolerUrl(PROD), CONFIRM_STAGING_REF: PROD },
      { STAGING_DB_URL: poolerUrl(OTHER), CONFIRM_STAGING_REF: OTHER },
      goodEnv({ CONFIRM_STAGING_REF: OTHER }),
      goodEnv({ STAGING_DB_URL: undefined }),
    ]) {
      const fake = fakeDeps({});
      expect(await main("rebuild", env, fake.deps)).toBe(1);
      expect(fake.calls).toEqual([]);
      expect(fake.opened()).toBe(0);
    }
  });

  test("the CLI gets a connection string rebuilt from the checked target, not the raw secret", async () => {
    const fake = fakeDeps({});
    const raw = `${poolerUrl(STAGING)}?sslmode=disable`;
    expect(await main("rebuild", goodEnv({ STAGING_DB_URL: raw }), fake.deps)).toBe(0);
    expect(fake.calls).toHaveLength(1);
    const remote = fake.calls[0].args.find((arg) => arg.startsWith("--remote="));
    expect(remote).toBe(
      `--remote=postgresql://postgres.${STAGING}:${DB_PASSWORD}@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require`,
    );
    expect(fake.calls[0].args).toEqual(["--yes", "supabase@3.2.0", "db", "reset", remote, "--no-seed", "--yes"]);
  });

  test("percent-encodes the password it hands the CLI", () => {
    const parsed = checkRebuildTarget(goodEnv({ STAGING_DB_URL: poolerUrl(STAGING).replace(DB_PASSWORD, "p%40ss%2Fw") }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.db.password).toBe("p@ss/w");
    expect(cliDbUrl(parsed.db)).toContain(":p%40ss%2Fw@");
    expect(resetCommand(parsed.db, "1.2.3").args[1]).toBe("supabase@1.2.3");
  });

  test("refuses a CLI version that is not exact, before running anything", async () => {
    const fake = fakeDeps({});
    expect(await main("rebuild", { ...goodEnv(), SUPABASE_CLI_VERSION: "latest" }, fake.deps)).toBe(1);
    expect(fake.calls).toEqual([]);
  });

  test("a failed CLI run fails the rebuild and skips verify", async () => {
    const fake = fakeDeps({ cliStatus: 1 });
    expect(await main("rebuild", goodEnv(), fake.deps)).toBe(1);
    expect(fake.opened()).toBe(0);
  });

  test("the CLI's output is printed with the password blanked", async () => {
    const fake = fakeDeps({});
    const lines: string[] = [];
    const log = console.log;
    console.log = (line?: unknown) => void lines.push(String(line));
    try {
      await main("rebuild", goodEnv(), fake.deps);
    } finally {
      console.log = log;
    }
    // Under GitHub Actions the script registers the password with the runner on
    // purpose (`::add-mask::`); every other line must have it blanked.
    const printed = lines.filter((line) => !line.startsWith("::add-mask::")).join("\n");
    expect(printed).toContain("connected to");
    expect(printed).not.toContain(DB_PASSWORD);
    expect(printed).not.toContain(encodeURIComponent(DB_PASSWORD));
  });
});

describe("staging rebuild verification: history and schema", () => {
  test("passes when the history and the schema match the repo", async () => {
    expect(await main("verify", goodEnv(), fakeDeps({}).deps)).toBe(0);
  });

  test("fails when a migration is recorded with no SQL behind it", async () => {
    const repo = repoMigrationVersions(join(__dirname, "..", "..", "supabase", "migrations"));
    const history = repo.map((version, i) => ({ version, statements: i === 0 ? 0 : 3 }));
    expect(await main("verify", goodEnv(), fakeDeps({ history }).deps)).toBe(1);
  });

  test("fails when the schema differs, even with a perfect history", async () => {
    const expected = ["table public.a rls=true force_rls=false"];
    expect(await main("verify", goodEnv(), fakeDeps({ expected, actual: ["table public.a rls=false force_rls=false"] }).deps)).toBe(1);
    expect(await main("verify", goodEnv(), fakeDeps({ expected, actual: [] }).deps)).toBe(1);
  });

  test("diffSchemas reports both directions", () => {
    expect(diffSchemas(["a", "b"], ["a", "b"])).toEqual({ missing: [], unexpected: [] });
    expect(diffSchemas(["a", "b"], ["b", "c"])).toEqual({ missing: ["a"], unexpected: ["c"] });
  });
});

describe("staging rebuild verification", () => {
  test("reads 14-digit version prefixes from migration files, sorted", () => {
    const dir = mkdtempSync(join(tmpdir(), "migrations-"));
    for (const file of ["20260102030405_b.sql", "20260101000000_a.sql", "README.md", "notes.sql", "2026_bad.sql"]) {
      writeFileSync(join(dir, file), "");
    }
    expect(repoMigrationVersions(dir)).toEqual(["20260101000000", "20260102030405"]);
  });

  test("reports migrations missing from the database and ones with no file", () => {
    expect(diffMigrations(["1", "2", "3"], ["1", "2", "3"])).toEqual({ missing: [], unexpected: [] });
    expect(diffMigrations(["1", "2", "3"], ["1", "3"])).toEqual({ missing: ["2"], unexpected: [] });
    expect(diffMigrations(["1", "2"], ["1", "2", "9"])).toEqual({ missing: [], unexpected: ["9"] });
    expect(diffMigrations(["1", "2"], [])).toEqual({ missing: ["1", "2"], unexpected: [] });
  });
});
