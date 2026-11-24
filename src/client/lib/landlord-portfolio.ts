import { supabase } from "./supabase";
import { listUserAccounts, type UserAccountRow } from "./data";
import { portalStatusFromAccounts } from "./people-portal-status";
import { officeThreadKey } from "./office-messages";
import type { PortalStatusKind } from "@/components/people/portal-status";

/**
 * People → Landlords (LG-G): each landlord with their properties, unit count,
 * open requests and portal login.
 *
 * Admin only. Every read is one the existing RLS already gives an admin:
 * `Landlords`, `Properties`, `Units` and `MaintenanceRequests` select policies
 * all pass for `current_role() = 'admin'`. Admins cannot read other people's
 * `user_roles` rows directly, so the login (and its `landlord_id` link) comes
 * from the admin-only `list_user_accounts_for_admin` RPC, which raises for
 * anyone else.
 */

export interface LandlordPortfolioProperty {
  id: number;
  name: string;
  unit_count: number;
  open_requests: number;
}

export interface LandlordPortfolio {
  id: number;
  /** Company name when set, else "First Last". */
  name: string;
  first_name: string;
  last_name: string;
  company_name: string | null;
  email: string;
  phone: string | null;
  properties: LandlordPortfolioProperty[];
  unit_count: number;
  /** Requests on this landlord's properties that are not Closed. */
  open_requests: number;
  /** Auth user linked through `user_roles.landlord_id`; null when there is no login yet. */
  user_id: string | null;
  portal_status: PortalStatusKind;
}

const lower = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/** Request statuses that count as finished. Everything else is open. */
const CLOSED_STATUSES = new Set(["closed"]);

const STATUS_RANK: Record<string, number> = {
  approved: 0,
  pending: 1,
  suspended: 2,
  rejected: 3,
};

/** The login to message: prefer an approved account when several link the same landlord. */
function linkedAccount(accounts: UserAccountRow[], landlordId: number): UserAccountRow | null {
  const linked = accounts.filter((a) => a.role === "landlord" && a.landlord_id === landlordId);
  if (linked.length === 0) return null;
  return [...linked].sort(
    (a, b) => (STATUS_RANK[a.account_status] ?? 9) - (STATUS_RANK[b.account_status] ?? 9),
  )[0];
}

function throwIf(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

export async function listLandlordsWithPortfolio(): Promise<LandlordPortfolio[]> {
  // Accounts first: the RPC is the admin gate, so a non-admin fails here
  // before any other read.
  const accounts = await listUserAccounts();

  const [landlordsRes, propertiesRes, unitsRes, requestsRes] = await Promise.all([
    supabase
      .from("Landlords")
      .select("id, first_name, last_name, company_name, email, mobile_phone")
      .order("last_name"),
    supabase.from("Properties").select("id, landlord_id, property_name").order("property_name"),
    supabase.from("Units").select("id, property_id"),
    supabase.from("MaintenanceRequests").select("id, unit_id, property_id, status"),
  ]);
  throwIf(landlordsRes.error);
  throwIf(propertiesRes.error);
  throwIf(unitsRes.error);
  throwIf(requestsRes.error);

  const properties = propertiesRes.data ?? [];
  const units = unitsRes.data ?? [];
  const requests = requestsRes.data ?? [];

  const unitProperty = new Map(units.map((u) => [u.id, u.property_id]));
  const unitsByProperty = new Map<number, number>();
  for (const u of units) {
    unitsByProperty.set(u.property_id, (unitsByProperty.get(u.property_id) ?? 0) + 1);
  }

  const openByProperty = new Map<number, number>();
  for (const r of requests) {
    if (CLOSED_STATUSES.has(lower(r.status))) continue;
    // Common-area requests carry only property_id; unit requests may carry
    // just unit_id, so fall back to the unit's property.
    const propertyId = r.property_id ?? (r.unit_id != null ? unitProperty.get(r.unit_id) : undefined);
    if (propertyId == null) continue;
    openByProperty.set(propertyId, (openByProperty.get(propertyId) ?? 0) + 1);
  }

  const propsByLandlord = new Map<number, LandlordPortfolioProperty[]>();
  for (const p of properties) {
    const list = propsByLandlord.get(p.landlord_id) ?? [];
    list.push({
      id: p.id,
      name: p.property_name?.trim() || `Property ${p.id}`,
      unit_count: unitsByProperty.get(p.id) ?? 0,
      open_requests: openByProperty.get(p.id) ?? 0,
    });
    propsByLandlord.set(p.landlord_id, list);
  }

  const rows = (landlordsRes.data ?? []).map((l): LandlordPortfolio => {
    const props = propsByLandlord.get(l.id) ?? [];
    const account = linkedAccount(accounts, l.id);
    return {
      id: l.id,
      name: l.company_name?.trim() || `${l.first_name} ${l.last_name}`.trim(),
      first_name: l.first_name,
      last_name: l.last_name,
      company_name: l.company_name,
      email: l.email,
      phone: l.mobile_phone,
      properties: props,
      unit_count: props.reduce((n, p) => n + p.unit_count, 0),
      open_requests: props.reduce((n, p) => n + p.open_requests, 0),
      user_id: account?.user_id ?? null,
      portal_status: account
        ? portalStatusFromAccounts([account], { landlordId: l.id })
        : portalStatusFromAccounts(accounts, { landlordId: l.id, email: l.email }),
    };
  });
  // Sort by the name the admin sees (company name or person), not last name.
  return rows.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

/** Route for the admin's view of one landlord's office thread (plan §4). */
export function officeThreadHref(userId: string): string {
  return `/messages?thread=${officeThreadKey(userId)}`;
}
