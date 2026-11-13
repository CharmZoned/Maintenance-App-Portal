import { supabase } from "./supabase";
import {
  mapLandlord,
  mapProperty,
  mapUnit,
  mapTenant,
  mapLease,
  mapCharge,
  mapPayment,
  mapVendor,
  mapWorkOrder,
  propertyToInsert,
  unitStatusToDb,
  workOrderStatusToDb,
  workOrderPriorityToDb,
} from "./mappers";
import type {
  Landlord,
  Property,
  Unit,
  Tenant,
  Lease,
  RentCharge,
  Payment,
  Vendor,
  WorkOrder,
  NewProperty,
  NewUnit,
  NewTenant,
  NewLease,
  NewWorkOrder,
  NewVendor,
  NewLandlord,
  DashboardSummary,
  UnitStatus,
  WorkOrderStatus,
} from "../types";

function throwSb(error: { message: string } | null): never {
  throw new Error(error?.message || "Supabase request failed");
}

async function assertOk<T>(result: { data: T; error: { message: string } | null }): Promise<T> {
  if (result.error) throwSb(result.error);
  return result.data;
}

// ── Landlords ─────────────────────────────────────────────────────

export async function listLandlords(): Promise<Landlord[]> {
  const { data, error } = await supabase.from("Landlords").select("*").order("last_name");
  if (error) throwSb(error);
  return (data ?? []).map(mapLandlord);
}

export async function getLandlord(id: number): Promise<Landlord> {
  const { data, error } = await supabase.from("Landlords").select("*").eq("id", id).single();
  if (error) throwSb(error);
  return mapLandlord(data!);
}

export async function createLandlord(input: NewLandlord): Promise<Landlord> {
  const { data, error } = await supabase
    .from("Landlords")
    .insert({
      first_name: input.first_name,
      last_name: input.last_name,
      email: input.email,
      company_name: input.company_name ?? null,
      mobile_phone: input.phone ?? null,
      preferred_contact: input.preferred_contact ?? null,
      notes: input.notes ?? null,
    })
    .select("*")
    .single();
  if (error) throwSb(error);
  return mapLandlord(data!);
}

export async function updateLandlord(id: number, patch: Partial<NewLandlord>): Promise<Landlord> {
  const row: Record<string, unknown> = {};
  if (patch.first_name !== undefined) row.first_name = patch.first_name;
  if (patch.last_name !== undefined) row.last_name = patch.last_name;
  if (patch.email !== undefined) row.email = patch.email;
  if (patch.company_name !== undefined) row.company_name = patch.company_name;
  if (patch.phone !== undefined) row.mobile_phone = patch.phone;
  if (patch.preferred_contact !== undefined) row.preferred_contact = patch.preferred_contact;
  if (patch.notes !== undefined) row.notes = patch.notes;
  const { data, error } = await supabase.from("Landlords").update(row as never).eq("id", id).select("*").single();
  if (error) throwSb(error);
  return mapLandlord(data!);
}

export async function deleteLandlord(id: number): Promise<void> {
  const { error } = await supabase.from("Landlords").delete().eq("id", id);
  if (error) throwSb(error);
}

// ── Properties ────────────────────────────────────────────────────

export async function listProperties(): Promise<Property[]> {
  const [{ data: props, error: pErr }, { data: units, error: uErr }, { data: landlords, error: lErr }] =
    await Promise.all([
      supabase.from("Properties").select("*").order("property_name"),
      supabase.from("Units").select("id, property_id, status"),
      supabase.from("Landlords").select("id, first_name, last_name, company_name"),
    ]);
  if (pErr) throwSb(pErr);
  if (uErr) throwSb(uErr);
  if (lErr) throwSb(lErr);

  const landlordName = new Map(
    (landlords ?? []).map((l) => [
      l.id,
      l.company_name?.trim() || `${l.first_name} ${l.last_name}`.trim(),
    ]),
  );

  return (props ?? []).map((p) => {
    const punits = (units ?? []).filter((u) => u.property_id === p.id);
    const occupied = punits.filter((u) => lower(u.status) === "occupied").length;
    return mapProperty(p, {
      unit_count: punits.length,
      occupied_count: occupied,
      landlord_name: landlordName.get(p.landlord_id) ?? null,
    });
  });
}

function lower(s: string): string {
  return s.trim().toLowerCase();
}

