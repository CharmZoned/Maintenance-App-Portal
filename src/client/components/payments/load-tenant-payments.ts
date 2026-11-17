import { supabase } from "@/lib/supabase";
import { listCharges } from "@/lib/data";
import { mapPayment } from "@/lib/mappers";
import type { Payment, RentCharge } from "@/types";
import type { Tables } from "@/types.supabase";
import {
  buildBalanceSummary,
  buildLedgerEntries,
  type BalanceSummary,
  type LedgerEntry,
  type TenantPaymentsProfile,
} from "./payments-model";

function throwSb(error: { message: string } | null): never {
  throw new Error(error?.message || "Supabase request failed");
}

const PAYMENT_ID_CHUNK = 100;

/** Live tenant profile fields for Payments chrome (RLS-scoped reads). */
export async function getTenantPaymentsProfile(): Promise<TenantPaymentsProfile | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: role, error: roleErr } = await supabase
    .from("user_roles")
    .select("tenant_id, role, account_status")
    .eq("user_id", user.id)
    .maybeSingle();
  if (roleErr) throwSb(roleErr);
  if (!role || role.role !== "tenant" || role.account_status !== "approved" || role.tenant_id == null) {
    return null;
  }

  const { data: tenant, error: tenantErr } = await supabase
    .from("Tenants")
    .select("id, unit_id, first_name, last_name")
    .eq("id", role.tenant_id)
    .single();
  if (tenantErr) throwSb(tenantErr);

  const tenantName = [tenant.first_name, tenant.last_name].filter(Boolean).join(" ") || null;

  if (!tenant.unit_id) {
    return {
      tenant_id: tenant.id,
      tenant_name: tenantName,
      unit_id: null,
      unit_label: null,
      property_id: null,
      property_name: null,
      street_address: null,
      late_fee_policy: null,
    };
  }

  const { data: unit, error: unitErr } = await supabase
    .from("Units")
    .select("id, unit_label, property_id")
    .eq("id", tenant.unit_id)
    .single();
  if (unitErr) throwSb(unitErr);

  let propertyName: string | null = null;
  let streetAddress: string | null = null;
  if (unit.property_id != null) {
    const { data: prop } = await supabase
      .from("Properties")
      .select("id, property_name, street_address")
      .eq("id", unit.property_id)
      .maybeSingle();
    propertyName = prop?.property_name ?? null;
    streetAddress = prop?.street_address ?? null;
  }

  let lateFeePolicy: number | null = null;
  const { data: lease } = await supabase
    .from("Leases")
    .select("late_fee, status")
    .eq("unit_id", unit.id)
    .eq("status", "active")
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lease?.late_fee != null) lateFeePolicy = Number(lease.late_fee);

  return {
    tenant_id: tenant.id,
    tenant_name: tenantName,
    unit_id: unit.id,
    unit_label: unit.unit_label,
    property_id: unit.property_id,
    property_name: propertyName,
    street_address: streetAddress,
    late_fee_policy: lateFeePolicy,
  };
}

/**
 * One (chunked) Payments query for many charges — avoids N+1 listPayments.
 * Groups client-side by charge_id.
 */
export async function listPaymentsForChargeIds(
  chargeIds: number[],
): Promise<Map<number, Payment[]>> {
  const map = new Map<number, Payment[]>();
  for (const id of chargeIds) map.set(id, []);
  if (chargeIds.length === 0) return map;

  for (let i = 0; i < chargeIds.length; i += PAYMENT_ID_CHUNK) {
    const chunk = chargeIds.slice(i, i + PAYMENT_ID_CHUNK);
    const { data, error } = await supabase
      .from("Payments")
      .select("*")
      .in("charge_id", chunk)
      .order("paid_at", { ascending: true });
    if (error) throwSb(error);
    for (const row of data ?? []) {
      const payment = mapPayment(row as Tables<"Payments">);
      const list = map.get(payment.charge_id) ?? [];
      list.push(payment);
      map.set(payment.charge_id, list);
    }
  }
  return map;
}

export interface TenantPaymentsSnapshot {
  profile: TenantPaymentsProfile | null;
  charges: RentCharge[];
  paymentsByCharge: Map<number, Payment[]>;
  summary: BalanceSummary;
  ledger: LedgerEntry[];
}

export type LoadTenantPaymentsOptions = {
  /**
   * When false (Pay rent), skip Payments fetch — summary only needs charges.
   * When true (ledger), batch-load payments once via `.in("charge_id", ids)`.
   */
  includeLedger?: boolean;
};

/**
 * Live ledger read for the signed-in tenant (RLS). Never records payments.
 * Pay/Zelle/Stripe/ACH initiation stays mocked in the UI.
 */
export async function loadTenantPaymentsSnapshot(
  opts: LoadTenantPaymentsOptions = {},
): Promise<TenantPaymentsSnapshot> {
  const includeLedger = opts.includeLedger ?? true;
  const [profile, charges] = await Promise.all([getTenantPaymentsProfile(), listCharges()]);

  const paymentsByCharge = includeLedger
    ? await listPaymentsForChargeIds(charges.map((c) => c.id))
    : new Map<number, Payment[]>();

  const summary = buildBalanceSummary(charges, profile);
  const ledger = includeLedger ? buildLedgerEntries(charges, paymentsByCharge) : [];

  return { profile, charges, paymentsByCharge, summary, ledger };
}
