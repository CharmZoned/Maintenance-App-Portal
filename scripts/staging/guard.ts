/**
 * Target guard for the staging reset (docs/adr/0007, docs/adr/0006 guard 4).
 *
 * Pure functions: no I/O, no imports. `checkStagingTarget` is evaluated before
 * any connection is opened, and everything that later connects uses only the
 * values it returns - never the raw environment strings - so what was checked
 * is exactly what is contacted.
 *
 * Deny by default: anything this module does not positively recognise as a
 * hosted Supabase project other than production is refused.
 */

/**
 * The production Supabase project. Kept here as a literal because
 * `src/client/lib/env.ts` reads `import.meta.env` and cannot be imported under
 * tsx; tests/unit/staging-seed-guard.test.ts asserts the two stay equal.
 */
export const PRODUCTION_PROJECT_REF = "bgjkjtfgrfiszbzatriq";

/**
 * The staging Supabase project (a persistent branch of production), the only
 * project the reset and rebuild will ever touch. Allow-list, not deny-list: a
 * third project, or a typo that happens to be a valid ref, is refused too.
 * tests/unit/staging-seed-guard.test.ts asserts it equals `[remotes.staging]
 * project_id` in supabase/config.toml, so changing staging means changing both.
 */
export const STAGING_PROJECT_REF = "gzwcegtwzzhtstgzphaw";

/** Why a ref that is well-formed and not production is still refused. Null when it is the staging project. */
export function notStagingReason(label: string, ref: string): string | null {
  if (ref === STAGING_PROJECT_REF) return null;
  return (
    `${label} names project ${ref}, which is not the staging project (${STAGING_PROJECT_REF}). ` +
    "If staging has moved, update STAGING_PROJECT_REF in scripts/staging/guard.ts and [remotes.staging] in supabase/config.toml."
  );
}

export const MIN_DEMO_PASSWORD_LENGTH = 16;

/** The only database port accepted: direct connections and the session pooler. */
const SESSION_PORT = 5432;
/** Transaction-mode poolers. Refused: the reset needs one real session. */
const TRANSACTION_PORT = 6543;

const API_HOST = /^([a-z0-9]{20})\.supabase\.co$/;
const DIRECT_DB_HOST = /^db\.([a-z0-9]{20})\.supabase\.co$/;
const POOLER_DB_HOST = /^[a-z0-9-]+\.pooler\.supabase\.com$/;
const POOLER_USER = /^postgres\.([a-z0-9]{20})$/;
const DATABASE_NAME = /^[A-Za-z0-9_]+$/;

export interface DbTarget {
  ref: string;
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  via: "session pooler" | "direct connection";
}

export type DbUrlResult = { ok: true; db: DbTarget } | { ok: false; reason: string };

