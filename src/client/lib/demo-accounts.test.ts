import { describe, expect, it } from "vitest";
import {
  DEMO_ACCOUNTS,
  DEMO_ROLE_ORDER,
  homePathForDemoRole,
  parseDemoRole,
} from "./demo-accounts";
import { PERSONAS } from "../../../tests/emulator/seed";

describe("demo-accounts", () => {
  it("parses only the four quick-sign-in roles", () => {
    expect(parseDemoRole("admin")).toBe("admin");
    expect(parseDemoRole(" Tenant ")).toBe("tenant");
    expect(parseDemoRole("worker")).toBeNull();
    expect(parseDemoRole(null)).toBeNull();
  });

  it("keeps emails aligned with the emulator seed personas", () => {
    expect(DEMO_ACCOUNTS.admin.email).toBe(PERSONAS.admin.email);
    expect(DEMO_ACCOUNTS.landlord.email).toBe(PERSONAS.landlord.email);
    expect(DEMO_ACCOUNTS.tenant.email).toBe(PERSONAS.tenant.email);
    expect(DEMO_ACCOUNTS.maintenance.email).toBe(PERSONAS.worker.email);
  });

  it("routes each role to its portal home", () => {
    expect(homePathForDemoRole("admin")).toBe("/dashboard");
    expect(homePathForDemoRole("landlord")).toBe("/home");
    expect(homePathForDemoRole("tenant")).toBe("/home");
    expect(homePathForDemoRole("maintenance")).toBe("/maintenance");
  });

  it("lists four roles for the card and switcher", () => {
    expect(DEMO_ROLE_ORDER).toEqual(["admin", "landlord", "tenant", "maintenance"]);
  });
});
