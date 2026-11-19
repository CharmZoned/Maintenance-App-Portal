import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { PRODUCTION_PROJECT_REF } from "../../scripts/staging/guard";
import {
  checkRebuildTarget,
  diffMigrations,
  main,
  repoMigrationVersions,
  type RebuildEnv,
} from "../../scripts/staging/rebuild";

// Made-up refs: 20 lowercase letters, like a real one.
const STAGING = "stagingstagingstagin";
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