export async function getProperty(id: number): Promise<Property> {
  const { data, error } = await supabase.from("Properties").select("*").eq("id", id).single();
  if (error) throwSb(error);
  let landlord_name: string | null = null;
  if (data!.landlord_id) {
    const { data: l } = await supabase
      .from("Landlords")
      .select("first_name, last_name, company_name")
      .eq("id", data!.landlord_id)
      .maybeSingle();
    if (l) landlord_name = l.company_name?.trim() || `${l.first_name} ${l.last_name}`.trim();
  }
  const { data: units } = await supabase.from("Units").select("id, status").eq("property_id", id);
  const occupied = (units ?? []).filter((u) => lower(u.status) === "occupied").length;
  return mapProperty(data!, {
    unit_count: units?.length ?? 0,
    occupied_count: occupied,
    landlord_name,
  });
}

export async function createProperty(input: NewProperty): Promise<Property> {
  if (!input.landlord_id) throw new Error("landlord_id is required");
  const row = propertyToInsert({
    name: input.name,
    type: input.type,
    address: input.address,
    city: input.city,
    state: input.state,
    zip: input.zip,
    year_built: input.year_built,
    notes: input.notes,
    color: input.color,
    landlord_id: input.landlord_id,
  });
  const { data, error } = await supabase.from("Properties").insert(row).select("*").single();
  if (error) throwSb(error);
  return mapProperty(data!);
}

export async function updateProperty(id: number, patch: Partial<NewProperty>): Promise<Property> {
  const row: Record<string, unknown> = {};
  if (patch.name !== undefined) row.property_name = patch.name;
  if (patch.type !== undefined) row.property_type = patch.type;
  if (patch.address !== undefined) row.street_address = patch.address?.trim() || "TBD";
  if (patch.city !== undefined) row.city = patch.city?.trim() || "TBD";
  if (patch.state !== undefined) row.state = patch.state?.trim() || "MD";
  if (patch.zip !== undefined) row.zip = patch.zip?.trim() || "00000";
  if (patch.year_built !== undefined) row.year_built = patch.year_built;
  if (patch.notes !== undefined) row.notes = patch.notes;
  if (patch.color !== undefined) row.color = patch.color;
  if (patch.landlord_id !== undefined) {
    if (!patch.landlord_id) throw new Error("landlord_id is required");
    row.landlord_id = patch.landlord_id;
  }
  const { data, error } = await supabase.from("Properties").update(row as never).eq("id", id).select("*").single();
  if (error) throwSb(error);
  return mapProperty(data!);
}

export async function deleteProperty(id: number): Promise<void> {
  const { error } = await supabase.from("Properties").delete().eq("id", id);
  if (error) throwSb(error);
}

// ── Units ─────────────────────────────────────────────────────────

export async function listUnits(propertyId?: number): Promise<Unit[]> {
  let q = supabase.from("Units").select("*").order("unit_label");
  if (propertyId) q = q.eq("property_id", propertyId);
  const { data: units, error } = await q;
  if (error) throwSb(error);

  const propIds = [...new Set((units ?? []).map((u) => u.property_id))];
  const { data: props } = propIds.length
    ? await supabase.from("Properties").select("id, property_name, color, street_address, city").in("id", propIds)
    : { data: [] as { id: number; property_name: string | null; color: string; street_address: string; city: string }[] };

  const propMap = new Map((props ?? []).map((p) => [p.id, p]));

  const unitIds = (units ?? []).map((u) => u.id);
  const { data: leases } = unitIds.length
    ? await supabase
        .from("Leases")
        .select("id, unit_id, primary_tenant_id, status")
        .in("unit_id", unitIds)
        .eq("status", "active")
    : { data: [] as { id: number; unit_id: number; primary_tenant_id: number | null; status: string }[] };

  const leaseByUnit = new Map((leases ?? []).map((l) => [l.unit_id, l]));
  const tenantIds = [...new Set((leases ?? []).map((l) => l.primary_tenant_id).filter(Boolean))] as number[];
  const { data: tenants } = tenantIds.length
    ? await supabase.from("Tenants").select("id, first_name, last_name").in("id", tenantIds)
    : { data: [] as { id: number; first_name: string; last_name: string }[] };
  const tenantMap = new Map((tenants ?? []).map((t) => [t.id, t]));

  return (units ?? []).map((u) => {
    const p = propMap.get(u.property_id);
    const lease = leaseByUnit.get(u.id);
    const t = lease?.primary_tenant_id ? tenantMap.get(lease.primary_tenant_id) : undefined;
    return mapUnit(u, {
      property_name: p?.property_name,
      property_color: p?.color,
      property_address: p?.street_address,
      property_city: p?.city,
      active_lease_id: lease?.id ?? null,
      active_tenant_name: t ? `${t.first_name} ${t.last_name}` : null,
    });
  });
}

