/**
 * Which environment this build is running in.
 *
 * Set at build time with `VITE_APP_ENV`. Anything missing or unrecognised is
 * treated as production, so staging-only affordances can never switch on by
 * accident. See docs/adr/0006-one-click-role-sign-in.md.
 */
export type AppEnv = "production" | "staging" | "local";

/** Landlord Gopher production Supabase project. Staging tooling must never run against it. */
export const PRODUCTION_PROJECT_REF = "bgjkjtfgrfiszbzatriq";

export function resolveAppEnv(raw: string | undefined | null): AppEnv {
  const value = raw?.trim().toLowerCase();
  if (value === "staging" || value === "local") return value;
  return "production";
}

/** Lower-cased hostname of a URL, or null when it is missing or not a URL. */
function hostnameOf(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    return new URL(url.trim()).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** `<project-ref>.supabase.co` — the address every hosted project and branch has. */
const HOSTED_PROJECT_HOST = /^([a-z0-9]{20})\.supabase\.co$/;

/** True when the URL's host is the production project. */
export function isProductionSupabaseUrl(url: string | undefined | null): boolean {
  const host = hostnameOf(url);
  return host !== null && host.split(".")[0] === PRODUCTION_PROJECT_REF;
}

/**
 * True only when the backend is positively known not to be production: the
 * local emulator, or a hosted Supabase project other than the production one.
 *
 * Deny by default. A missing or malformed URL, or a host this does not
 * recognise (a custom domain, for instance, which could front production),
 * is not accepted.
 */
export function isKnownNonProductionBackend(url: string | undefined | null): boolean {
  const host = hostnameOf(url);
  if (host === null) return false;
  if (LOOPBACK_HOSTS.has(host)) return true;
  const match = HOSTED_PROJECT_HOST.exec(host);
  return match !== null && match[1] !== PRODUCTION_PROJECT_REF;
}

/**
 * Staging tools (quick sign-in, ribbon) are allowed only when the build is
 * explicitly non-production AND the backend is known not to be production.
 * Both must hold: either one alone is not enough.
 */
export function stagingToolsAllowed(
  env: AppEnv,
  supabaseUrl: string | undefined | null,
): boolean {
  return env !== "production" && isKnownNonProductionBackend(supabaseUrl);
}

export const APP_ENV: AppEnv = resolveAppEnv(import.meta.env.VITE_APP_ENV);
export const isProduction = APP_ENV === "production";
export const STAGING_TOOLS_ALLOWED = stagingToolsAllowed(
  APP_ENV,
  import.meta.env.VITE_SUPABASE_URL,
);
