import { describe, expect, test } from "vitest";
import { PRODUCTION_PROJECT_REF as APP_PRODUCTION_PROJECT_REF } from "@/lib/env";
import {
  checkStagingTarget,
  createRedactor,
  describeDbTarget,
  MIN_DEMO_PASSWORD_LENGTH,
  parseDbUrl,
  PRODUCTION_PROJECT_REF,
  projectRefFromApiUrl,
  projectRefFromDbUrl,
  type StagingEnv,
} from "../../scripts/staging/guard";

// Made-up refs: 20 lowercase letters, like a real one.
const STAGING = "stagingstagingstagin";
const OTHER = "otherotherotherother";
const PROD = PRODUCTION_PROJECT_REF;

const DB_PASSWORD = "db-pass-not-real";
const apiUrl = (ref: string) => `https://${ref}.supabase.co`;
const poolerUrl = (ref: string) =>
  `postgresql://postgres.${ref}:${DB_PASSWORD}@aws-0-us-east-1.pooler.supabase.com:5432/postgres`;
const directUrl = (ref: string) => `postgresql://postgres:${DB_PASSWORD}@db.${ref}.supabase.co:5432/postgres`;

const goodEnv = (overrides: Partial<StagingEnv> = {}): StagingEnv => ({
  STAGING_SUPABASE_URL: apiUrl(STAGING),
  STAGING_DB_URL: poolerUrl(STAGING),
  STAGING_SERVICE_ROLE_KEY: "service-role-key-not-real",
  STAGING_DEMO_PASSWORD: "demo-password-16+chars",
  CONFIRM_STAGING_REF: STAGING,
  ...overrides,
});

function errorsOf(env: StagingEnv): string[] {
  const result = checkStagingTarget(env);
  expect(result.ok).toBe(false);
  return result.ok ? [] : result.errors;
}

describe("production project ref", () => {
  test("is the same ref the app guards against", () => {
    expect(PRODUCTION_PROJECT_REF).toBe(APP_PRODUCTION_PROJECT_REF);
  });
});

describe("projectRefFromApiUrl", () => {
  test("reads the ref from a hosted project URL", () => {
    expect(projectRefFromApiUrl(apiUrl(STAGING))).toBe(STAGING);
    expect(projectRefFromApiUrl(`  ${apiUrl(STAGING)}/  `)).toBe(STAGING);
    expect(projectRefFromApiUrl(apiUrl(PROD))).toBe(PROD);
  });

  test.each([
    ["missing", undefined],
    ["empty", ""],
    ["not a URL", "staging"],
    ["http", `http://${STAGING}.supabase.co`],
    ["custom domain", "https://api.example.com"],
    ["local emulator", "http://127.0.0.1:54331"],
    ["ref too short", "https://abc.supabase.co"],
    ["suffix trick", `https://${STAGING}.supabase.co.example.com`],
    ["prefix trick", `https://x.${STAGING}.supabase.co`],
    ["with a path", `https://${STAGING}.supabase.co/rest/v1`],
    ["with a port", `https://${STAGING}.supabase.co:8443`],
    ["with credentials", `https://user:pw@${STAGING}.supabase.co`],
    ["with a query", `https://${STAGING}.supabase.co/?x=1`],
  ])("refuses a URL that is %s", (_label, value) => {
    expect(projectRefFromApiUrl(value)).toBeNull();
  });
});

