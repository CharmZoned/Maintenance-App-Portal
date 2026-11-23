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

/** Turn opaque auth/network failures into actionable staging/local guidance. */
export function formatDemoSignInError(err: unknown): string {
  const raw =
    err instanceof Error && err.message.trim()
      ? err.message.trim()
      : typeof err === "object" &&
          err !== null &&
          "message" in err &&
          typeof (err as { message: unknown }).message === "string" &&
          (err as { message: string }).message.trim()
        ? (err as { message: string }).message.trim()
        : "Sign-in failed";
  const lower = raw.toLowerCase();
  if (
    lower === "fetch failed" ||
    lower === "failed to fetch" ||
    lower.includes("network request failed") ||
    lower.includes("load failed")
  ) {
    return "Can't reach the auth backend (network). For local, use pnpm dev:local so the emulator is running; for staging, check VITE_SUPABASE_URL / anon key and that the project is up.";
  }
  if (lower.includes("invalid login credentials")) {
    return "Invalid login credentials — demo password may not match the seed, or demo accounts are missing. Set VITE_DEMO_PASSWORD to the seeded value, then run “Reset staging data” (or restart pnpm dev:local).";
  }
  return `${raw} — if the demo accounts are missing, run “Reset staging data” (or restart pnpm dev:local).`;
}