export async function createUnit(input: NewUnit): Promise<Unit> {
  const { data, error } = await supabase
    .from("Units")
    .insert({
      property_id: input.property_id,
      unit_label: input.name,
      bedrooms: input.bedrooms ?? 1,
      bathrooms: input.bathrooms ?? 1,
      sqft: input.sqft ?? null,
      market_rent: input.market_rent ?? 0,
      status: unitStatusToDb((input.status as UnitStatus) ?? "vacant"),
      notes: input.notes ?? null,
    })
    .select("*")
    .single();
  if (error) throwSb(error);
  return mapUnit(data!);
}

export async function updateUnit(id: number, patch: Partial<NewUnit>): Promise<Unit> {
  const row: Record<string, unknown> = {};
  if (patch.name !== undefined) row.unit_label = patch.name;
  if (patch.property_id !== undefined) row.property_id = patch.property_id;
  if (patch.bedrooms !== undefined) row.bedrooms = patch.bedrooms;
  if (patch.bathrooms !== undefined) row.bathrooms = patch.bathrooms;
  if (patch.sqft !== undefined) row.sqft = patch.sqft;
  if (patch.market_rent !== undefined) row.market_rent = patch.market_rent;
  if (patch.status !== undefined) row.status = unitStatusToDb(patch.status as UnitStatus);
  if (patch.notes !== undefined) row.notes = patch.notes;
  const { data, error } = await supabase.from("Units").update(row as never).eq("id", id).select("*").single();
  if (error) throwSb(error);
  return mapUnit(data!);
}

export async function deleteUnit(id: number): Promise<void> {
  const { error } = await supabase.from("Units").delete().eq("id", id);
  if (error) throwSb(error);
}

// ── Tenants ───────────────────────────────────────────────────────

export async function listTenants(q?: string): Promise<Tenant[]> {
  const { data, error } = await supabase.from("Tenants").select("*").order("last_name");
  if (error) throwSb(error);
  let rows = data ?? [];
  if (q?.trim()) {
    const needle = q.trim().toLowerCase();
    rows = rows.filter(
      (t) =>
        t.first_name.toLowerCase().includes(needle) ||
        t.last_name.toLowerCase().includes(needle) ||
        (t.email && t.email.toLowerCase().includes(needle)),
    );
  }

  const unitIds = [...new Set(rows.map((t) => t.unit_id).filter(Boolean))] as number[];
  const { data: units } = unitIds.length
    ? await supabase.from("Units").select("id, unit_label, property_id").in("id", unitIds)
    : { data: [] as { id: number; unit_label: string; property_id: number }[] };
  const unitMap = new Map((units ?? []).map((u) => [u.id, u]));
  const propIds = [...new Set((units ?? []).map((u) => u.property_id))];
  const { data: props } = propIds.length
    ? await supabase.from("Properties").select("id, property_name").in("id", propIds)
    : { data: [] as { id: number; property_name: string | null }[] };
  const propMap = new Map((props ?? []).map((p) => [p.id, p]));

  return rows.map((t) => {
    const u = t.unit_id ? unitMap.get(t.unit_id) : undefined;
    const p = u ? propMap.get(u.property_id) : undefined;
    return mapTenant(t, {
      active_unit_id: t.unit_id,
      active_unit_name: u?.unit_label,
      active_property_name: p?.property_name,
    });
  });
}

export async function getTenant(id: number): Promise<Tenant> {
  const list = await listTenants();
  const t = list.find((x) => x.id === id);
  if (!t) throw new Error("Tenant not found");
  return t;
}