describe("projectRefFromDbUrl", () => {
  test("reads the ref from the session pooler user", () => {
    expect(projectRefFromDbUrl(poolerUrl(STAGING))).toBe(STAGING);
    expect(projectRefFromDbUrl(poolerUrl(PROD))).toBe(PROD);
  });

  test("reads the ref from the direct host", () => {
    expect(projectRefFromDbUrl(directUrl(STAGING))).toBe(STAGING);
    expect(projectRefFromDbUrl(directUrl(PROD))).toBe(PROD);
    expect(projectRefFromDbUrl(`postgres://postgres:${DB_PASSWORD}@db.${STAGING}.supabase.co/postgres`)).toBe(STAGING);
  });

  test("returns the parts used to connect, with the password decoded", () => {
    const parsed = parseDbUrl(
      `postgresql://postgres.${STAGING}:p%40ss%2Fword@AWS-0-EU-WEST-1.pooler.supabase.com:5432/postgres?sslmode=require`,
    );
    expect(parsed).toEqual({
      ok: true,
      db: {
        ref: STAGING,
        host: "aws-0-eu-west-1.pooler.supabase.com",
        port: 5432,
        user: `postgres.${STAGING}`,
        password: "p@ss/word",
        database: "postgres",
        via: "session pooler",
      },
    });
  });

  test.each([
    ["missing", undefined],
    ["empty", ""],
    ["not a URL", "postgres"],
    ["not postgres", `https://postgres:${DB_PASSWORD}@db.${STAGING}.supabase.co:5432/postgres`],
    ["an unknown host", `postgresql://postgres:${DB_PASSWORD}@db.example.com:5432/postgres`],
    ["localhost", `postgresql://postgres:${DB_PASSWORD}@127.0.0.1:5432/postgres`],
    ["a host suffix trick", `postgresql://postgres:${DB_PASSWORD}@db.${STAGING}.supabase.co.example.com:5432/postgres`],
    ["a pooler host without a ref in the user", `postgresql://postgres:${DB_PASSWORD}@aws-0-us-east-1.pooler.supabase.com:5432/postgres`],
    ["a pooler user that is not postgres.<ref>", `postgresql://app.${STAGING}:${DB_PASSWORD}@aws-0-us-east-1.pooler.supabase.com:5432/postgres`],
    ["a direct host with another project's pooler user", `postgresql://postgres.${OTHER}:${DB_PASSWORD}@db.${STAGING}.supabase.co:5432/postgres`],
    ["the transaction pooler", `postgresql://postgres.${STAGING}:${DB_PASSWORD}@aws-0-us-east-1.pooler.supabase.com:6543/postgres`],
    ["an unexpected port", `postgresql://postgres:${DB_PASSWORD}@db.${STAGING}.supabase.co:15432/postgres`],
    ["carrying an options parameter", `${poolerUrl(STAGING)}?options=reference%3D${PROD}`],
    ["without a password", `postgresql://postgres.${STAGING}@aws-0-us-east-1.pooler.supabase.com:5432/postgres`],
    ["still holding the placeholder", `postgresql://postgres.${STAGING}:[YOUR-PASSWORD]@aws-0-us-east-1.pooler.supabase.com:5432/postgres`],
    ["broken by an unencoded # in the password", `postgresql://postgres.${STAGING}:pa#ss@aws-0-us-east-1.pooler.supabase.com:5432/postgres`],
  ])("refuses a connection string that is %s", (_label, value) => {
    expect(projectRefFromDbUrl(value)).toBeNull();
    expect(parseDbUrl(value).ok).toBe(false);
  });

  test("never repeats the input in the reason", () => {
    const parsed = parseDbUrl(`postgresql://postgres:${DB_PASSWORD}@db.example.com:5432/postgres`);
    expect(parsed.ok).toBe(false);
    expect(JSON.stringify(parsed)).not.toContain(DB_PASSWORD);
    expect(JSON.stringify(parsed)).not.toContain("example.com");
  });
});