function parseUrl(raw: string | undefined | null): URL | null {
  const value = raw?.trim();
  if (!value) return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function decode(part: string): string | null {
  try {
    return decodeURIComponent(part);
  } catch {
    return null;
  }
}

/**
 * Project ref of a hosted Supabase API URL: exactly `https://<ref>.supabase.co`.
 * Null for anything else (custom domains, paths, ports, credentials, http).
 */
export function projectRefFromApiUrl(raw: string | undefined | null): string | null {
  const url = parseUrl(raw);
  if (!url || url.protocol !== "https:") return null;
  if (url.username || url.password || url.port || url.search || url.hash) return null;
  if (url.pathname !== "/" && url.pathname !== "") return null;
  return API_HOST.exec(url.hostname.toLowerCase())?.[1] ?? null;
}

/**
 * Parse a Supabase Postgres connection string into the parts used to connect.
 *
 * Accepted shapes (both on port 5432):
 *   session pooler  postgresql://postgres.<ref>:<pw>@<region>.pooler.supabase.com:5432/postgres
 *   direct          postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres
 *
 * The reasons returned never contain any part of the input.
 */
export function parseDbUrl(raw: string | undefined | null): DbUrlResult {
  const fail = (reason: string): DbUrlResult => ({ ok: false, reason });
  const unparseable =
    "is not a Supabase Postgres connection string. Copy the Session pooler string from the " +
    "dashboard's Connect panel. If the database password contains any of / ? # % it must be " +
    "percent-encoded (or reset it to letters and digits only).";

  const url = parseUrl(raw);
  if (!url) return fail(unparseable);
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") return fail(unparseable);
  if (url.hash) return fail(unparseable);
  // `options=reference=<ref>` is a second way to name the pooler tenant; no
  // parameter other than sslmode is accepted, so the ref has a single source.
  for (const key of url.searchParams.keys()) {
    if (key !== "sslmode") return fail(`has an unsupported "${key}" parameter. Remove everything after the database name.`);
  }

  const host = url.hostname.toLowerCase();
  const user = decode(url.username);
  const password = decode(url.password);
  const database = url.pathname === "" || url.pathname === "/" ? "postgres" : decode(url.pathname.slice(1));
  if (user === null || password === null || database === null) return fail(unparseable);
  if (!DATABASE_NAME.test(database)) return fail(unparseable);
  if (password === "") return fail("has no database password in it.");
  if (/^\[your-password\]$/i.test(password)) {
    return fail("still contains the [YOUR-PASSWORD] placeholder. Replace it with the database password.");
  }

  const port = url.port === "" ? SESSION_PORT : Number(url.port);
  if (port === TRANSACTION_PORT) {
    return fail("points at a transaction pooler (port 6543). Use the Session pooler string (port 5432).");
  }
  if (port !== SESSION_PORT) return fail(unparseable);

  let ref: string;
  let via: DbTarget["via"];
  const direct = DIRECT_DB_HOST.exec(host);
  if (direct) {
    ref = direct[1];
    via = "direct connection";
    // A pooler-style user on a direct host must not name a different project.
    if (user !== "postgres" && user !== `postgres.${ref}`) return fail(unparseable);
  } else if (POOLER_DB_HOST.test(host)) {
    const tenant = POOLER_USER.exec(user);
    if (!tenant) {
      return fail("uses a pooler host but its user is not postgres.<project-ref>. Copy the Session pooler string.");
    }
    ref = tenant[1];
    via = "session pooler";
  } else {
    return fail(unparseable);
  }

  return { ok: true, db: { ref, host, port, user, password, database, via } };
}

/** Project ref a database connection string targets, or null when it cannot be determined. */
export function projectRefFromDbUrl(raw: string | undefined | null): string | null {
  const parsed = parseDbUrl(raw);
  return parsed.ok ? parsed.db.ref : null;
}

/** The environment variables the seed reads. Nothing else is consulted. */
export interface StagingEnv {
  STAGING_SUPABASE_URL?: string;
  STAGING_SERVICE_ROLE_KEY?: string;
  STAGING_DB_URL?: string;
  STAGING_DEMO_PASSWORD?: string;
  CONFIRM_STAGING_REF?: string;
  /** Optional: publishable/anon key, enables the sign-in check after seeding. */
  STAGING_ANON_KEY?: string;
  /** Optional: Supabase CA certificate (PEM), enables full certificate verification. */
  STAGING_DB_CA_CERT?: string;
}

export interface StagingTarget {
  ref: string;
  /** Rebuilt from the ref, not copied from the environment. */
  apiUrl: string;
  db: DbTarget;
  serviceRoleKey: string;
  demoPassword: string;
  anonKey: string | null;
  dbCaCert: string | null;
}

export type GuardResult = { ok: true; target: StagingTarget } | { ok: false; errors: string[] };

/**
 * Decide whether the environment names a safe target. Returns every problem
 * found, not just the first. Error text never includes a secret value.
 */
export function checkStagingTarget(env: StagingEnv): GuardResult {
  const errors: string[] = [];

  const apiRef = projectRefFromApiUrl(env.STAGING_SUPABASE_URL);
  if (!env.STAGING_SUPABASE_URL?.trim()) {
    errors.push("STAGING_SUPABASE_URL is not set.");
  } else if (apiRef === null) {
    errors.push("STAGING_SUPABASE_URL must be exactly https://<project-ref>.supabase.co (the Project URL).");
  } else if (apiRef === PRODUCTION_PROJECT_REF) {
    errors.push("STAGING_SUPABASE_URL is the PRODUCTION project. This script never runs against production.");
  } else {
    const reason = notStagingReason("STAGING_SUPABASE_URL", apiRef);
    if (reason) errors.push(reason);
  }

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

  if (apiRef !== null && db !== null && apiRef !== db.ref) {
    errors.push(
      `STAGING_SUPABASE_URL (project ${apiRef}) and STAGING_DB_URL (project ${db.ref}) are different projects.`,
    );
  }

  const confirm = env.CONFIRM_STAGING_REF?.trim() ?? "";
  if (confirm === "") {
    errors.push("CONFIRM_STAGING_REF is not set. Type the staging project ref to confirm the target.");
  } else if (confirm === PRODUCTION_PROJECT_REF) {
    errors.push("CONFIRM_STAGING_REF is the PRODUCTION project ref. This script never runs against production.");
  } else if (apiRef !== null && db !== null && apiRef === db.ref && confirm !== apiRef) {
    errors.push(`CONFIRM_STAGING_REF does not match the configured staging project (${apiRef}).`);
  }

  const serviceRoleKey = env.STAGING_SERVICE_ROLE_KEY?.trim() ?? "";
  if (serviceRoleKey === "") errors.push("STAGING_SERVICE_ROLE_KEY is not set.");

  const demoPassword = env.STAGING_DEMO_PASSWORD ?? "";
  if (demoPassword === "") {
    errors.push("STAGING_DEMO_PASSWORD is not set.");
  } else if (demoPassword !== demoPassword.trim()) {
    errors.push("STAGING_DEMO_PASSWORD starts or ends with whitespace (often a stray newline). Re-enter it.");
  } else if (demoPassword.length < MIN_DEMO_PASSWORD_LENGTH) {
    errors.push(`STAGING_DEMO_PASSWORD must be at least ${MIN_DEMO_PASSWORD_LENGTH} characters.`);
  }

  // Unreachable unless a branch above is edited incorrectly; kept so that a
  // successful result can never carry the production ref.
  if (errors.length === 0 && (apiRef === PRODUCTION_PROJECT_REF || db?.ref === PRODUCTION_PROJECT_REF)) {
    errors.push("Refusing to target the production project.");
  }
  if (errors.length === 0 && (apiRef !== STAGING_PROJECT_REF || db?.ref !== STAGING_PROJECT_REF)) {
    errors.push("Refusing to target anything but the staging project.");
  }

  if (errors.length > 0 || apiRef === null || db === null) {
    return { ok: false, errors: errors.length > 0 ? errors : ["The staging target could not be determined."] };
  }

  return {
    ok: true,
    target: {
      ref: apiRef,
      apiUrl: `https://${apiRef}.supabase.co`,
      db,
      serviceRoleKey,
      demoPassword,
      anonKey: env.STAGING_ANON_KEY?.trim() || null,
      dbCaCert: env.STAGING_DB_CA_CERT?.trim() || null,
    },
  };
}

/** The database target with the password removed, safe to log. */
export function describeDbTarget(db: DbTarget): string {
  return `postgresql://${db.user}:***@${db.host}:${db.port}/${db.database} (${db.via})`;
}

/**
 * Returns a function that blanks every occurrence of the given secret values
 * (and their URL-encoded forms) in a string. All script output passes through it.
 */
export function createRedactor(secrets: Array<string | null | undefined>): (text: string) => string {
  const needles = new Set<string>();
  for (const secret of secrets) {
    if (!secret) continue;
    needles.add(secret);
    needles.add(encodeURIComponent(secret));
  }
  const ordered = [...needles].sort((a, b) => b.length - a.length);
  return (text) => ordered.reduce((out, needle) => out.split(needle).join("***"), text);
}