export async function createTenant(input: NewTenant): Promise<Tenant> {
  const email = input.email?.trim();
  if (!email) throw new Error("Email is required");
  const { data, error } = await supabase
    .from("Tenants")
    .insert({
      first_name: input.first_name,
      last_name: input.last_name,
      email,
      mobile_phone: input.phone ?? null,
      date_of_birth: input.date_of_birth ?? null,
      emergency_contact: input.emergency_contact ?? null,
      employer: input.employer ?? null,
      monthly_income: input.monthly_income ?? null,
      notes: input.notes ?? null,
      primary_on_lease: false,
      invite_to_app: false,
    })
    .select("*")
    .single();
  if (error) throwSb(error);
  return mapTenant(data!);
}

export async function updateTenant(id: number, patch: Partial<NewTenant>): Promise<Tenant> {
  const row: Record<string, unknown> = {};
  if (patch.first_name !== undefined) row.first_name = patch.first_name;
  if (patch.last_name !== undefined) row.last_name = patch.last_name;
  if (patch.email !== undefined) {
    if (!patch.email?.trim()) throw new Error("Email is required");
    row.email = patch.email.trim();
  }
  if (patch.phone !== undefined) row.mobile_phone = patch.phone;
  if (patch.date_of_birth !== undefined) row.date_of_birth = patch.date_of_birth;
  if (patch.emergency_contact !== undefined) row.emergency_contact = patch.emergency_contact;
  if (patch.employer !== undefined) row.employer = patch.employer;
  if (patch.monthly_income !== undefined) row.monthly_income = patch.monthly_income;
  if (patch.notes !== undefined) row.notes = patch.notes;
  const { data, error } = await supabase.from("Tenants").update(row as never).eq("id", id).select("*").single();
  if (error) throwSb(error);
  return mapTenant(data!);
}

export async function deleteTenant(id: number): Promise<void> {
  const { error } = await supabase.from("Tenants").delete().eq("id", id);
  if (error) throwSb(error);
}

// ── Leases ────────────────────────────────────────────────────────

export async function listLeases(params?: {
  tenant_id?: number;
  unit_id?: number;
  status?: string;
}): Promise<Lease[]> {
  let q = supabase.from("Leases").select("*").order("start_date", { ascending: false });
  if (params?.unit_id) q = q.eq("unit_id", params.unit_id);
  if (params?.status) q = q.eq("status", params.status);
  if (params?.tenant_id) q = q.eq("primary_tenant_id", params.tenant_id);
  const { data: leases, error } = await q;
  if (error) throwSb(error);

  const unitIds = [...new Set((leases ?? []).map((l) => l.unit_id))];
  const tenantIds = [
    ...new Set((leases ?? []).map((l) => l.primary_tenant_id).filter(Boolean)),
  ] as number[];

  const [{ data: units }, { data: tenants }] = await Promise.all([
    unitIds.length
      ? supabase.from("Units").select("id, unit_label, property_id").in("id", unitIds)
      : Promise.resolve({ data: [] as { id: number; unit_label: string; property_id: number }[] }),
    tenantIds.length
      ? supabase.from("Tenants").select("id, first_name, last_name, email, mobile_phone").in("id", tenantIds)
      : Promise.resolve({
          data: [] as {
            id: number;
            first_name: string;
            last_name: string;
            email: string;
            mobile_phone: string | null;
          }[],
        }),
  ]);
  const unitMap = new Map((units ?? []).map((u) => [u.id, u]));
  const propIds = [...new Set((units ?? []).map((u) => u.property_id))];
  const { data: props } = propIds.length
    ? await supabase.from("Properties").select("id, property_name, color").in("id", propIds)
    : { data: [] as { id: number; property_name: string | null; color: string }[] };
  const propMap = new Map((props ?? []).map((p) => [p.id, p]));
  const tenantMap = new Map((tenants ?? []).map((t) => [t.id, t]));

  return (leases ?? []).map((l) => {
    const u = unitMap.get(l.unit_id);
    const p = u ? propMap.get(u.property_id) : undefined;
    const t = l.primary_tenant_id ? tenantMap.get(l.primary_tenant_id) : undefined;
    return mapLease(l, {
      unit_name: u?.unit_label,
      property_id: u?.property_id,
      property_name: p?.property_name,
      property_color: p?.color,
      tenant_first_name: t?.first_name,
      tenant_last_name: t?.last_name,
      tenant_email: t?.email,
      tenant_phone: t?.mobile_phone,
    });
  });
}

