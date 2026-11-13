import type {
  Landlord,
  Property,
  PropertyType,
  Unit,
  UnitStatus,
  UnitReadiness,
  Tenant,
  Lease,
  LeaseStatus,
  RentCharge,
  ChargeStatus,
  Payment,
  PaymentMethod,
  Vendor,
  VendorCategory,
  WorkOrder,
  WorkOrderPriority,
  WorkOrderStatus,
  Application,
  ApplicationStatus,
  MaintenanceCategory,
} from "../types";
import {
  isMaintenanceCategory,
  isPropertyType,
  isUnitReadiness,
  isUnitStatus,
  isWorkOrderStatus,
} from "../types";
import type { Tables } from "../types.supabase";

type SbProperty = Tables<"Properties">;
type SbUnit = Tables<"Units">;
type SbTenant = Tables<"Tenants">;
type SbLease = Tables<"Leases">;
type SbCharge = Tables<"RentCharges">;
type SbPayment = Tables<"Payments">;
type SbVendor = Tables<"Vendors">;
type SbMr = Tables<"MaintenanceRequests">;
type SbLandlord = Tables<"Landlords">;
type SbApplication = Tables<"Applications">;

/** Normalize Title Case / kebab / snake labels to snake_case keys. */
function lowerStatus(s: string): string {
  return s.trim().toLowerCase().replace(/[-\s]+/g, "_");
}

/** Live CHECK: Occupied | Vacant only. */
const UNIT_STATUS_TO_DB: Record<UnitStatus, string> = {
  vacant: "Vacant",
  occupied: "Occupied",
};

/** Live CHECK: Ready | Turnover Needed | Turnover In Progress | Rehab Needed | Rehab In Progress */
const UNIT_READINESS_TO_DB: Record<UnitReadiness, string> = {
  ready: "Ready",
  turnover_needed: "Turnover Needed",
  turnover_in_progress: "Turnover In Progress",
  rehab_needed: "Rehab Needed",
  rehab_in_progress: "Rehab In Progress",
};

/** Live CHECK: Single-family | Multi-family | Condo | Townhouse | Apartment building | Commercial | Other */
const PROPERTY_TYPE_TO_DB: Record<PropertyType, string> = {
  single_family: "Single-family",
  multi_family: "Multi-family",
  condo: "Condo",
  townhouse: "Townhouse",
  apartment_building: "Apartment building",
  commercial: "Commercial",
  other: "Other",
};

const PROPERTY_TYPE_FROM_DB: Record<string, PropertyType> = Object.fromEntries(
  Object.entries(PROPERTY_TYPE_TO_DB).map(([ui, db]) => [db, ui as PropertyType]),
) as Record<string, PropertyType>;

/** Live CHECK: Open | Scheduled | In Progress | On Hold | Closed */
const WO_STATUS_TO_DB: Record<WorkOrderStatus, string> = {
  open: "Open",
  scheduled: "Scheduled",
  in_progress: "In Progress",
  on_hold: "On Hold",
  closed: "Closed",
};

const WO_PRIORITY_TO_DB: Record<WorkOrderPriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};

export function mapLandlord(row: SbLandlord): Landlord {
  return {
    id: row.id,
    first_name: row.first_name,
    last_name: row.last_name,
    company_name: row.company_name,
    email: row.email,
    phone: row.mobile_phone,
    preferred_contact: row.preferred_contact,
    notes: row.notes,
    created_at: row.created_at,
  };
}

export function propertyTypeFromDb(value: string | null | undefined): PropertyType {
  if (!value) return "single_family";
  const direct = PROPERTY_TYPE_FROM_DB[value];
  if (direct) return direct;
  const key = lowerStatus(value);
  if (isPropertyType(key)) return key;
  return "single_family";
}