describe("checkStagingTarget", () => {
  test("accepts a staging API URL and session pooler string for the same, confirmed project", () => {
    const result = checkStagingTarget(goodEnv());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.target.ref).toBe(STAGING);
    expect(result.target.apiUrl).toBe(apiUrl(STAGING));
    expect(result.target.db).toMatchObject({ ref: STAGING, via: "session pooler", password: DB_PASSWORD });
    expect(result.target.anonKey).toBeNull();
    expect(result.target.dbCaCert).toBeNull();
  });

  test("accepts the direct connection string too", () => {
    const result = checkStagingTarget(goodEnv({ STAGING_DB_URL: directUrl(STAGING) }));
    expect(result.ok && result.target.db.via).toBe("direct connection");
  });

  test("passes the optional anon key through", () => {
    const result = checkStagingTarget(goodEnv({ STAGING_ANON_KEY: " anon-key " }));
    expect(result.ok && result.target.anonKey).toBe("anon-key");
  });

  test("refuses the production API URL", () => {
    const errors = errorsOf(goodEnv({ STAGING_SUPABASE_URL: apiUrl(PROD) }));
    expect(errors.join("\n")).toMatch(/STAGING_SUPABASE_URL is the PRODUCTION project/);
  });

  test("refuses the production database, pooler or direct", () => {
    for (const url of [poolerUrl(PROD), directUrl(PROD)]) {
      const errors = errorsOf(goodEnv({ STAGING_DB_URL: url }));
      expect(errors.join("\n")).toMatch(/STAGING_DB_URL is the PRODUCTION database/);
    }
  });

  test("refuses production even when everything agrees and it is confirmed by name", () => {
    const errors = errorsOf(
      goodEnv({ STAGING_SUPABASE_URL: apiUrl(PROD), STAGING_DB_URL: poolerUrl(PROD), CONFIRM_STAGING_REF: PROD }),
    );
    expect(errors).toHaveLength(3);
    expect(errors.every((e) => e.includes("PRODUCTION"))).toBe(true);
  });

  test("refuses an API URL and database that belong to different projects", () => {
    const errors = errorsOf(goodEnv({ STAGING_DB_URL: poolerUrl(OTHER) }));
    expect(errors.join("\n")).toMatch(/are different projects/);
  });

  test("refuses values it cannot parse", () => {
    expect(errorsOf(goodEnv({ STAGING_SUPABASE_URL: "https://api.example.com" })).join("\n")).toMatch(
      /STAGING_SUPABASE_URL must be exactly/,
    );
    expect(errorsOf(goodEnv({ STAGING_DB_URL: "postgresql://postgres:pw@db.example.com:5432/postgres" })).join("\n")).toMatch(
      /STAGING_DB_URL is not a Supabase Postgres connection string/,
    );
  });

  test("refuses when the confirmation is missing, wrong, or names production", () => {
    expect(errorsOf(goodEnv({ CONFIRM_STAGING_REF: undefined })).join("\n")).toMatch(/CONFIRM_STAGING_REF is not set/);
    expect(errorsOf(goodEnv({ CONFIRM_STAGING_REF: "  " })).join("\n")).toMatch(/CONFIRM_STAGING_REF is not set/);
    expect(errorsOf(goodEnv({ CONFIRM_STAGING_REF: OTHER })).join("\n")).toMatch(/CONFIRM_STAGING_REF does not match/);
    expect(errorsOf(goodEnv({ CONFIRM_STAGING_REF: "staging" })).join("\n")).toMatch(/CONFIRM_STAGING_REF does not match/);
    expect(errorsOf(goodEnv({ CONFIRM_STAGING_REF: PROD })).join("\n")).toMatch(/CONFIRM_STAGING_REF is the PRODUCTION/);
  });

  test("refuses a missing, short, or whitespace-padded demo password", () => {
    expect(errorsOf(goodEnv({ STAGING_DEMO_PASSWORD: undefined })).join("\n")).toMatch(/STAGING_DEMO_PASSWORD is not set/);
    expect(errorsOf(goodEnv({ STAGING_DEMO_PASSWORD: "x".repeat(MIN_DEMO_PASSWORD_LENGTH - 1) })).join("\n")).toMatch(
      /at least 16 characters/,
    );
    expect(errorsOf(goodEnv({ STAGING_DEMO_PASSWORD: `${"x".repeat(20)}\n` })).join("\n")).toMatch(/whitespace/);
    expect(checkStagingTarget(goodEnv({ STAGING_DEMO_PASSWORD: "x".repeat(MIN_DEMO_PASSWORD_LENGTH) })).ok).toBe(true);
  });

  test("refuses a missing service-role key", () => {
    expect(errorsOf(goodEnv({ STAGING_SERVICE_ROLE_KEY: "" })).join("\n")).toMatch(/STAGING_SERVICE_ROLE_KEY is not set/);
  });

  test("refuses an empty environment and lists every problem", () => {
    const errors = errorsOf({});
    expect(errors).toHaveLength(5);
  });

  test("error text never contains a secret value", () => {
    const secretEnv = goodEnv({
      STAGING_SUPABASE_URL: apiUrl(PROD),
      STAGING_DB_URL: `postgresql://postgres.${OTHER}:${DB_PASSWORD}@aws-0-us-east-1.pooler.supabase.com:6543/postgres`,
      STAGING_DEMO_PASSWORD: "short-secret",
      CONFIRM_STAGING_REF: OTHER,
    });
    const text = errorsOf(secretEnv).join("\n");
    for (const secret of [DB_PASSWORD, "short-secret", "service-role-key-not-real"]) {
      expect(text).not.toContain(secret);
    }
  });
});

describe("log safety", () => {
  test("describeDbTarget leaves the password out", () => {
    const parsed = parseDbUrl(poolerUrl(STAGING));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const text = describeDbTarget(parsed.db);
    expect(text).not.toContain(DB_PASSWORD);
    expect(text).toBe(`postgresql://postgres.${STAGING}:***@aws-0-us-east-1.pooler.supabase.com:5432/postgres (session pooler)`);
  });

  test("createRedactor blanks secrets, including URL-encoded forms", () => {
    const redact = createRedactor(["s3cr3t/key", undefined, null, ""]);
    expect(redact("key=s3cr3t/key; again s3cr3t%2Fkey.")).toBe("key=***; again ***.");
    expect(redact("nothing to hide")).toBe("nothing to hide");
  });
});