export async function createLease(input: NewLease): Promise<Lease> {
  const { data, error } = await supabase
    .from("Leases")
    .insert({
      unit_id: input.unit_id,
      primary_tenant_id: input.primary_tenant_id ?? null,
      start_date: input.start_date,
      end_date: input.end_date,
      monthly_rent: input.monthly_rent ?? 0,
      deposit: input.deposit ?? 0,
      rent_due_day: input.rent_due_day ?? 1,
      late_fee: input.late_fee ?? 0,
      status: input.status ?? "active",
      notes: input.notes ?? null,
    })
    .select("*")
    .single();
  if (error) throwSb(error);
  if (input.primary_tenant_id) {
    const { error: ltErr } = await supabase.from("LeaseTenants").upsert({
      lease_id: data!.id,
      tenant_id: input.primary_tenant_id,
    });
    if (ltErr) {
      await supabase.from("Leases").delete().eq("id", data!.id);
      throwSb(ltErr);
    }
    const { error: tErr } = await supabase
      .from("Tenants")
      .update({ unit_id: input.unit_id, primary_on_lease: true } as never)
      .eq("id", input.primary_tenant_id);
    if (tErr) {
      await supabase.from("LeaseTenants").delete().eq("lease_id", data!.id);
      await supabase.from("Leases").delete().eq("id", data!.id);
      throwSb(tErr);
    }
  }
  const list = await listLeases();
  return list.find((l) => l.id === data!.id) ?? mapLease(data!);
}

export async function updateLease(id: number, patch: Partial<NewLease>): Promise<Lease> {
  const row: Record<string, unknown> = {};
  for (const key of [
    "unit_id",
    "primary_tenant_id",
    "start_date",
    "end_date",
    "monthly_rent",
    "deposit",
    "rent_due_day",
    "late_fee",
    "status",
    "notes",
  ] as const) {
    if (patch[key] !== undefined) row[key] = patch[key];
  }
  const { data, error } = await supabase.from("Leases").update(row as never).eq("id", id).select("*").single();
  if (error) throwSb(error);
  const list = await listLeases();
  return list.find((l) => l.id === id) ?? mapLease(data!);
}

export async function deleteLease(id: number): Promise<void> {
  await supabase.from("LeaseTenants").delete().eq("lease_id", id);
  const { error } = await supabase.from("Leases").delete().eq("id", id);
  if (error) throwSb(error);
}

// ── Rent ──────────────────────────────────────────────────────────

export async function listCharges(period?: string): Promise<RentCharge[]> {
  let q = supabase.from("RentCharges").select("*").order("due_date", { ascending: false });
  if (period) q = q.eq("period", period);
  const { data: charges, error } = await q;
  if (error) throwSb(error);

  const leaseIds = [...new Set((charges ?? []).map((c) => c.lease_id))];
  const leases = leaseIds.length ? await listLeases() : [];
  const leaseMap = new Map(leases.map((l) => [l.id, l]));

  return (charges ?? []).map((c) => {
    const l = leaseMap.get(c.lease_id);
    return mapCharge(c, {
      unit_id: l?.unit_id,
      lease_rent: l?.monthly_rent,
      rent_due_day: l?.rent_due_day,
      unit_name: l?.unit_name,
      property_id: l?.property_id,
      property_name: l?.property_name,
      property_color: l?.property_color,
      tenant_id: l?.primary_tenant_id,
      tenant_first_name: l?.tenant_first_name,
      tenant_last_name: l?.tenant_last_name,
    });
  });
}

export async function generateCharges(period: string): Promise<{ created: number; period: string }> {
  const leases = await listLeases({ status: "active" });
  const [year, month] = period.split("-").map(Number);
  const dueDayDefault = 1;
  let created = 0;
  for (const lease of leases) {
    const dueDay = Math.min(lease.rent_due_day || dueDayDefault, 28);
    const due_date = `${period}-${String(dueDay).padStart(2, "0")}`;
    const { data: existing } = await supabase
      .from("RentCharges")
      .select("id")
      .eq("lease_id", lease.id)
      .eq("period", period)
      .maybeSingle();
    if (existing) continue;
    const { error } = await supabase.from("RentCharges").insert({
      lease_id: lease.id,
      period,
      due_date,
      amount: lease.monthly_rent,
      amount_paid: 0,
      status: "open",
    });
    if (!error) created += 1;
    void year;
    void month;
  }
  return { created, period };
}

export async function listPayments(chargeId: number): Promise<Payment[]> {
  const { data, error } = await supabase
    .from("Payments")
    .select("*")
    .eq("charge_id", chargeId)
    .order("paid_at", { ascending: false });
  if (error) throwSb(error);
  return (data ?? []).map(mapPayment);
}

