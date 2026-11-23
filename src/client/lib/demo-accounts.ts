/**
 * Demo personas for staging / local quick sign-in.
 * Emails must stay in sync with `tests/emulator/seed.ts` PERSONAS.
 */
import { ROLE_HOME, type PortalAudience } from "./safe-redirect";
import type { AppRole } from "../types.supabase";

export type DemoRoleKey = "admin" | "landlord" | "tenant" | "maintenance";

export type DemoAccount = {
  role: AppRole;
  email: string;
  /** Short button title */
  roleLabel: string;
  /** Persona name shown on the button */
  name: string;
  /** What they can see / who they are */
  blurb: string;
  /** Portal audience for home routing */
  audience: PortalAudience;
};

export const DEMO_ACCOUNTS: Record<DemoRoleKey, DemoAccount> = {
  admin: {
    role: "admin",
    email: "admin@test.local",
    roleLabel: "Admin",
    name: "Ada Admin",
    blurb: "operations manager",
    audience: "staff",
  },
  landlord: {
    role: "landlord",
    email: "landlord@test.local",
    roleLabel: "Landlord",
    name: "Lena Owner",
    blurb: "Maple Court",
    audience: "landlord",
  },
  tenant: {
    role: "tenant",
    email: "tenant@test.local",
    roleLabel: "Tenant",
    name: "Tina Renter",
    blurb: "Unit 1A",
    audience: "tenant",
  },
  maintenance: {
    role: "maintenance",
    email: "worker@test.local",
    roleLabel: "Maintenance",
    name: "Sam Fixit",
    blurb: "technician",
    audience: "maintenance",
  },
};

/** Button order on the quick sign-in card and role switcher. */
export const DEMO_ROLE_ORDER: DemoRoleKey[] = [
  "admin",
  "landlord",
  "tenant",
  "maintenance",
];

export function parseDemoRole(raw: string | null | undefined): DemoRoleKey | null {
  const value = raw?.trim().toLowerCase();
  if (value === "admin" || value === "landlord" || value === "tenant" || value === "maintenance") {
    return value;
  }
  return null;
}

export function homePathForDemoRole(role: DemoRoleKey): string {
  return ROLE_HOME[DEMO_ACCOUNTS[role].audience];
}

/** Demo password from the build env — never hardcoded. */
export function demoPassword(): string | undefined {
  const value = import.meta.env.VITE_DEMO_PASSWORD?.trim();
  return value || undefined;
}
