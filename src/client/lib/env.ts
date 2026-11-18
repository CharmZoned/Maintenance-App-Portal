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

/** True when the URL belongs to the production project, however it is written. */
export function isProductionSupabaseUrl(url: string | undefined | null): boolean {
  return Boolean(url && url.toLowerCase().includes(PRODUCTION_PROJECT_REF));
}

/**
 * Staging tools (quick sign-in, ribbon) are allowed only when the build is
 * explicitly non-production AND the backend is not the production project.
 * Both must hold: either one alone is not enough.
 */
export function stagingToolsAllowed(
  env: AppEnv,
  supabaseUrl: string | undefined | null,
): boolean {
  return env !== "production" && !isProductionSupabaseUrl(supabaseUrl);
}

export const APP_ENV: AppEnv = resolveAppEnv(import.meta.env.VITE_APP_ENV);
export const isProduction = APP_ENV === "production";
export const STAGING_TOOLS_ALLOWED = stagingToolsAllowed(
  APP_ENV,
  import.meta.env.VITE_SUPABASE_URL,
);