export async function recordPayment(input: {
  charge_id: number;
  amount: number;
  method?: string;
  reference?: string | null;
  notes?: string | null;
  paid_at?: string;
}): Promise<RentCharge> {
  const { error: pErr } = await supabase.from("Payments").insert({
    charge_id: input.charge_id,
    amount: input.amount,
    method: input.method ?? "cash",
    reference: input.reference ?? null,
    notes: input.notes ?? null,
    paid_at: input.paid_at ?? new Date().toISOString(),
  });
  if (pErr) throwSb(pErr);

  const { data: charge, error: cErr } = await supabase
    .from("RentCharges")
    .select("*")
    .eq("id", input.charge_id)
    .single();
  if (cErr) throwSb(cErr);

  const amount_paid = Number(charge!.amount_paid) + input.amount;
  const amount = Number(charge!.amount);
  let status = charge!.status;
  if (amount_paid >= amount) status = "paid";
  else if (amount_paid > 0) status = "partial";

  const { data: updated, error: uErr } = await supabase
    .from("RentCharges")
    .update({ amount_paid, status } as never)
    .eq("id", input.charge_id)
    .select("*")
    .single();
  if (uErr) throwSb(uErr);

  const charges = await listCharges();
  return charges.find((c) => c.id === input.charge_id) ?? mapCharge(updated!);
}

export async function deletePayment(paymentId: number): Promise<RentCharge> {
  const { data: payment, error: pErr } = await supabase
    .from("Payments")
    .select("*")
    .eq("id", paymentId)
    .single();
  if (pErr) throwSb(pErr);

  const chargeId = payment!.charge_id;
  const { error: dErr } = await supabase.from("Payments").delete().eq("id", paymentId);
  if (dErr) throwSb(dErr);

  const { data: remaining, error: rErr } = await supabase
    .from("Payments")
    .select("amount")
    .eq("charge_id", chargeId);
  if (rErr) throwSb(rErr);

  const amount_paid = (remaining ?? []).reduce((s, row) => s + Number(row.amount), 0);
  const { data: charge, error: cErr } = await supabase
    .from("RentCharges")
    .select("*")
    .eq("id", chargeId)
    .single();
  if (cErr) throwSb(cErr);

  const amount = Number(charge!.amount);
  let status = "open";
  if (amount_paid >= amount && amount > 0) status = "paid";
  else if (amount_paid > 0) status = "partial";
  else if (charge!.due_date < new Date().toISOString().slice(0, 10)) status = "overdue";

  const { data: updated, error: uErr } = await supabase
    .from("RentCharges")
    .update({ amount_paid, status } as never)
    .eq("id", chargeId)
    .select("*")
    .single();
  if (uErr) throwSb(uErr);

  const charges = await listCharges();
  return charges.find((c) => c.id === chargeId) ?? mapCharge(updated!);
}

// ── Vendors ───────────────────────────────────────────────────────

export async function listVendors(): Promise<Vendor[]> {
  const { data, error } = await supabase.from("Vendors").select("*").order("name");
  if (error) throwSb(error);
  return (data ?? []).map(mapVendor);
}

export async function createVendor(input: NewVendor): Promise<Vendor> {
  const { data, error } = await supabase
    .from("Vendors")
    .insert({
      name: input.name,
      category: input.category ?? "general",
      phone: input.phone ?? null,
      email: input.email ?? null,
      notes: input.notes ?? null,
      color: input.color ?? "slate",
    })
    .select("*")
    .single();
  if (error) throwSb(error);
  return mapVendor(data!);
}

export async function updateVendor(id: number, patch: Partial<NewVendor>): Promise<Vendor> {
  const row: Record<string, unknown> = {};
  for (const key of ["name", "category", "phone", "email", "notes", "color"] as const) {
    if (patch[key] !== undefined) row[key] = patch[key];
  }
  const { data, error } = await supabase.from("Vendors").update(row as never).eq("id", id).select("*").single();
  if (error) throwSb(error);
  return mapVendor(data!);
}

export async function deleteVendor(id: number): Promise<void> {
  const { error } = await supabase.from("Vendors").delete().eq("id", id);
  if (error) throwSb(error);
}

// ── Settings ──────────────────────────────────────────────────────

