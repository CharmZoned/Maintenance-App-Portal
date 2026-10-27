// ── Core entities (Supabase / Landlord Gopher shape) ───────────────

export type PropertyType =
  | "Single-family"
  | "Multi-family"
  | "Condo"
  | "Townhouse"
  | "Apartment building"
  | "Commercial"
  | "Other";

export type PropertyManagementStatus = "Active" | "Partially Managed" | "No Longer Managed";
export type OccupancyStatus = "Fully Occupied" | "Partially Occupied" | "Unoccupied" | "Not Applicable";
export type PreferredContact = "Email" | "Phone" | "Either";

export interface Landlord {
  id: number;
  source_id: string;
  first_name: string;
  last_name: string;
  company_name: string | null;
  email: string;
  mobile_phone: string | null;
  preferred_contact: PreferredContact | null;
  notes: string | null;
  is_test_data: boolean;
  created_at: string;
  property_count?: number;
}

export interface Property {
  id: number;
  source_id: string;
  property_name: string | null;
  street_address: string;
  city: string;
  state: string;
  zip: string;
  property_type: PropertyType;
  landlord_id: number;
  notes: string | null;
  is_test_data: boolean;
  management_status: PropertyManagementStatus;
  occupancy_status: OccupancyStatus;
  management_end_date: string | null;
  year_built: number | null;
  color: string;
  created_at: string;
  unit_count?: number;
  occupied_count?: number;
  landlord_first_name?: string | null;
  landlord_last_name?: string | null;
  landlord_company_name?: string | null;
  landlord_email?: string | null;
}

export type UnitStatus = "Occupied" | "Vacant";
export type UnitManagementStatus = "Active" | "No Longer Managed";
export type ReadinessStatus =
  | "Ready"
  | "Turnover Needed"
  | "Turnover In Progress"
  | "Rehab Needed"
  | "Rehab In Progress";

export interface Unit {
  id: number;
  source_id: string;
  property_id: number;
  unit_label: string;
  bedrooms: number | null;
  bathrooms: number | null;
  sqft: number | null;
  market_rent: number;
  status: UnitStatus;
  notes: string | null;
  is_test_data: boolean;
  management_status: UnitManagementStatus;
  occupancy_status: string | null;
  readiness_status: ReadinessStatus;
  currently_being_marketed: boolean;
  management_end_date: string | null;
  expected_move_out_date: string | null;
  created_at: string;
  property_name?: string | null;
  property_color?: string | null;
  property_address?: string | null;
  property_city?: string | null;
  active_lease_id?: number | null;
  active_tenant_name?: string | null;
}

export interface Tenant {
  id: number;
  source_id: string;
  first_name: string;
  last_name: string;
  email: string;
  mobile_phone: string | null;
  unit_id: number;
  primary_on_lease: boolean;
  invite_to_app: boolean;
  date_of_birth: string | null;
  emergency_contact: string | null;
  employer: string | null;
  monthly_income: number | null;
  notes: string | null;
  is_test_data: boolean;
  created_at: string;
  active_unit_id?: number | null;
  active_unit_name?: string | null;
  active_property_name?: string | null;
}

export type LeaseStatus = "upcoming" | "active" | "ended" | "cancelled";

export interface Lease {
  id: number;
  unit_id: number;
  primary_tenant_id: number | null;
  start_date: string;
  end_date: string;
  monthly_rent: number;
  deposit: number;
  rent_due_day: number;
  late_fee: number;
  status: LeaseStatus;
  notes: string | null;
  is_test_data: boolean;
  created_at: string;
  unit_name?: string | null;
  property_id?: number | null;
  property_name?: string | null;
  property_color?: string | null;
  tenant_first_name?: string | null;
  tenant_last_name?: string | null;
  tenant_email?: string | null;
  tenant_phone?: string | null;
}

export type ChargeStatus = "open" | "partial" | "paid" | "overdue" | "waived";

export interface RentCharge {
  id: number;
  lease_id: number;
  period: string;
  due_date: string;
  amount: number;
  amount_paid: number;
  status: ChargeStatus;
  notes: string | null;
  is_test_data: boolean;
  created_at: string;
  unit_id?: number | null;
  lease_rent?: number | null;
  rent_due_day?: number | null;
  unit_name?: string | null;
  property_id?: number | null;
  property_name?: string | null;
  property_color?: string | null;
  tenant_id?: number | null;
  tenant_first_name?: string | null;
  tenant_last_name?: string | null;
}

export type PaymentMethod = "cash" | "check" | "ach" | "credit" | "other";

export interface Payment {
  id: number;
  charge_id: number;
  paid_at: string;
  amount: number;
  method: PaymentMethod;
  reference: string | null;
  notes: string | null;
  is_test_data?: boolean;
}

export type VendorCategory =
  | "plumber"
  | "electrician"
  | "hvac"
  | "handyman"
  | "cleaning"
  | "landscaping"
  | "general";

export interface Vendor {
  id: number;
  name: string;
  category: VendorCategory;
  phone: string | null;
  email: string | null;
  notes: string | null;
  color: string;
  is_test_data: boolean;
  created_at: string;
}

export interface Staff {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  job_title: string | null;
  gets_request_alerts: boolean;
  is_test_data: boolean;
  created_at: string;
}

