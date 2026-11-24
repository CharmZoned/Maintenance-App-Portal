import type { UserAccountRow } from "@/lib/data";
import type { AppRole } from "@/types.supabase";

/** People-facing role names. "landlord" is "Owner" in the product. */
export const ROLE_LABEL: Record<AppRole, string> = {
  tenant: "Tenant",
  landlord: "Owner",
  maintenance: "Team member",
  admin: "Admin",
};

/** The record each role links to, as named on People. */
export const RECORD_LABEL: Record<Exclude<AppRole, "admin">, string> = {
  tenant: "Tenant",
  landlord: "Landlord",
  maintenance: "Team member",
};

export function roleNeedsRecord(role: AppRole): role is Exclude<AppRole, "admin"> {
  return role !== "admin";
}

/** Linked record id for a role on an account row. */
export function linkedIdFor(user: UserAccountRow, role: AppRole): number | null {
  if (role === "tenant") return user.tenant_id;
  if (role === "landlord") return user.landlord_id;
  if (role === "maintenance") return user.staff_id;
  return null;
}

/** True when the role row already points at its record (e.g. sign-up email matched). */
export function hasLinkedRecord(user: UserAccountRow): boolean {
  return user.role != null && roleNeedsRecord(user.role) && linkedIdFor(user, user.role) != null;
}

/**
 * The role the person most likely is. Their own sign-up choice wins; an
 * email-matched link comes next (the sign-up trigger already linked them);
 * an unmatched sign-up with no stated choice falls back to Tenant.
 */
export function suggestedRole(user: UserAccountRow): AppRole {
  if (hasLinkedRecord(user) && user.role) return user.role;
  if (user.intent_role) return user.intent_role;
  if (user.role === "admin") return "admin";
  return "tenant";
}

/** What the applicant told us, for the approval card. */
export function signupClaim(user: UserAccountRow): string {
  if (user.intent_role) return `Signed up as: ${ROLE_LABEL[user.intent_role]}`;
  if (hasLinkedRecord(user) && user.role) {
    return `Email matches an existing ${RECORD_LABEL[user.role as Exclude<AppRole, "admin">]} record`;
  }
  return "Signed up as: not stated";
}

export function displayName(user: Pick<UserAccountRow, "full_name" | "email">): string {
  return user.full_name?.trim() || user.email || "(no email)";
}

/** "Nina Q. Renter" → { first: "Nina Q.", last: "Renter" }; falls back to the email's local part. */
export function splitName(fullName: string | null | undefined, email: string | null | undefined) {
  const name = fullName?.trim();
  if (name) {
    const parts = name.split(/\s+/);
    if (parts.length === 1) return { first: parts[0], last: "" };
    return { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1] };
  }
  const local = (email ?? "").split("@")[0] ?? "";
  const bits = local.split(/[._-]+/).filter(Boolean);
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  return { first: bits[0] ? cap(bits[0]) : "", last: bits[1] ? cap(bits.slice(1).join(" ")) : "" };
}