/** Live property_type CHECK — Title Case values only. */
export function propertyTypeToDb(type: PropertyType | string): string {
  const key = lowerStatus(type);
  if (isPropertyType(key)) return PROPERTY_TYPE_TO_DB[key];
  const already = PROPERTY_TYPE_FROM_DB[type.trim()];
  if (already) return PROPERTY_TYPE_TO_DB[already];
  throw new Error(
    `Invalid property type "${type}". Use single_family / multi_family / condo / townhouse / apartment_building / commercial / other.`,
  );
}

export function mapProperty(
  row: SbProperty,
  extras?: { unit_count?: number; occupied_count?: number; landlord_name?: string | null },
): Property {
  return {
    id: row.id,
    name: row.property_name ?? "",
    type: propertyTypeFromDb(row.property_type),
    address: row.street_address,
    city: row.city,
    state: row.state,
    zip: row.zip,
    year_built: row.year_built,
    notes: row.notes,
    color: row.color,
    landlord_id: row.landlord_id,
    landlord_name: extras?.landlord_name ?? null,
    created_at: row.created_at,
    unit_count: extras?.unit_count,
    occupied_count: extras?.occupied_count,
  };
}

export function propertyToInsert(data: {
  name: string;
  type?: string;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  year_built?: number | null;
  notes?: string | null;
  color?: string;
  landlord_id: number;
}): Tables<"Properties"> extends never ? never : {
  property_name: string;
  property_type: string;
  street_address: string;
  city: string;
  state: string;
  zip: string;
  year_built: number | null;
  notes: string | null;
  color: string;
  landlord_id: number;
} {
  return {
    property_name: data.name,
    property_type: propertyTypeToDb(data.type ?? "single_family"),
    street_address: data.address?.trim() || "TBD",
    city: data.city?.trim() || "TBD",
    state: data.state?.trim() || "MD",
    zip: data.zip?.trim() || "00000",
    year_built: data.year_built ?? null,
    notes: data.notes ?? null,
    color: data.color ?? "sky",
    landlord_id: data.landlord_id,
  };
}

export function unitReadinessFromDb(value: string | null | undefined): UnitReadiness {
  if (!value) return "ready";
  const key = lowerStatus(value);
  if (isUnitReadiness(key)) return key;
  return "ready";
}

/** Live readiness_status CHECK — Title Case values only. */
export function unitReadinessToDb(readiness: UnitReadiness | string): string {
  const key = lowerStatus(readiness);
  if (isUnitReadiness(key)) return UNIT_READINESS_TO_DB[key];
  const trimmed = readiness.trim();
  const fromTitle = Object.entries(UNIT_READINESS_TO_DB).find(([, db]) => db === trimmed);
  if (fromTitle) return fromTitle[1];
  throw new Error(
    `Invalid unit readiness "${readiness}". Use ready / turnover_needed / turnover_in_progress / rehab_needed / rehab_in_progress.`,
  );
}

export function mapUnit(
  row: SbUnit,
  extras?: {
    property_name?: string | null;
    property_color?: string | null;
    property_address?: string | null;
    property_city?: string | null;
    active_lease_id?: number | null;
    active_tenant_name?: string | null;
  },
): Unit {
  const st = lowerStatus(row.status);
  return {
    id: row.id,
    property_id: row.property_id,
    name: row.unit_label,
    bedrooms: row.bedrooms ?? 0,
    bathrooms: Number(row.bathrooms ?? 0),
    sqft: row.sqft,
    market_rent: Number(row.market_rent),
    status: isUnitStatus(st) ? st : "vacant",
    readiness_status: unitReadinessFromDb(row.readiness_status),
    notes: row.notes,
    created_at: row.created_at,
    property_name: extras?.property_name,
    property_color: extras?.property_color,
    property_address: extras?.property_address,
    property_city: extras?.property_city,
    active_lease_id: extras?.active_lease_id,
    active_tenant_name: extras?.active_tenant_name,
  };
}

/** Live Units.status CHECK — Occupied | Vacant only. */
export function unitStatusToDb(status: UnitStatus | string): string {
  const key = lowerStatus(status);
  if (isUnitStatus(key)) return UNIT_STATUS_TO_DB[key];
  throw new Error(
    `Invalid unit status "${status}". Use vacant / occupied (turnover and rehab use readiness_status).`,
  );
}