export type MaintenancePriority = "Low" | "Normal" | "High" | "Urgent";
export type MaintenanceStatus = "Open" | "Scheduled" | "In Progress" | "On Hold" | "Closed";
export type MaintenanceCategory =
  | "Plumbing"
  | "Electrical"
  | "Heating / AC"
  | "Appliance"
  | "Pest control"
  | "Locks / keys / doors"
  | "Windows"
  | "Roof / leaks"
  | "Mold / water damage"
  | "Exterior / yard"
  | "General repair"
  | "Other";

export interface MaintenanceRequest {
  id: number;
  request_number: string;
  property_id: number | null;
  unit_id: number | null;
  submitted_by_tenant_id: number | null;
  assigned_staff_id: number | null;
  vendor_id: number | null;
  title: string;
  description: string;
  category: MaintenanceCategory;
  priority: MaintenancePriority;
  status: MaintenanceStatus;
  scheduled_for: string | null;
  started_at: string | null;
  hold_reason: string | null;
  next_follow_up_date: string | null;
  closed_at: string | null;
  resolution_notes: string | null;
  cost: number | null;
  notes: string | null;
  is_test_data: boolean;
  created_at: string;
  property_name?: string | null;
  property_color?: string | null;
  unit_name?: string | null;
  tenant_first_name?: string | null;
  tenant_last_name?: string | null;
  vendor_name?: string | null;
  vendor_color?: string | null;
  staff_first_name?: string | null;
  staff_last_name?: string | null;
  resolved_property_id?: number | null;
}

/** @deprecated Use MaintenanceRequest */
export type WorkOrder = MaintenanceRequest;
export type WorkOrderPriority = MaintenancePriority;
export type WorkOrderStatus = MaintenanceStatus;

export interface Inquiry {
  id: string;
  created_at: string;
  first_name: string;
  last_name: string | null;
  phone: string | null;
  email: string;
  referral_source: string | null;
  message: string | null;
  source: string;
  status: string;
}

export type ApplicationStatus = "new" | "screening" | "approved" | "declined" | "withdrawn";

export interface Application {
  id: number;
  unit_id: number | null;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  monthly_income: number | null;
  employer: string | null;
  desired_move_in: string | null;
  status: ApplicationStatus;
  notes: string | null;
  is_test_data: boolean;
  created_at: string;
  unit_name?: string | null;
  property_name?: string | null;
}

export interface DashboardSummary {
  period: string;
  properties: number;
  units: number;
  occupied: number;
  vacant: number;
  occupancy_rate: number;
  active_leases: number;
  upcoming_move_outs: number;
  month_outstanding: number;
  month_collected: number;
  overdue_total: number;
  overdue_count: number;
  open_work_orders: number;
  urgent_work_orders: number;
  on_hold_requests: number;
  unassigned_requests: number;
  recent_work_orders: {
    id: number;
    title: string;
    priority: string;
    status: string;
    request_number?: string;
    property_name: string | null;
    unit_name: string | null;
    created_at: string;
  }[];
  upcoming_expirations: {
    id: number;
    end_date: string;
    tenant_first_name: string | null;
    tenant_last_name: string | null;
    unit_name: string | null;
    property_name: string | null;
  }[];
}

// ── Input types ────────────────────────────────────────────────────

export type NewLandlord = Partial<Omit<Landlord, "id" | "created_at" | "property_count" | "source_id">> & {
  first_name: string;
  last_name: string;
  email: string;
};
export type NewProperty = Partial<Omit<Property, "id" | "created_at" | "unit_count" | "occupied_count" | "source_id" | "occupancy_status">> & {
  street_address: string;
  city: string;
  state: string;
  zip: string;
  property_type: PropertyType;
  landlord_id: number;
};
export type NewUnit = Partial<Omit<Unit, "id" | "created_at" | "property_name" | "property_color" | "property_address" | "property_city" | "active_lease_id" | "active_tenant_name" | "source_id" | "occupancy_status">> & {
  property_id: number;
  unit_label: string;
};
export type NewTenant = Partial<Omit<Tenant, "id" | "created_at" | "active_unit_id" | "active_unit_name" | "active_property_name" | "source_id">> & {
  first_name: string;
  last_name: string;
  email: string;
  unit_id: number;
  primary_on_lease: boolean;
  invite_to_app: boolean;
};
export type NewLease = Partial<Omit<Lease, "id" | "created_at" | "unit_name" | "property_id" | "property_name" | "property_color" | "tenant_first_name" | "tenant_last_name" | "tenant_email" | "tenant_phone">> & {
  unit_id: number;
  start_date: string;
  end_date: string;
};
export type NewMaintenanceRequest = Partial<Omit<MaintenanceRequest, "id" | "created_at" | "request_number" | "property_name" | "property_color" | "unit_name" | "tenant_first_name" | "tenant_last_name" | "vendor_name" | "vendor_color" | "staff_first_name" | "staff_last_name" | "resolved_property_id">> & {
  title: string;
  description: string;
  category: MaintenanceCategory;
};
/** @deprecated */
export type NewWorkOrder = NewMaintenanceRequest;
export type NewVendor = Partial<Omit<Vendor, "id" | "created_at">> & { name: string };
export type NewStaff = Partial<Omit<Staff, "id" | "created_at">> & {
  first_name: string;
  last_name: string;
  email: string;
};
export type NewApplication = Partial<Omit<Application, "id" | "created_at" | "unit_name" | "property_name">> & {
  first_name: string;
  last_name: string;
};