export async function getSettings(): Promise<Record<string, string>> {
  const { data, error } = await supabase.from("Settings").select("key, value");
  if (error) throwSb(error);
  const out: Record<string, string> = {};
  for (const row of data ?? []) out[row.key] = row.value;
  return out;
}

export async function updateSettings(patch: Record<string, string>): Promise<Record<string, string>> {
  for (const [key, value] of Object.entries(patch)) {
    const { error } = await supabase.from("Settings").upsert({
      key,
      value,
      updated_at: new Date().toISOString(),
    });
    if (error) throwSb(error);
  }
  return getSettings();
}

// ── Maintenance / work orders ─────────────────────────────────────

export async function listWorkOrders(params?: {
  status?: string;
  property_id?: number;
}): Promise<WorkOrder[]> {
  let q = supabase.from("MaintenanceRequests").select("*").order("created_at", { ascending: false });
  if (params?.property_id) q = q.eq("property_id", params.property_id);
  if (params?.status) q = q.eq("status", workOrderStatusToDb(params.status as WorkOrderStatus));
  const { data: rows, error } = await q;
  if (error) throwSb(error);

  const propIds = [...new Set((rows ?? []).map((r) => r.property_id).filter(Boolean))] as number[];
  const unitIds = [...new Set((rows ?? []).map((r) => r.unit_id).filter(Boolean))] as number[];
  const tenantIds = [
    ...new Set((rows ?? []).map((r) => r.submitted_by_tenant_id).filter(Boolean)),
  ] as number[];
  const vendorIds = [...new Set((rows ?? []).map((r) => r.vendor_id).filter(Boolean))] as number[];

  const [{ data: props }, { data: units }, { data: tenants }, { data: vendors }] = await Promise.all([
    propIds.length
      ? supabase.from("Properties").select("id, property_name, color").in("id", propIds)
      : Promise.resolve({ data: [] as { id: number; property_name: string | null; color: string }[] }),
    unitIds.length
      ? supabase.from("Units").select("id, unit_label").in("id", unitIds)
      : Promise.resolve({ data: [] as { id: number; unit_label: string }[] }),
    tenantIds.length
      ? supabase.from("Tenants").select("id, first_name, last_name").in("id", tenantIds)
      : Promise.resolve({ data: [] as { id: number; first_name: string; last_name: string }[] }),
    vendorIds.length
      ? supabase.from("Vendors").select("id, name, color").in("id", vendorIds)
      : Promise.resolve({ data: [] as { id: number; name: string; color: string }[] }),
  ]);

  const propMap = new Map((props ?? []).map((p) => [p.id, p]));
  const unitMap = new Map((units ?? []).map((u) => [u.id, u]));
  const tenantMap = new Map((tenants ?? []).map((t) => [t.id, t]));
  const vendorMap = new Map((vendors ?? []).map((v) => [v.id, v]));

  return (rows ?? []).map((r) => {
    const p = r.property_id ? propMap.get(r.property_id) : undefined;
    const u = r.unit_id ? unitMap.get(r.unit_id) : undefined;
    const t = r.submitted_by_tenant_id ? tenantMap.get(r.submitted_by_tenant_id) : undefined;
    const v = r.vendor_id ? vendorMap.get(r.vendor_id) : undefined;
    return mapWorkOrder(r, {
      property_name: p?.property_name,
      property_color: p?.color,
      unit_name: u?.unit_label,
      tenant_first_name: t?.first_name,
      tenant_last_name: t?.last_name,
      vendor_name: v?.name,
      vendor_color: v?.color,
    });
  });
}

export async function createWorkOrder(input: NewWorkOrder): Promise<WorkOrder> {
  const { data, error } = await supabase
    .from("MaintenanceRequests")
    .insert({
      title: input.title,
      description: input.description?.trim() || input.title,
      category: "General",
      priority: workOrderPriorityToDb(input.priority ?? "normal"),
      status: workOrderStatusToDb(input.status ?? "open"),
      property_id: input.property_id ?? null,
      unit_id: input.unit_id ?? null,
      vendor_id: input.vendor_id ?? null,
      submitted_by_tenant_id: input.tenant_id ?? null,
      scheduled_for: input.scheduled_at ?? null,
      cost: input.cost ?? null,
      notes: input.notes ?? null,
      permission_to_enter: false,
    })
    .select("*")
    .single();
  if (error) throwSb(error);
  const list = await listWorkOrders();
  return list.find((w) => w.id === data!.id) ?? mapWorkOrder(data!);
}

