import { describe, expect, test } from "vitest";
import {
  clampPathForAudience,
  readLoginRedirectParams,
  resolvePostLoginPath,
  resolveReadyLanding,
  ROLE_HOME,
  safeInternalPath,
  stripLoginRedirectParams,
} from "@/lib/safe-redirect";

const ORIGIN = "https://portal.example.com";

describe("safeInternalPath", () => {
  test("allows relative portal paths", () => {
    expect(safeInternalPath("/dashboard", ORIGIN)).toBe("/dashboard");
    expect(safeInternalPath("/maintenance", ORIGIN)).toBe("/maintenance");
    expect(safeInternalPath("/properties/42", ORIGIN)).toBe("/properties/42");
    expect(safeInternalPath("/tenants/7", ORIGIN)).toBe("/tenants/7");
    expect(safeInternalPath("/", ORIGIN)).toBe("/");
  });

  test("allows same-origin absolute URLs (pathname only)", () => {
    expect(safeInternalPath("https://portal.example.com/rent", ORIGIN)).toBe("/rent");
    expect(safeInternalPath("https://portal.example.com/settings?x=1", ORIGIN)).toBe("/settings");
  });

  test("rejects external and protocol-relative open redirects", () => {
    expect(safeInternalPath("https://evil.com", ORIGIN)).toBeNull();
    expect(safeInternalPath("https://evil.com/phish", ORIGIN)).toBeNull();
    expect(safeInternalPath("//evil.com", ORIGIN)).toBeNull();
    expect(safeInternalPath("//evil.com/path", ORIGIN)).toBeNull();
    expect(safeInternalPath("///evil.com", ORIGIN)).toBeNull();
    expect(safeInternalPath("http://evil.com", ORIGIN)).toBeNull();
  });

  test("rejects schemes, credentials, and smuggled characters", () => {
    expect(safeInternalPath("javascript:alert(1)", ORIGIN)).toBeNull();
    expect(safeInternalPath("data:text/html,hi", ORIGIN)).toBeNull();
    expect(safeInternalPath("https://user:pass@portal.example.com/dashboard", ORIGIN)).toBeNull();
    expect(safeInternalPath("/dashboard\n", ORIGIN)).toBeNull();
    expect(safeInternalPath("/\\evil.com", ORIGIN)).toBeNull();
    expect(safeInternalPath(null, ORIGIN)).toBeNull();
    expect(safeInternalPath("   ", ORIGIN)).toBeNull();
  });

  test("rejects paths the SPA router does not recognize", () => {
    expect(safeInternalPath("/login", ORIGIN)).toBeNull();
    expect(safeInternalPath("/api/admin", ORIGIN)).toBeNull();
    expect(safeInternalPath("/reset-password", ORIGIN)).toBeNull();
    expect(safeInternalPath("/../etc/passwd", ORIGIN)).toBeNull();
    expect(safeInternalPath("/maintenance//evil.com", ORIGIN)).toBeNull();
    expect(safeInternalPath("/properties/1/edit", ORIGIN)).toBeNull();
    expect(safeInternalPath("/users/1", ORIGIN)).toBeNull();
    expect(safeInternalPath("/settings/%3Cscript%3E", ORIGIN)).toBeNull();
  });
});

describe("resolvePostLoginPath", () => {
  test("prefers safe redirect over intent", () => {
    expect(
      resolvePostLoginPath({
        redirect: "/properties",
        intent: "tenant",
        origin: ORIGIN,
      }),
    ).toBe("/properties");
  });

  test("falls back to intent defaults when redirect missing or unsafe", () => {
    expect(
      resolvePostLoginPath({ redirect: null, intent: "tenant", origin: ORIGIN }),
    ).toBe("/maintenance");
    expect(
      resolvePostLoginPath({ redirect: null, intent: "staff", origin: ORIGIN }),
    ).toBe("/dashboard");
    expect(
      resolvePostLoginPath({ redirect: null, intent: "landlord", origin: ORIGIN }),
    ).toBe("/properties");
    expect(
      resolvePostLoginPath({
        redirect: "https://evil.com",
        intent: "staff",
        origin: ORIGIN,
      }),
    ).toBe("/dashboard");
  });

  test("returns null when neither redirect nor intent applies", () => {
    expect(resolvePostLoginPath({ redirect: null, intent: null, origin: ORIGIN })).toBeNull();
    expect(
      resolvePostLoginPath({ redirect: "//evil.com", intent: "unknown", origin: ORIGIN }),
    ).toBeNull();
  });
});

