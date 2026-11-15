import type { UserAccountRow } from "@/lib/data";
import type { PortalStatusKind } from "@/components/people/portal-status";

type AccountLike = Pick<
  UserAccountRow,
  "email" | "account_status" | "tenant_id" | "landlord_id" | "staff_id"
>;

export type PortalEntityLink = {
  email?: string | null;
  tenantId?: number | null;
  landlordId?: number | null;
  staffId?: number | null;
};

/**
 * Resolve portal chip for a directory row.
 * Prefer the account linked by entity id (tenant/landlord/staff), then fall back to email.
 */
export function portalStatusFromAccounts(
  accounts: AccountLike[],
  link: PortalEntityLink,
): PortalStatusKind {
  let row: AccountLike | undefined;
  if (link.tenantId != null) {
    row = accounts.find((a) => a.tenant_id === link.tenantId);
  } else if (link.landlordId != null) {
    row = accounts.find((a) => a.landlord_id === link.landlordId);
  } else if (link.staffId != null) {
    row = accounts.find((a) => a.staff_id === link.staffId);
  }
  if (!row && link.email) {
    const email = link.email.toLowerCase();
    row = accounts.find((a) => a.email?.toLowerCase() === email);
  }
  if (!row) return "not_invited";
  if (row.account_status === "approved") return "active";
  if (row.account_status === "suspended") return "suspended";
  if (row.account_status === "pending") return "pending";
  if (row.account_status === "rejected") return "rejected";
  return "not_invited";
}