export async function updateWorkOrder(id: number, patch: Partial<NewWorkOrder>): Promise<WorkOrder> {
  const row: Record<string, unknown> = {};
  if (patch.title !== undefined) row.title = patch.title;
  if (patch.description !== undefined) row.description = patch.description?.trim() || patch.title || "";
  if (patch.priority !== undefined) row.priority = workOrderPriorityToDb(patch.priority);
  if (patch.status !== undefined) {
    row.status = workOrderStatusToDb(patch.status);
    if (patch.status === "completed") row.closed_at = new Date().toISOString();
    if (patch.status === "in_progress") row.started_at = new Date().toISOString();
  }
  if (patch.property_id !== undefined) row.property_id = patch.property_id;
  if (patch.unit_id !== undefined) row.unit_id = patch.unit_id;
  if (patch.vendor_id !== undefined) row.vendor_id = patch.vendor_id;
  if (patch.tenant_id !== undefined) row.submitted_by_tenant_id = patch.tenant_id;
  if (patch.scheduled_at !== undefined) row.scheduled_for = patch.scheduled_at;
  if (patch.cost !== undefined) row.cost = patch.cost;
  if (patch.notes !== undefined) row.notes = patch.notes;
  const { data, error } = await supabase
    .from("MaintenanceRequests")
    .update(row as never)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throwSb(error);
  const list = await listWorkOrders();
  return list.find((w) => w.id === id) ?? mapWorkOrder(data!);
}

export async function deleteWorkOrder(id: number): Promise<void> {
  const { error } = await supabase.from("MaintenanceRequests").delete().eq("id", id);
  if (error) throwSb(error);
}

// ── Dashboard ─────────────────────────────────────────────────────

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const now = new Date();
  const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const in30 = new Date(now);
  in30.setDate(in30.getDate() + 30);
  const in30Iso = in30.toISOString().slice(0, 10);
  const todayIso = now.toISOString().slice(0, 10);

  const [properties, units, leases, charges, workOrders] = await Promise.all([
    listProperties(),
    listUnits(),
    listLeases(),
    listCharges(period),
    listWorkOrders(),
  ]);

  const occupied = units.filter((u) => u.status === "occupied").length;
  const vacant = units.filter((u) => u.status === "vacant").length;
  const activeLeases = leases.filter((l) => l.status === "active");
  const upcoming = activeLeases.filter((l) => l.end_date <= in30Iso && l.end_date >= todayIso);
  const month_outstanding = charges
    .filter((c) => c.status !== "paid" && c.status !== "waived")
    .reduce((s, c) => s + (c.amount - c.amount_paid), 0);
  const month_collected = charges.reduce((s, c) => s + c.amount_paid, 0);
  const overdue = charges.filter((c) => c.status === "overdue" || (c.due_date < todayIso && c.status !== "paid" && c.status !== "waived"));
  const openWo = workOrders.filter((w) => !["completed", "cancelled"].includes(w.status));
  const urgentWo = openWo.filter((w) => w.priority === "urgent");

  return {
    period,
    properties: properties.length,
    units: units.length,
    occupied,
    vacant,
    occupancy_rate: units.length ? Math.round((occupied / units.length) * 100) : 0,
    active_leases: activeLeases.length,
    upcoming_move_outs: upcoming.length,
    month_outstanding,
    month_collected,
    overdue_total: overdue.reduce((s, c) => s + (c.amount - c.amount_paid), 0),
    overdue_count: overdue.length,
    open_work_orders: openWo.length,
    urgent_work_orders: urgentWo.length,
    recent_work_orders: openWo.slice(0, 5).map((w) => ({
      id: w.id,
      title: w.title,
      priority: w.priority,
      status: w.status,
      property_name: w.property_name ?? null,
      unit_name: w.unit_name ?? null,
      created_at: w.created_at,
    })),
    upcoming_expirations: upcoming.slice(0, 5).map((l) => ({
      id: l.id,
      end_date: l.end_date,
      tenant_first_name: l.tenant_first_name ?? null,
      tenant_last_name: l.tenant_last_name ?? null,
      unit_name: l.unit_name ?? null,
      property_name: l.property_name ?? null,
    })),
  };
}

void assertOk;