describe("login redirect query helpers", () => {
  test("readLoginRedirectParams surfaces target and whether params were present", () => {
    expect(readLoginRedirectParams("?redirect=/rent&intent=staff", ORIGIN)).toEqual({
      target: "/rent",
      hadParams: true,
    });
    expect(readLoginRedirectParams("?intent=tenant", ORIGIN)).toEqual({
      target: "/maintenance",
      hadParams: true,
    });
    expect(readLoginRedirectParams("", ORIGIN)).toEqual({ target: null, hadParams: false });
    expect(readLoginRedirectParams("?redirect=https://evil.com", ORIGIN)).toEqual({
      target: null,
      hadParams: true,
    });
  });

  test("stripLoginRedirectParams removes only redirect and intent", () => {
    expect(stripLoginRedirectParams("?redirect=/rent&foo=1&intent=staff")).toBe("?foo=1");
    expect(stripLoginRedirectParams("?redirect=/rent")).toBe("");
    expect(stripLoginRedirectParams("")).toBe("");
  });
});

describe("clampPathForAudience / resolveReadyLanding", () => {
  test("tenant, landlord, and maintenance clamps match shell homes", () => {
    expect(clampPathForAudience("/dashboard", "tenant")).toBe(ROLE_HOME.tenant);
    expect(clampPathForAudience("/documents", "tenant")).toBe("/documents");
    expect(clampPathForAudience("/maintenance", "tenant")).toBe("/maintenance");
    expect(clampPathForAudience("/rent", "landlord")).toBe(ROLE_HOME.landlord);
    expect(clampPathForAudience("/properties/3", "landlord")).toBe("/properties/3");
    expect(clampPathForAudience("/documents", "landlord")).toBe("/documents");
    expect(clampPathForAudience("/rent", "staff")).toBe("/rent");
    expect(clampPathForAudience("/dashboard", "maintenance")).toBe(ROLE_HOME.maintenance);
    expect(clampPathForAudience("/rent", "maintenance")).toBe(ROLE_HOME.maintenance);
    expect(clampPathForAudience("/maintenance", "maintenance")).toBe("/maintenance");
    expect(clampPathForAudience("/calendar", "maintenance")).toBe("/calendar");
  });

  test("ready landing applies redirect then role clamp in one step", () => {
    expect(
      resolveReadyLanding({
        search: "?redirect=/documents",
        origin: ORIGIN,
        pathname: "/",
        audience: "tenant",
      }),
    ).toEqual({ path: "/documents", search: "", shouldNavigate: true });

    expect(
      resolveReadyLanding({
        search: "?redirect=/dashboard&intent=tenant",
        origin: ORIGIN,
        pathname: "/",
        audience: "tenant",
      }),
    ).toEqual({ path: ROLE_HOME.tenant, search: "", shouldNavigate: true });

    expect(
      resolveReadyLanding({
        search: "?intent=landlord",
        origin: ORIGIN,
        pathname: "/dashboard",
        audience: "landlord",
      }),
    ).toEqual({ path: ROLE_HOME.landlord, search: "", shouldNavigate: true });

    expect(
      resolveReadyLanding({
        search: "",
        origin: ORIGIN,
        pathname: "/maintenance",
        audience: "tenant",
      }),
    ).toEqual({ path: "/maintenance", search: "", shouldNavigate: false });

    expect(
      resolveReadyLanding({
        search: "?redirect=https://evil.com&foo=1",
        origin: ORIGIN,
        pathname: "/dashboard",
        audience: "staff",
      }),
    ).toEqual({ path: "/dashboard", search: "?foo=1", shouldNavigate: true });

    expect(
      resolveReadyLanding({
        search: "?intent=staff",
        origin: ORIGIN,
        pathname: "/dashboard",
        audience: "maintenance",
      }),
    ).toEqual({ path: ROLE_HOME.maintenance, search: "", shouldNavigate: true });
  });
});