export function mapTenant(
  row: SbTenant,
  extras?: {
    active_unit_id?: number | null;
    active_unit_name?: string | null;
    active_property_name?: string | null;
  },
): Tenant {
  return {
    id: row.id,
    first_name: row.first_name,
    last_name: row.last_name,
    email: row.email || null,
    phone: row.mobile_phone,
    date_of_birth: row.date_of_birth,
    emergency_contact: row.emergency_contact,
    employer: row.employer,
    monthly_income: row.monthly_income != null ? Number(row.monthly_income) : null,
    notes: row.notes,
    created_at: row.created_at,
    active_unit_id: extras?.active_unit_id ?? row.unit_id,
    active_unit_name: extras?.active_unit_name,
    active_property_name: extras?.active_property_name,
  };
}

export function mapLease(
  row: SbLease,
  extras?: {
    unit_name?: string | null;
    property_id?: number | null;
    property_name?: string | null;
    property_color?: string | null;
    tenant_first_name?: string | null;
    tenant_last_name?: string | null;
    tenant_email?: string | null;
    tenant_phone?: string | null;
  },
): Lease {
  return {
    id: row.id,
    unit_id: row.unit_id,
    primary_tenant_id: row.primary_tenant_id,
    start_date: row.start_date,
    end_date: row.end_date,
    monthly_rent: Number(row.monthly_rent),
    deposit: Number(row.deposit),
    rent_due_day: row.rent_due_day,
    late_fee: Number(row.late_fee),
    status: (row.status as LeaseStatus) || "active",
    notes: row.notes,
    created_at: row.created_at,
    unit_name: extras?.unit_name,
    property_id: extras?.property_id,
    property_name: extras?.property_name,
    property_color: extras?.property_color,
    tenant_first_name: extras?.tenant_first_name,
    tenant_last_name: extras?.tenant_last_name,
    tenant_email: extras?.tenant_email,
    tenant_phone: extras?.tenant_phone,
  };
}

export function mapCharge(
  row: SbCharge,
  extras?: Partial<RentCharge>,
): RentCharge {
  return {
    id: row.id,
    lease_id: row.lease_id,
    period: row.period,
    due_date: row.due_date,
    amount: Number(row.amount),
    amount_paid: Number(row.amount_paid),
    status: (row.status as ChargeStatus) || "open",
    notes: row.notes,
    created_at: row.created_at,
    ...extras,
  };
}

export function mapPayment(row: SbPayment): Payment {
  return {
    id: row.id,
    charge_id: row.charge_id,
    paid_at: row.paid_at,
    amount: Number(row.amount),
    method: (row.method as PaymentMethod) || "cash",
    reference: row.reference,
    notes: row.notes,
  };
}

export function mapVendor(row: SbVendor): Vendor {
  return {
    id: row.id,
    name: row.name,
    category: (row.category as VendorCategory) || "general",
    phone: row.phone,
    email: row.email,
    notes: row.notes,
    color: row.color,
    created_at: row.created_at,
  };
}

/**
 * Map a MaintenanceRequests row to a WorkOrder.
 * Internal staff notes are not on the MR row — pass `extras.notes` from
 * MaintenanceRequestStaffNotes (or null for landlord/tenant). Omitting extras.notes
 * yields `notes: null` (safe default; never invent notes from the request row).
 */
