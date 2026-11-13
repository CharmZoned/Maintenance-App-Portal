import type {
  Landlord,
  Property,
  PropertyType,
  Unit,
  UnitStatus,
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

function lowerStatus(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, "_");
}

const UNIT_STATUS_TO_DB: Record<UnitStatus, string> = {
  vacant: "Vacant",
  occupied: "Occupied",
  turnover: "Turnover",
  unavailable: "Unavailable",
};

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

export function mapProperty(
  row: SbProperty,
  extras?: { unit_count?: number; occupied_count?: number; landlord_name?: string | null },
): Property {
  return {
    id: row.id,
    name: row.property_name ?? "",
    type: (row.property_type as PropertyType) || "single_family",
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
    property_type: data.type ?? "single_family",
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
  const st = lowerStatus(row.status) as UnitStatus;
  return {
    id: row.id,
    property_id: row.property_id,
    name: row.unit_label,
    bedrooms: row.bedrooms ?? 0,
    bathrooms: Number(row.bathrooms ?? 0),
    sqft: row.sqft,
    market_rent: Number(row.market_rent),
    status: (["vacant", "occupied", "turnover", "unavailable"].includes(st)
      ? st
      : "vacant") as UnitStatus,
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

export function unitStatusToDb(status: UnitStatus | string): string {
  return UNIT_STATUS_TO_DB[status as UnitStatus] ?? status;
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
  },
): WorkOrder {
  const statusRaw = lowerStatus(row.status);
  const priorityRaw = lowerStatus(row.priority);
  const statusMap: Record<string, WorkOrderStatus> = {
    open: "open",
    scheduled: "scheduled",
    in_progress: "in_progress",
    on_hold: "on_hold",
    closed: "closed",
    // Legacy D1 aliases (if any old rows / docs)
    assigned: "scheduled",
    completed: "closed",
    cancelled: "closed",
    canceled: "closed",
  };
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
    status: statusMap[statusRaw] ?? "open",
    permission_to_enter: Boolean(row.permission_to_enter),
    assigned_staff_id: row.assigned_staff_id,
    scheduled_at: row.scheduled_for,
    completed_at: row.closed_at,
    cost: row.cost != null ? Number(row.cost) : null,
    notes: row.notes,
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

export function workOrderStatusToDb(status: WorkOrderStatus): string {
  return WO_STATUS_TO_DB[status] ?? status;
}

export function workOrderPriorityToDb(priority: WorkOrderPriority): string {
  return WO_PRIORITY_TO_DB[priority] ?? priority;
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

export { UNIT_STATUS_TO_DB };
