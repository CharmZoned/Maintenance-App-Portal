/**
 * The `?from=` back-link contract (UX-09).
 *
 * A screen that opens a request page passes where it came from:
 *
 *   /maintenance/42?from=%2Fmaintenance%3Ftab%3Dactive%26q%3Dleak
 *
 * `from` is ONE query parameter holding the encoded path + query of the
 * opening screen (no origin, no hash). The request page's back link (read
 * side, workstream A) goes there and labels itself from it ("Back to
 * Calendar"); it must ignore anything that is not a same-app path, which
 * `readFromParam` already does.
 *
 * Writers: the admin queue, My jobs, the tenant / landlord lists, the
 * calendar, the dashboard and the property page.
 */

export const FROM_PARAM = "from";

/** The current screen's path + query, for `withFrom`. */
export function currentLocation(): string {
  if (typeof window === "undefined") return "/";
  return `${window.location.pathname}${window.location.search}`;
}

/** A same-app path ("/x", never "//host" or "/\\host"), else null. */
function safePath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return null;
  if (/[\u0000-\u001f]/.test(value)) return null;
  return value;
}

/** `href` with `?from=<from>` added (replacing any `from` already on it). */
export function withFrom(href: string, from: string = currentLocation()): string {
  const origin = safePath(from);
  if (!origin) return href;
  const hashAt = href.indexOf("#");
  const hash = hashAt >= 0 ? href.slice(hashAt) : "";
  const base = hashAt >= 0 ? href.slice(0, hashAt) : href;
  const queryAt = base.indexOf("?");
  const path = queryAt >= 0 ? base.slice(0, queryAt) : base;
  const params = new URLSearchParams(queryAt >= 0 ? base.slice(queryAt + 1) : "");
  params.set(FROM_PARAM, origin);
  return `${path}?${params.toString()}${hash}`;
}

/** The `from` path on a query string ("?from=…"), or null when absent or unsafe. */
export function readFromParam(search: string): string | null {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  return safePath(params.get(FROM_PARAM));
}

/** Names of the screens a request can be opened from, by path. */
const ORIGIN_LABELS: { test: (path: string) => boolean; label: string }[] = [
  { test: (p) => p === "/calendar", label: "Calendar" },
  { test: (p) => p === "/dashboard" || p === "/", label: "Dashboard" },
  { test: (p) => p === "/home", label: "Home" },
  { test: (p) => /^\/properties\/\d+$/.test(p), label: "Property" },
  { test: (p) => p === "/properties", label: "Properties" },
  { test: (p) => p === "/messages", label: "Messages" },
];

/**
 * "Calendar", "Dashboard", "Property" … for "Back to …"; null for the
 * maintenance list itself, whose name depends on the role (Maintenance /
 * My jobs / Requests) and stays with the request page.
 */
export function originLabel(from: string): string | null {
  const path = from.split(/[?#]/)[0] ?? "";
  return ORIGIN_LABELS.find((o) => o.test(path))?.label ?? null;
}