export function mapWorkOrder(
  row: SbMr,
  extras?: {
    property_name?: string | null;
    property_color?: string | null;
    unit_name?: string | null;
    tenant_first_name?: string | null;
    tenant_last_name?: string | null;
    vendor_name?: string | null;
    vendor_color?: string | null;
    /** From MaintenanceRequestStaffNotes; omit/null when caller is not staff/admin. */
    notes?: string | null;
  },
): WorkOrder {
  const statusRaw = lowerStatus(row.status);
  const priorityRaw = lowerStatus(row.priority);
  // Display-only aliases for retired D1 labels — live CHECK forbids writing these.
  // Map Assigned → open (not scheduled) so a staff save does not trip Accept & schedule.
  const legacyStatusAlias: Record<string, WorkOrderStatus> = {
    assigned: "open",
    completed: "closed",
    cancelled: "closed",
    canceled: "closed",
  };
  const status: WorkOrderStatus = isWorkOrderStatus(statusRaw)
    ? statusRaw
    : (legacyStatusAlias[statusRaw] ?? "open");
  const priorityMap: Record<string, WorkOrderPriority> = {
    low: "low",
    normal: "normal",
    high: "high",
    urgent: "urgent",
  };
  return {
    id: row.id,
    request_number: row.request_number,
    property_id: row.property_id,
    unit_id: row.unit_id,
    tenant_id: row.submitted_by_tenant_id,
    vendor_id: row.vendor_id,
    title: row.title,
    description: row.description,
    category: row.category || "General repair",
    priority: priorityMap[priorityRaw] ?? "normal",
    status,
    permission_to_enter: Boolean(row.permission_to_enter),
    assigned_staff_id: row.assigned_staff_id,
    scheduled_at: row.scheduled_for,
    completed_at: row.closed_at,
    cost: row.cost != null ? Number(row.cost) : null,
    notes: extras?.notes ?? null,
    resolution_notes: row.resolution_notes,
    hold_reason: row.hold_reason,
    next_follow_up_date: row.next_follow_up_date,
    created_at: row.created_at,
    property_name: extras?.property_name,
    property_color: extras?.property_color,
    unit_name: extras?.unit_name,
    tenant_first_name: extras?.tenant_first_name,
    tenant_last_name: extras?.tenant_last_name,
    vendor_name: extras?.vendor_name,
    vendor_color: extras?.vendor_color,
  };
}

export function workOrderStatusToDb(status: WorkOrderStatus | string): string {
  const key = lowerStatus(status);
  if (!isWorkOrderStatus(key)) {
    throw new Error(
      `Invalid work order status "${status}". Use open / scheduled / in_progress / on_hold / closed.`,
    );
  }
  return WO_STATUS_TO_DB[key];
}

export function workOrderPriorityToDb(priority: WorkOrderPriority | string): string {
  const key = lowerStatus(priority) as WorkOrderPriority;
  const mapped = WO_PRIORITY_TO_DB[key];
  if (!mapped) {
    throw new Error(`Invalid work order priority "${priority}". Use low / normal / high / urgent.`);
  }
  return mapped;
}

/** Live category CHECK — Title Case values from MAINTENANCE_CATEGORIES only. */
export function maintenanceCategoryToDb(category: string): MaintenanceCategory {
  const trimmed = category.trim();
  if (!isMaintenanceCategory(trimmed)) {
    throw new Error(
      `Invalid maintenance category "${category}". Choose a value from the maintenance category list.`,
    );
  }
  return trimmed;
}

const APP_STATUSES: ApplicationStatus[] = ["new", "screening", "approved", "declined", "withdrawn"];

export function mapApplication(
  row: SbApplication,
  extras?: { unit_name?: string | null; property_name?: string | null },
): Application {
  const raw = (row.status || "new").toLowerCase() as ApplicationStatus;
  return {
    id: row.id,
    unit_id: row.unit_id,
    first_name: row.first_name,
    last_name: row.last_name,
    email: row.email,
    phone: row.phone,
    monthly_income: row.monthly_income != null ? Number(row.monthly_income) : null,
    employer: row.employer,
    desired_move_in: row.desired_move_in,
    status: APP_STATUSES.includes(raw) ? raw : "new",
    notes: row.notes,
    created_at: row.created_at,
    unit_name: extras?.unit_name,
    property_name: extras?.property_name,
  };
}

export { UNIT_STATUS_TO_DB, UNIT_READINESS_TO_DB, PROPERTY_TYPE_TO_DB };
