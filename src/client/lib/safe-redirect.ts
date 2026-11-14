import { parseRoute, type Route } from "../hooks/use-router";

/**
 * Post-login navigation helpers for `?redirect=` / `?intent=` (Phase 4b / WS-R).
 *
 * Security: only same-origin pathnames that `parseRoute` recognizes (plus intent
 * defaults). External absolute URLs, protocol-relative hosts, and scheme tricks
 * are rejected so login links cannot open-redirect.
 *
 * Signup / confirm (documented):
 * - Email confirmation uses a fixed `emailRedirectTo` of `{origin}/dashboard`
 *   in `use-auth` — it does **not** read `?redirect=` (avoids open redirects via
 *   confirmation mail).
 * - Password reset uses a fixed `{origin}/reset-password`.
 * - `?redirect=` is honored only when the auth gate becomes `ready` (approved +
 *   linked). Pending / unapproved / blocked users stay on the gate screens;
 *   after approval they sign in again (or Check again) and the param applies
 *   if still present on the URL.
 */

/** Portal audience for shell home / route clamps. */
export type PortalAudience = "staff" | "tenant" | "landlord";

/** Single source of role home paths (intent defaults + shell clamps + reset onDone). */
export const ROLE_HOME: Record<PortalAudience, string> = {
  staff: "/dashboard",
  tenant: "/maintenance",
  landlord: "/properties",
};

/** @deprecated Prefer ROLE_HOME — kept as alias for intent map clarity. */
export const INTENT_DEFAULTS = ROLE_HOME;

const INTENT_LABELS: Record<string, string> = {
  tenant: "Tenant sign-in",
  landlord: "Landlord sign-in",
  staff: "Staff and admin sign-in",
};

/** Login page subtitle for website `?intent=` branding. */
export function intentLoginLabel(intent: string | null | undefined): string {
  const key = intent?.trim().toLowerCase() ?? "";
  return INTENT_LABELS[key] ?? INTENT_LABELS.staff;
}

export function isTenantAllowedRoute(route: Route): boolean {
  return route.name === "maintenance" || route.name === "documents";
}

export function isLandlordAllowedRoute(route: Route): boolean {
  return (
    route.name === "properties" ||
    route.name === "property" ||
    route.name === "maintenance" ||
    route.name === "documents"
  );
}

/** Clamp a pathname to the audience shell (staff: no clamp). */
export function clampPathForAudience(pathname: string, audience: PortalAudience): string {
  const route = parseRoute(pathname);
  if (audience === "tenant") {
    return isTenantAllowedRoute(route) ? pathname : ROLE_HOME.tenant;
  }
  if (audience === "landlord") {
    return isLandlordAllowedRoute(route) ? pathname : ROLE_HOME.landlord;
  }
  return pathname;
}

/** True when pathname is a real portal route (same rules as the SPA router). */
function isAllowedPathname(pathname: string): boolean {
  if (pathname.includes("//")) return false;
  return parseRoute(pathname).name !== "not-found";
}

/**
 * Return a safe in-app pathname from a user-controlled redirect candidate, or null.
 * Accepts relative paths (`/maintenance`) or absolute same-origin URLs.
 */
export function safeInternalPath(
  candidate: string | null | undefined,
  origin: string,
): string | null {
  if (candidate == null) return null;
  // No trim-first: trailing/embedded whitespace must not be silently accepted.
  if (candidate.length === 0) return null;
  if (/[\0\r\n\t\v\f \\\u00a0]/.test(candidate) || /^\s|\s$/.test(candidate)) return null;

  // Reject non-http(s) schemes before URL parse (javascript:, data:, etc.).
  if (/^[a-zA-Z][a-zA-Z+\-.]*:/.test(candidate) && !/^https?:\/\//i.test(candidate)) {
    return null;
  }

  let url: URL;
  try {
    // Relative paths must be single-slash rooted; `//host` and `///host` are
    // protocol-relative and must not be resolved against our origin.
    if (candidate.startsWith("//")) return null;
    if (candidate.startsWith("/")) {
      url = new URL(candidate, origin);
    } else {
      url = new URL(candidate);
    }
  } catch {
    return null;
  }

  if (url.origin !== origin) return null;
  if (url.username || url.password) return null;

  const pathname = url.pathname;
  if (!pathname.startsWith("/") || pathname.startsWith("//")) return null;
  if (!isAllowedPathname(pathname)) return null;

  // Path only — router does not use search/hash for app routes.
  return pathname;
}

export type PostLoginParams = {
  redirect: string | null | undefined;
  intent?: string | null | undefined;
  origin: string;
};

/**
 * Resolve where to send the user after a successful login gate (`ready`).
 * Prefers a safe `redirect` param; otherwise maps website `intent` defaults;
 * returns null when neither applies (caller keeps current / role home).
 */
export function resolvePostLoginPath({
  redirect,
  intent,
  origin,
}: PostLoginParams): string | null {
  const fromRedirect = safeInternalPath(redirect, origin);
  if (fromRedirect) return fromRedirect;

  if (intent == null) return null;
  const key = intent.trim().toLowerCase();
  if (!key) return null;
  return ROLE_HOME[key as PortalAudience] ?? null;
}

/** Read redirect/intent from the current location search string. */
export function readLoginRedirectParams(
  search: string,
  origin: string,
): { target: string | null; hadParams: boolean } {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const hadParams = params.has("redirect") || params.has("intent");
  const target = resolvePostLoginPath({
    redirect: params.get("redirect"),
    intent: params.get("intent"),
    origin,
  });
  return { target, hadParams };
}

/** Strip redirect/intent from a search string; returns "" or "?…". */
export function stripLoginRedirectParams(search: string): string {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  const params = new URLSearchParams(raw);
  params.delete("redirect");
  params.delete("intent");
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export type ReadyLandingInput = {
  search: string;
  origin: string;
  pathname: string;
  audience: PortalAudience;
};

export type ReadyLanding = {
  path: string;
  search: string;
  /** True when URL path and/or login query params need a replace navigation. */
  shouldNavigate: boolean;
};

function normalizeSearch(search: string): string {
  if (!search) return "";
  return search.startsWith("?") ? search : `?${search}`;
}

/**
 * Single post-ready landing step: honor safe redirect/intent, strip those params,
 * then clamp to the audience shell — one replace navigation, no effect-order races.
 */
export function resolveReadyLanding({
  search,
  origin,
  pathname,
  audience,
}: ReadyLandingInput): ReadyLanding {
  const { target, hadParams } = readLoginRedirectParams(search, origin);
  const currentSearch = normalizeSearch(search);
  const nextSearch = hadParams ? stripLoginRedirectParams(search) : currentSearch;
  const desired = clampPathForAudience(target ?? pathname, audience);
  return {
    path: desired,
    search: nextSearch,
    shouldNavigate: desired !== pathname || nextSearch !== currentSearch,
  };
}
