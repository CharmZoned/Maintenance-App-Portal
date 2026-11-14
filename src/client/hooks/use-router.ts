import { useState, useEffect, useCallback } from "react";

export type Route =
  | { name: "dashboard" }
  | { name: "properties" }
  | { name: "property"; id: number }
  | { name: "landlords" }
  | { name: "tenants" }
  | { name: "tenant"; id: number }
  | { name: "leases" }
  | { name: "rent" }
  | { name: "maintenance" }
  | { name: "calendar" }
  | { name: "documents" }
  | { name: "applications" }
  | { name: "users" }
  | { name: "settings" }
  | { name: "not-found" };

export function splitLocation(to: string): { pathname: string; search: string } {
  const hashIdx = to.indexOf("#");
  const withoutHash = hashIdx >= 0 ? to.slice(0, hashIdx) : to;
  const qIdx = withoutHash.indexOf("?");
  const pathname = (qIdx >= 0 ? withoutHash.slice(0, qIdx) : withoutHash) || "/";
  const search = qIdx >= 0 ? withoutHash.slice(qIdx) : "";
  return { pathname, search };
}

/** Strip query/hash so route matching stays pathname-only. */
export function pathnameOf(to: string): string {
  return splitLocation(to).pathname;
}

/** Exported for WS-R safe-redirect + route clamps. */
export function parseRoute(path: string): Route {
  if (path === "/" || path === "/dashboard") return { name: "dashboard" };
  if (path === "/properties") return { name: "properties" };
  let m = path.match(/^\/properties\/(\d+)$/);
  if (m) return { name: "property", id: parseInt(m[1], 10) };
  if (path === "/landlords") return { name: "landlords" };
  if (path === "/tenants") return { name: "tenants" };
  m = path.match(/^\/tenants\/(\d+)$/);
  if (m) return { name: "tenant", id: parseInt(m[1], 10) };
  if (path === "/leases") return { name: "leases" };
  if (path === "/rent") return { name: "rent" };
  if (path === "/maintenance") return { name: "maintenance" };
  if (path === "/calendar") return { name: "calendar" };
  if (path === "/documents") return { name: "documents" };
  if (path === "/applications") return { name: "applications" };
  if (path === "/users") return { name: "users" };
  if (path === "/settings") return { name: "settings" };
  return { name: "not-found" };
}

export type NavigateOptions = {
  /** Use history.replaceState instead of pushState. Always syncs React path. */
  replace?: boolean;
  /**
   * Query string including `?`, or `""` to clear.
   * - When `replace: true` and omitted: keep the current search (WS-R).
   * - When pushing (default) and omitted: clear search (path-only URL).
   * - When provided: use this value (including `""`).
   * - Query embedded in `to` (`/x?y=1`) wins when `opts.search` is omitted.
   */
  search?: string;
};

function isSameAppPath(to: string): boolean {
  return to.startsWith("/") && !to.startsWith("//");
}

export function useRouter() {
  const [path, setPath] = useState<string>(() => window.location.pathname);
  const [search, setSearch] = useState<string>(() => window.location.search);

  const syncFromLocation = useCallback(() => {
    setPath(window.location.pathname);
    setSearch(window.location.search);
  }, []);

  const navigate = useCallback((to: string, opts?: NavigateOptions) => {
    if (!isSameAppPath(to)) return;
    const split = splitLocation(to);
    const nextPath = split.pathname;
    const nextSearch =
      opts?.search !== undefined
        ? opts.search
        : split.search
          ? split.search
          : opts?.replace
            ? window.location.search
            : "";
    // replace: always sync React path (even when URL pathname already matches),
    // so callers that replaceState'd first (or pass replace) do not no-op.
    if (
      !opts?.replace &&
      nextPath === window.location.pathname &&
      nextSearch === window.location.search
    ) {
      return;
    }
    const url = `${nextPath}${nextSearch}${opts?.replace ? window.location.hash : ""}`;
    if (opts?.replace) {
      window.history.replaceState(null, "", url);
    } else {
      window.history.pushState(null, "", `${nextPath}${nextSearch}`);
    }
    setPath(nextPath);
    setSearch(nextSearch);
  }, []);

  /** Convenience for calendar deep-links: replace with search taken from `to` ("" clears). */
  const replace = useCallback(
    (to: string) => {
      if (!isSameAppPath(to)) return;
      const { pathname, search: nextSearch } = splitLocation(to);
      navigate(pathname, { replace: true, search: nextSearch });
    },
    [navigate],
  );

  useEffect(() => {
    window.addEventListener("popstate", syncFromLocation);
    return () => window.removeEventListener("popstate", syncFromLocation);
  }, [syncFromLocation]);

  return { path, search, route: parseRoute(path), navigate, replace };
}
