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
  | { name: "documents" }
  | { name: "applications" }
  | { name: "users" }
  | { name: "settings" }
  | { name: "not-found" };

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
  if (path === "/documents") return { name: "documents" };
  if (path === "/applications") return { name: "applications" };
  if (path === "/users") return { name: "users" };
  if (path === "/settings") return { name: "settings" };
  return { name: "not-found" };
}

export type NavigateOptions = {
  /** Use history.replaceState instead of pushState. */
  replace?: boolean;
  /** Query string including `?`, or `""` to clear. Defaults to keeping current search when omitted. */
  search?: string;
};

export function useRouter() {
  const [path, setPath] = useState<string>(() => window.location.pathname);

  const navigate = useCallback((to: string, opts?: NavigateOptions) => {
    const search =
      opts?.search !== undefined
        ? opts.search
        : opts?.replace
          ? window.location.search
          : "";
    // replace: always sync React path (even when URL pathname already matches),
    // so callers that replaceState'd first (or pass replace) do not no-op.
    if (!opts?.replace && to === window.location.pathname) return;
    if (opts?.replace) {
      window.history.replaceState(null, "", `${to}${search}${window.location.hash}`);
    } else {
      window.history.pushState(null, "", to);
    }
    setPath(to);
  }, []);

  useEffect(() => {
    const handler = () => setPath(window.location.pathname);
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);

  return { path, route: parseRoute(path), navigate };
}
