import { beforeAll, describe, expect, test } from "vitest";
import {
  ATTENTION_LIMIT,
  buildAdminDashboardModel,
  buildDashboardIntro,
  buildDashboardState,
  buildEmptyState,
  buildErrorState,
  dashboardChargePeriods,
  dashboardClosedSince,
  money,
  requestRef,
  type AdminDashboardSources,
  type AdminDashboardViewer,
} from "@/lib/admin-dashboard";
import { loadAdminDashboardSources } from "@/hooks/use-admin-dashboard";
import type {
  PaymentAwaitingVerification,
  RecentMaintenanceComment,
  UserAccountRow,
} from "@/lib/data";
import type { InboxConversation, InboxLastMessage } from "@/lib/inbox";
import type { Application, Landlord, Lease, Property, RentCharge, Tenant, Unit, WorkOrder } from "@/types";
import { fixtureIntro, fixtureModel, fixtureStates } from "../preview/admin-dashboard-fixture";
import { createWorkOrder, listWorkOrders, listWorkOrdersForDashboard } from "@/lib/data";
import { PERSONAS, resetWorld, signInApp, signOutApp, sql } from "../support/harness";

/**
 * The world below is the Figma sample (tests/preview/admin-dashboard-fixture.ts)
 * rebuilt as raw portal records, so the builder's wording can be compared with
 * the design's. "Now" is Monday 16 November 2026, 9:30 am local time.
 */
const NOW = new Date(2026, 10, 16, 9, 30);

/** The latest message of an inbox conversation. */
function last(partial: Partial<InboxLastMessage> & Pick<InboxLastMessage, "at" | "body">): InboxLastMessage {
  return { authorRole: null, authorUserId: null, authorTenantId: null, authorStaffId: null, ...partial };
}

function officeConversation(threadUserId: string, unread: boolean, message: InboxLastMessage): InboxConversation {
  return { key: `office:${threadUserId}`, kind: "office", threadUserId, last: message, unread };
}

/** A local wall-clock time as the ISO string the database would return. */
function at(year: number, month: number, day: number, hour = 0, minute = 0): string {
  return new Date(year, month - 1, day, hour, minute).toISOString();
}

const VIEWER: AdminDashboardViewer = { displayName: "Ada Admin", email: "ada@landlordgopher.example", role: "admin" };

function landlord(id: number, first: string, last: string): Landlord {
  return {
    id,
    first_name: first,
    last_name: last,
    company_name: null,
    email: `${first.toLowerCase()}@example.com`,
    phone: null,
    preferred_contact: null,
    notes: null,
    created_at: at(2026, 1, 1),
  };
}

function property(id: number, name: string, landlordId: number): Property {
  return {
    id,
    name,
    type: "multi_family",
    address: null,
    city: null,
    state: null,
    zip: null,
    year_built: null,
    notes: null,
    color: "sky",
    landlord_id: landlordId,
    landlord_name: null,
    created_at: at(2026, 1, 1),
  };
}

function unit(id: number, propertyId: number, name: string, partial: Partial<Unit> = {}): Unit {
  return {
    id,
    property_id: propertyId,
    name,
    bedrooms: 2,
    bathrooms: 1,
    sqft: null,
    market_rent: 1400,
    status: "occupied",
    readiness_status: "ready",
    notes: null,
    created_at: at(2026, 1, 1),
    ...partial,
  };
}

function tenant(id: number, first: string, last: string, unitName: string | null): Tenant {
  return {
    id,
    first_name: first,
    last_name: last,
    email: null,
    phone: null,
    date_of_birth: null,
    emergency_contact: null,
    employer: null,
    monthly_income: null,
    notes: null,
    created_at: at(2026, 1, 1),
    active_unit_name: unitName,
  };
}

function wo(partial: Partial<WorkOrder> & Pick<WorkOrder, "id" | "title">): WorkOrder {
  return {
    request_number: `MR-${String(partial.id).padStart(6, "0")}`,
    property_id: 1,
    unit_id: null,
    tenant_id: null,
    vendor_id: null,
    description: null,
    category: "General repair",
    priority: "normal",
    status: "open",
    permission_to_enter: false,
    assigned_staff_id: null,
    scheduled_at: null,
    completed_at: null,
    worker_price: null,
    landlord_price: null,
    notes: null,
    created_at: at(2026, 11, 10, 9),
    ...partial,
  };
}

function lease(partial: Partial<Lease> & Pick<Lease, "id" | "unit_id" | "start_date" | "end_date">): Lease {
  return {
    primary_tenant_id: null,
    monthly_rent: 1400,
    deposit: 0,
    rent_due_day: 1,
    late_fee: 0,
    status: "active",
    notes: null,
    created_at: at(2026, 1, 1),
    ...partial,
  };
}

function charge(partial: Partial<RentCharge> & Pick<RentCharge, "id" | "lease_id" | "amount" | "amount_paid">): RentCharge {
  return {
    period: "2026-11",
    due_date: "2026-11-01",
    status: partial.amount_paid >= partial.amount ? "paid" : partial.amount_paid > 0 ? "partial" : "open",
    notes: null,
    created_at: at(2026, 11, 1),
    ...partial,
  };
}

function account(partial: Partial<UserAccountRow> & Pick<UserAccountRow, "user_id">): UserAccountRow {
  return {
    email: null,
    role: null,
    landlord_id: null,
    tenant_id: null,
    staff_id: null,
    account_status: "approved",
    created_at: at(2026, 1, 1),
    ...partial,
  };
}

const RAJ_CHARGE = charge({
  id: 102,
  lease_id: 2,
  amount: 1450,
  amount_paid: 725,
  tenant_id: 2,
  tenant_first_name: "Raj",
  tenant_last_name: "Patel",
  unit_name: "1B",
  property_id: 1,
  property_name: "Maple Court",
});

function sampleWorld(): AdminDashboardSources {
  const properties = [
    property(1, "Maple Court", 1),
    property(2, "Birch House", 1),
    property(3, "Cedar Row", 2),
    property(4, "Elm Street Duplex", 2),
  ];
  const units = [
    unit(11, 1, "1A"),
    unit(12, 1, "1B"),
    unit(21, 2, "1", { status: "vacant" }),
    unit(31, 3, "1"),
    unit(32, 3, "2"),
    unit(33, 3, "3"),
    unit(34, 3, "4"),
    unit(41, 4, "1"),
    unit(42, 4, "2"),
  ];
  const workOrders = [
    wo({
      id: 1000,
      title: "Kitchen faucet leaking",
      unit_id: 11,
      unit_name: "1A",
      tenant_id: 1,
      tenant_first_name: "Tina",
      tenant_last_name: "Renter",
      priority: "high",
      status: "scheduled",
      assigned_staff_id: 1,
      scheduled_at: at(2026, 11, 17, 10),
    }),
    wo({ id: 998, title: "Hallway light out", status: "in_progress", created_at: at(2026, 11, 13, 8) }),
    wo({
      id: 995,
      title: "Boiler making noise",
      property_id: 2,
      status: "on_hold",
      assigned_staff_id: 2,
      hold_reason: "Check part delivery",
      next_follow_up_date: "2026-11-20",
    }),
    wo({
      id: 990,
      title: "Bathroom fan",
      unit_id: 12,
      unit_name: "1B",
      status: "closed",
      vendor_id: 7,
      vendor_name: "Harbor Electric",
      completed_at: at(2026, 11, 13, 15),
      // Spend and activity show what the landlord is billed, not the worker's pay.
      worker_price: 120,
      landlord_price: 180,
    }),
    wo({ id: 900, title: "Gutter repair", status: "closed", assigned_staff_id: 1, completed_at: at(2026, 3, 2, 11), worker_price: 800, landlord_price: 1060 }),
    // Completed last year: counts for nothing this year.
    wo({ id: 800, title: "Old job", status: "closed", assigned_staff_id: 1, completed_at: at(2025, 12, 30, 11), worker_price: 700, landlord_price: 999 }),
  ];
  const leases = [
    lease({ id: 1, unit_id: 11, primary_tenant_id: 1, start_date: "2026-02-01", end_date: "2027-01-31", unit_name: "1A", property_id: 1, property_name: "Maple Court", tenant_first_name: "Tina", tenant_last_name: "Renter" }),
    lease({ id: 2, unit_id: 12, primary_tenant_id: 2, start_date: "2025-12-16", end_date: "2026-12-15", unit_name: "1B", property_id: 1, property_name: "Maple Court", tenant_first_name: "Raj", tenant_last_name: "Patel" }),
    // Ends this month, but the renewal is already signed.
    lease({ id: 3, unit_id: 42, primary_tenant_id: 3, start_date: "2025-12-01", end_date: "2026-11-30", unit_name: "2", property_id: 4, property_name: "Elm Street Duplex", tenant_first_name: "Una", tenant_last_name: "Stay" }),
    lease({ id: 4, unit_id: 42, primary_tenant_id: 3, start_date: "2026-12-01", end_date: "2027-11-30", status: "upcoming", unit_name: "2", property_id: 4, property_name: "Elm Street Duplex" }),
    lease({ id: 5, unit_id: 33, start_date: "2026-11-23", end_date: "2027-11-22", monthly_rent: 1250, status: "upcoming", unit_name: "3", property_id: 3, property_name: "Cedar Row" }),
  ];
  // $11,300 expected, $10,575 collected: Raj still owes $725 from 1 November.
  const charges = [
    charge({ id: 101, lease_id: 1, amount: 1450, amount_paid: 1450, property_id: 1 }),
    RAJ_CHARGE,
    ...[103, 104, 105, 106].map((id) => charge({ id, lease_id: id, amount: 1400, amount_paid: 1400, property_id: 3 })),
    ...[107, 108].map((id) => charge({ id, lease_id: id, amount: 1400, amount_paid: 1400, property_id: 4 })),
    // Last month, fully paid: must not leak into this month's numbers.
    charge({ id: 90, lease_id: 1, amount: 1450, amount_paid: 1450, period: "2026-10", due_date: "2026-10-01", property_id: 1 }),
  ];
  const paymentsAwaitingVerification: PaymentAwaitingVerification[] = [
    { id: 5, charge_id: 102, tenant_id: 2, amount: 725, method: "zelle", reported_at: at(2026, 11, 13, 18, 12), charge: RAJ_CHARGE },
  ];
  const accounts = [
    account({ user_id: "u-ada", email: "ada@landlordgopher.example", role: "admin" }),
    account({ user_id: "u-lena", role: "landlord", landlord_id: 1 }),
    account({ user_id: "u-raj", role: "tenant", tenant_id: 2 }),
    account({ user_id: "u-sam", role: "maintenance", staff_id: 1 }),
    account({ user_id: "u-lee", role: "maintenance", staff_id: 2 }),
    account({
      user_id: "u-riley",
      email: "riley.applicant@example.com",
      role: "tenant",
      account_status: "pending",
      created_at: at(2026, 11, 16, 8),
      email_confirmed_at: at(2026, 11, 16, 8, 5),
    }),
  ];
  const inbox: InboxConversation[] = [
    officeConversation("u-lena", true, last({ at: at(2026, 11, 16, 8, 40), body: "Boiler follow-up — can we confirm the part?", authorRole: "landlord", authorUserId: "u-lena" })),
    officeConversation("u-raj", true, last({ at: at(2026, 11, 13, 18, 13), body: "Sent the rest by Zelle. Please verify.", authorRole: "tenant", authorUserId: "u-raj" })),
    officeConversation("u-sam", true, last({ at: at(2026, 11, 16, 8, 50), body: "Tomorrow’s faucet visit is confirmed.", authorRole: "maintenance", authorUserId: "u-sam" })),
  ];
  const applications: Application[] = [
    {
      id: 9,
      unit_id: 33,
      first_name: "Cora",
      last_name: "Mover",
      email: null,
      phone: null,
      monthly_income: null,
      employer: null,
      desired_move_in: "2026-11-27",
      status: "approved",
      notes: null,
      created_at: at(2026, 11, 2),
      unit_name: "3",
      property_name: "Cedar Row",
    },
  ];

  return {
    properties,
    units,
    workOrders,
    viewer: VIEWER,
    landlords: [landlord(1, "Lena", "Owner"), landlord(2, "Oscar", "Owner")],
    leases,
    charges,
    accounts,
    staff: [
      { id: 1, first_name: "Sam", last_name: "Fixit", email: "sam@example.com", job_title: null, gets_request_alerts: true },
      { id: 2, first_name: "Lee", last_name: "Wrench", email: "lee@example.com", job_title: null, gets_request_alerts: true },
    ],
    tenants: [tenant(1, "Tina", "Renter", "1A"), tenant(2, "Raj", "Patel", "1B"), tenant(3, "Una", "Stay", "2")],
    applications,
    marketing: [11, 12, 31, 32, 34, 41].map((unit_id) => ({ unit_id, marketed: true })).concat([{ unit_id: 21, marketed: false }]),
    paymentsAwaitingVerification,
    statusEvents: [
      { id: 1, maintenance_request_id: 998, from_status: "open", to_status: "in_progress", changed_by_user_id: "u-lee", changed_by_role: "maintenance", note: null, created_at: at(2026, 11, 16, 9, 15) },
      { id: 2, maintenance_request_id: 990, from_status: "in_progress", to_status: "closed", changed_by_user_id: null, changed_by_role: null, note: null, created_at: at(2026, 11, 13, 15) },
    ],
    comments: [],
    payments: [],
    documents: [
      { id: 1, created_at: at(2026, 11, 16, 9, 5), title: "Lease renewal 2027 — 1A.pdf", file_name: "lease.pdf", property_id: 1, unit_id: 11, uploaded_by_user_id: "u-ada", uploaded_by_role: "admin", uploaded_by_tenant_id: null },
    ],
    inbox,
  };
}

/** The sample world with one change. */
function world(patch: Partial<AdminDashboardSources> = {}): AdminDashboardSources {
  return { ...sampleWorld(), ...patch };
}

describe("helpers", () => {
  test("money shows whole dollars without cents, and cents only when there are some", () => {
    expect(money(10575)).toBe("$10,575");
    expect(money(0)).toBe("$0");
    expect(money(725.5)).toBe("$725.50");
  });

  test("request references reuse the database number", () => {
    expect(requestRef({ id: 12, request_number: "MR-001000" })).toBe("#MR-001000");
    expect(requestRef({ id: 12, request_number: null })).toBe("#12");
  });

  test("the dashboard reads last, this and next month's charges", () => {
    expect(dashboardChargePeriods(NOW)).toEqual(["2026-10", "2026-11", "2026-12"]);
    expect(dashboardChargePeriods(new Date(2026, 0, 5))).toEqual(["2025-12", "2026-01", "2026-02"]);
  });

  test("closed requests are loaded from the start of the year, or 90 days back early in the year", () => {
    // Mid November: the start of the year is further back than 90 days.
    expect(dashboardClosedSince(NOW)).toBe(new Date(2026, 0, 1).toISOString());
    // 5 January: 90 days back (7 Oct) reaches further than 1 January.
    expect(dashboardClosedSince(new Date(2026, 0, 5, 14))).toBe(new Date(2025, 9, 7).toISOString());
  });
});

describe("intro, empty and error states", () => {
  test("greets by first name and local hour, with the long date", () => {
    expect(buildDashboardIntro(VIEWER, NOW)).toEqual(fixtureIntro);
    expect(buildDashboardIntro(VIEWER, new Date(2026, 10, 16, 14)).greeting).toBe("Good afternoon, Ada.");
    expect(buildDashboardIntro(VIEWER, new Date(2026, 10, 16, 19)).greeting).toBe("Good evening, Ada.");
  });

  test("falls back to the name in the email address", () => {
    expect(buildDashboardIntro({ displayName: null, email: "ada.admin@example.com" }, NOW).greeting).toBe(
      "Good morning, Ada.",
    );
  });

  test("empty state matches the design wording when nothing exists yet", () => {
    const state = buildEmptyState(VIEWER, { units: 0, requests: 0, expectedRent: 0, liveHomes: 0 });
    expect(state.statsLines).toEqual(fixtureStates.empty.statsLines);
    expect(state.contactLines).toEqual(["Ada Admin · Admin · Landlord Gopher", "ada@landlordgopher.example"]);
  });

  test("empty state leaves out numbers that did not load", () => {
    expect(buildEmptyState(VIEWER).statsLines).toEqual(["No properties · No units · No requests"]);
  });

  test("no properties gives the empty state; otherwise ready", () => {
    const empty = buildDashboardState(world({ properties: [], units: [], workOrders: [], charges: [], marketing: [] }), VIEWER, NOW);
    expect(empty).toMatchObject({ status: "empty", statsLines: fixtureStates.empty.statsLines });
    expect(buildDashboardState(sampleWorld(), VIEWER, NOW).status).toBe("ready");
  });

  test("error state says when the last attempt was", () => {
    expect(buildErrorState(NOW, NOW)).toEqual(fixtureStates.error);
    expect(buildErrorState(NOW, new Date(2026, 10, 16, 9, 35)).lastAttemptLine).toBe(
      "Last attempt · 5 minutes ago, Mon 16 Nov 2026",
    );
    expect(buildErrorState(NOW, new Date(2026, 10, 17, 8)).lastAttemptLine).toBe(
      "Last attempt · 9:30 am, Mon 16 Nov 2026",
    );
  });
});

describe("KPI tiles", () => {
  const model = buildAdminDashboardModel(sampleWorld(), NOW);
  const tile = (id: string) => model.kpis.find((k) => k.id === id)!;

  test("six tiles in the design's order", () => {
    expect(model.kpis.map((k) => k.id)).toEqual(fixtureModel.kpis.map((k) => k.id));
    expect(model.kpis.map((k) => k.label)).toEqual(fixtureModel.kpis.map((k) => k.label));
  });

  test("open requests, rent, occupancy and unread match the design sample", () => {
    for (const id of ["open-requests", "rent-collected", "occupancy", "unread-messages"]) {
      const expected = fixtureModel.kpis.find((k) => k.id === id)!;
      expect(tile(id)).toMatchObject({ value: expected.value, detail: expected.detail });
    }
  });

  test("approvals names the one person waiting, and counts when there are more", () => {
    expect(tile("approvals")).toMatchObject({ value: "1", detail: "riley.applicant@example.com", href: "/people?tab=approvals" });
    const two = world();
    two.accounts = [...two.accounts!, account({ user_id: "u-x", email: "x@example.com", account_status: "pending" })];
    const approvals = buildAdminDashboardModel(two, NOW).kpis.find((k) => k.id === "approvals")!;
    expect(approvals).toMatchObject({ value: "2", detail: "2 people waiting" });
  });

  test("homes live counts published units and says what is vacant and unlisted", () => {
    expect(tile("homes-live")).toMatchObject({ value: "6", detail: "1 vacant not listed", href: "/listings" });
  });

  test("a failed secondary source shows a dash on its own tile only", () => {
    const degraded = buildAdminDashboardModel(world({ charges: null, accounts: null, inbox: null, marketing: null }), NOW);
    const value = (id: string) => degraded.kpis.find((k) => k.id === id)!.value;
    expect(["rent-collected", "approvals", "unread-messages", "homes-live"].map(value)).toEqual(["—", "—", "—", "—"]);
    expect(value("open-requests")).toBe("3");
    expect(value("occupancy")).toBe("89%");
  });

  test("no charges this month is a dash, not 0%", () => {
    const none = buildAdminDashboardModel(world({ charges: [] }), NOW);
    expect(none.kpis.find((k) => k.id === "rent-collected")).toMatchObject({
      value: "—",
      detail: "No rent charged for November yet",
    });
    expect(none.rent).toMatchObject({ headline: "No rent charged for November 2026 yet", progress: null });
  });

  test("an almost fully collected month never rounds up to 100%", () => {
    const charges = [charge({ id: 1, lease_id: 1, amount: 100000, amount_paid: 99999 })];
    expect(buildAdminDashboardModel(world({ charges }), NOW).rent.progress?.percent).toBe(99);
  });
});

describe("needs your attention", () => {
  test("ranks money first, then unassigned, approvals, leases, vacancies, follow-ups", () => {
    const { attention } = buildAdminDashboardModel(sampleWorld(), NOW);
    expect(attention.items.map((i) => i.id)).toEqual([
      "verify-5",
      "assign-998",
      "approve-u-riley",
      "lease-2",
      "vacant-21",
      "follow-up-995",
    ]);
    expect(attention.summaryLine).toBe(fixtureModel.attention.summaryLine);
    expect(attention.items.map((i) => i.actionLabel)).toEqual(fixtureModel.attention.items.map((i) => i.actionLabel));
    expect(attention.items.map((i) => i.icon)).toEqual(fixtureModel.attention.items.map((i) => i.icon));
  });

  test("words each item like the design", () => {
    const { attention } = buildAdminDashboardModel(sampleWorld(), NOW);
    const [verify, assign, approve, leaseItem, vacant, followUp] = attention.items;
    expect(verify).toMatchObject({
      title: "Verify $725 Zelle from Raj Patel",
      context: "Tenant · Maple Court 1B · 15 days late",
      // Opens the reported payment itself on the Rent page.
      href: "/rent?verify=5",
    });
    expect(assign).toMatchObject({
      title: "Unassigned request: Hallway light out",
      context: "In progress → Assign a team member · #MR-000998",
      href: "/maintenance/998",
    });
    expect(approve).toMatchObject({
      title: "riley.applicant@example.com is waiting for approval",
      context: "Applicant · Wants to be a tenant · Today, 16 Nov 2026",
      href: "/people?tab=approvals",
    });
    expect(leaseItem).toMatchObject({
      title: "Lease ends in 29 days · Unit 1B",
      context: "Raj Patel, tenant · Maple Court · Tue 15 Dec 2026",
      href: "/leases?lease=2",
      actionHref: "/leases",
    });
    expect(vacant).toMatchObject({
      title: "Birch House Unit 1 is vacant and not listed",
      context: "Lena Owner, landlord · Ready for move-in",
      href: "/properties/2",
      // Listings can't be published from the portal, so the action opens the property.
      actionLabel: "Open property",
    });
    expect(vacant.actionHref).toBeUndefined();
    expect(followUp).toMatchObject({
      title: "Boiler making noise · follow-up due Fri 20 Nov",
      context: "On hold → Follow up: Check part delivery · In 4 days, 20 Nov 2026",
      href: "/maintenance/995",
    });
  });

  test("an unassigned emergency outranks money; high priority leads the other unassigned", () => {
    const sources = world();
    sources.workOrders = [
      ...sources.workOrders,
      wo({ id: 1003, title: "Normal, older", created_at: at(2026, 11, 1) }),
      wo({ id: 1002, title: "High, newer", priority: "high", created_at: at(2026, 11, 15) }),
      wo({ id: 1001, title: "Burst pipe", priority: "urgent", created_at: at(2026, 11, 16, 7) }),
    ];
    const { attention } = buildAdminDashboardModel(sources, NOW);
    expect(attention.items.slice(0, 5).map((i) => i.id)).toEqual([
      "assign-1001",
      "verify-5",
      "assign-1002",
      "assign-1003",
      "assign-998",
    ]);
    expect(attention.items[0].title).toBe("Unassigned emergency: Burst pipe");
  });

  test("a lease with a renewal lined up, or ending later than 60 days, is not listed", () => {
    const ids = buildAdminDashboardModel(sampleWorld(), NOW).attention.items.map((i) => i.id);
    expect(ids).not.toContain("lease-3"); // renewal signed
    expect(ids).not.toContain("lease-1"); // ends in 76 days
  });

  test("a lease already past its end date is listed first among leases", () => {
    const sources = world();
    sources.leases = [...sources.leases!, lease({ id: 8, unit_id: 31, start_date: "2025-11-11", end_date: "2026-11-10", unit_name: "1", property_name: "Cedar Row" })];
    const items = buildAdminDashboardModel(sources, NOW).attention.items;
    const leases = items.filter((i) => i.id.startsWith("lease-"));
    expect(leases.map((i) => i.id)).toEqual(["lease-8", "lease-2"]);
    expect(leases[0].title).toBe("Lease ended 6 days ago · Unit 1");
  });

  test("vacant homes that are listed, not ready, or already leased are left out", () => {
    const sources = world();
    sources.units = [
      ...sources.units,
      unit(51, 4, "3", { status: "vacant" }), // listed below
      unit(52, 4, "4", { status: "vacant", readiness_status: "rehab_in_progress" }),
      unit(53, 4, "5", { status: "vacant" }), // upcoming lease below
    ];
    sources.marketing = [...sources.marketing!, { unit_id: 51, marketed: true }];
    sources.leases = [...sources.leases!, lease({ id: 9, unit_id: 53, start_date: "2026-12-01", end_date: "2027-11-30", status: "upcoming" })];
    const model = buildAdminDashboardModel(sources, NOW);
    expect(model.attention.items.filter((i) => i.id.startsWith("vacant-")).map((i) => i.id)).toEqual(["vacant-21"]);
    // The not-ready home is still counted as vacant and unlisted on the listings card.
    expect(model.listings.headline).toBe("7 live · 2 vacant not listed");
  });

  test("overdue follow-ups are listed; ones more than a week out are not", () => {
    const sources = world();
    sources.workOrders = [
      ...sources.workOrders,
      wo({ id: 1010, title: "Late one", status: "on_hold", assigned_staff_id: 1, next_follow_up_date: "2026-11-13" }),
      wo({ id: 1011, title: "Far one", status: "on_hold", assigned_staff_id: 1, next_follow_up_date: "2026-11-30" }),
    ];
    const followUps = buildAdminDashboardModel(sources, NOW).attention.items.filter((i) => i.id.startsWith("follow-up-"));
    expect(followUps.map((i) => i.id)).toEqual(["follow-up-1010", "follow-up-995"]);
    expect(followUps[0].title).toBe("Late one · follow-up overdue since Fri 13 Nov");
  });

  test("all clear: nothing to do", () => {
    const { attention } = buildAdminDashboardModel(
      world({
        workOrders: [],
        paymentsAwaitingVerification: [],
        accounts: [],
        leases: [],
        units: sampleWorld().units.filter((u) => u.status !== "vacant"),
      }),
      NOW,
    );
    expect(attention.items).toEqual([]);
    expect(attention.summaryLine).toBe("");
    expect(attention.resolvedLine).toBe("Checked today · Mon 16 Nov 2026");
    expect(attention.clearedLine).toBe(
      "No payments to verify, no one waiting for approval, no lease ending without a renewal and no ready home left unlisted. No requests are open.",
    );
  });

  test("all clear only claims what was checked", () => {
    const { attention } = buildAdminDashboardModel(
      world({
        workOrders: [wo({ id: 1, title: "Assigned job", assigned_staff_id: 1 })],
        paymentsAwaitingVerification: null,
        accounts: null,
        leases: [],
        units: sampleWorld().units.filter((u) => u.status !== "vacant"),
      }),
      NOW,
    );
    expect(attention.items).toEqual([]);
    expect(attention.clearedLine).toBe(
      "No lease ending without a renewal and no ready home left unlisted. Every open request has someone assigned and no follow-up is due this week. Couldn’t check payments and approvals right now.",
    );
  });

  test("items on the list carry no all-clear sentence", () => {
    expect(buildAdminDashboardModel(sampleWorld(), NOW).attention.clearedLine).toBeUndefined();
  });

  test("a long list is capped and the summary says so", () => {
    const sources = world();
    sources.workOrders = Array.from({ length: 12 }, (_, i) => wo({ id: 2000 + i, title: `Job ${i}` }));
    const { attention } = buildAdminDashboardModel(sources, NOW);
    expect(attention.items).toHaveLength(ATTENTION_LIMIT);
    expect(attention.summaryLine).toBe(
      `16 items · Showing the ${ATTENTION_LIMIT} most urgent. Only your office can resolve these.`,
    );
  });
});

describe("calendar", () => {
  const { calendar } = buildAdminDashboardModel(sampleWorld(), NOW);
  const event = (id: string) => calendar.events.find((e) => e.id === id)!;

  test("is anchored on today and sorted by day", () => {
    expect(calendar.today).toBe("2026-11-16");
    expect(calendar.href).toBe("/calendar");
    const days = calendar.events.map((e) => e.day);
    expect(days).toEqual([...days].sort());
  });

  test("rent due is one event per due date", () => {
    expect(event("rent-2026-11-2026-11-01")).toMatchObject({
      kind: "rent_due",
      day: "2026-11-01",
      title: "Rent due · 8 units",
      record: "November rent · $11,300 expected",
      details: ["3 of 4 properties"],
      href: "/rent?period=2026-11",
    });
    expect(event("rent-2026-10-2026-10-01")).toMatchObject({ title: "Rent due · 1 unit", details: ["Maple Court"] });
  });

  test("visit, follow-up and assignment events match the design", () => {
    expect(event("visit-1000")).toMatchObject({
      kind: "visit",
      day: "2026-11-17",
      title: "Scheduled visit · 10:00 am",
      record: "Kitchen faucet leaking · #MR-001000",
      details: ["Sam Fixit, team · Tina Renter, tenant", "Maple Court · Unit 1A"],
      actionLabel: "Open request",
      href: "/maintenance/1000",
    });
    expect(event("follow-up-995")).toMatchObject({
      kind: "follow_up",
      day: "2026-11-20",
      title: "Follow-up due · Check part delivery",
      record: "Boiler making noise · #MR-000995",
      details: ["Lee Wrench, team · Office report", "Birch House"],
    });
    expect(event("assign-998")).toMatchObject({
      kind: "follow_up",
      day: "2026-11-16",
      title: "Follow-up due · Assign a team member",
      record: "Hallway light out · #MR-000998",
      details: ["Unassigned · Office report", "Maple Court"],
    });
    expect(event("verify-5")).toMatchObject({
      kind: "follow_up",
      day: "2026-11-13",
      title: "Follow-up due · Verify payment",
      record: "$725 Zelle from Raj Patel",
      details: ["Raj Patel, tenant", "Maple Court · Unit 1B"],
      actionLabel: "Open rent",
    });
  });

  test("a date-only visit has no clock time", () => {
    const sources = world();
    sources.workOrders = [wo({ id: 3000, title: "Inspect roof", assigned_staff_id: 1, status: "scheduled", scheduled_at: "2026-11-18T12:00:00.000Z" })];
    const visit = buildAdminDashboardModel(sources, NOW).calendar.events.find((e) => e.id === "visit-3000")!;
    expect(visit).toMatchObject({ day: "2026-11-18", title: "Scheduled visit" });
  });

  test("lease starts and ends, with the renewal named when there is one", () => {
    expect(event("lease-start-5")).toMatchObject({
      kind: "lease_start",
      day: "2026-11-23",
      title: "Lease starts · Cedar Row Unit 3",
      record: "12 months · $1,250 a month",
      details: ["Oscar Owner, landlord", "Cedar Row · Unit 3"],
      actionLabel: "Open lease",
      href: "/leases?lease=5",
    });
    expect(event("lease-end-3")).toMatchObject({
      kind: "lease_end",
      day: "2026-11-30",
      title: "Lease ends · Elm Street Duplex Unit 2",
      record: "Renewal starts Tue 1 Dec 2026",
      details: ["Una Stay, tenant · Oscar Owner, landlord", "Elm Street Duplex · Unit 2"],
    });
    expect(event("lease-end-2")).toMatchObject({ day: "2026-12-15", record: "Renewal not started" });
  });

  test("move-in is the desired date on a live application", () => {
    expect(event("move-in-9")).toMatchObject({
      kind: "move_in",
      day: "2026-11-27",
      title: "Desired move-in · Cedar Row Unit 3",
      record: "Cora Mover, applicant · Application approved",
      href: "/applications?app=9",
    });
  });

  test("only the previous, current and next month are included", () => {
    const sources = world();
    sources.workOrders = [
      wo({ id: 1, title: "Too early", assigned_staff_id: 1, next_follow_up_date: "2026-09-30" }),
      wo({ id: 2, title: "First day", assigned_staff_id: 1, next_follow_up_date: "2026-10-01" }),
      wo({ id: 3, title: "Last day", assigned_staff_id: 1, next_follow_up_date: "2026-12-31" }),
      wo({ id: 4, title: "Too late", assigned_staff_id: 1, next_follow_up_date: "2027-01-01" }),
    ];
    const ids = buildAdminDashboardModel(sources, NOW).calendar.events.filter((e) => e.id.startsWith("follow-up-")).map((e) => e.id);
    expect(ids).toEqual(["follow-up-2", "follow-up-3"]);
  });
});

describe("recent activity", () => {
  test("groups by local day, newest first, people as name and role", () => {
    const { activity } = buildAdminDashboardModel(sampleWorld(), NOW);
    expect(activity.summaryLine).toBe(fixtureModel.activity.summaryLine);
    expect(activity.groups.map((g) => g.label)).toEqual(fixtureModel.activity.groups.map((g) => g.label));
    expect(activity.groups.map((g) => g.id)).toEqual(["2026-11-16", "2026-11-13"]);

    expect(activity.groups[0].items.map((i) => [i.icon, i.title, i.context, i.href])).toEqual([
      ["wrench", "Lee Wrench, team, started work on Hallway light out", "Maple Court · #MR-000998 · Today, 16 Nov 2026 · 9:15 am", "/maintenance/998"],
      ["file", "Ada Admin, admin, shared Lease renewal 2027 — 1A.pdf", "Maple Court 1A · Today, 16 Nov 2026 · 9:05 am", "/documents"],
      ["user", "riley.applicant@example.com, applicant, asked for portal access", "Wants to be a tenant · Today, 16 Nov 2026 · 8:00 am", "/people?tab=approvals"],
    ]);
    expect(activity.groups[1].items.map((i) => [i.icon, i.title, i.context])).toEqual([
      ["dollar", "Raj Patel, tenant, sent $725 by Zelle", "Maple Court 1B · Awaiting verification · Fri 13 Nov 2026 · 6:12 pm"],
      ["check", "Bathroom fan completed · $180 · Harbor Electric, vendor", "Maple Court 1B · #MR-000990 · Fri 13 Nov 2026 · 3:00 pm"],
    ]);
  });

  test("yesterday, comments, payments and unnamed actors", () => {
    const sources = world({ documents: [], paymentsAwaitingVerification: [], accounts: [], statusEvents: [] });
    const comments: RecentMaintenanceComment[] = [
      { id: 4, maintenance_request_id: 1000, body: "Can someone come Tuesday?", visibility: "tenant_visible", author_role: "tenant", author_staff_id: null, author_tenant_id: 1, author_user_id: null, created_at: at(2026, 11, 15, 17, 30) },
    ];
    sources.comments = comments;
    sources.payments = [
      { id: 6, charge_id: 102, paid_at: at(2026, 11, 15, 12), amount: 725, method: "check", reference: null, notes: null, charge: RAJ_CHARGE },
    ];
    sources.statusEvents = [
      { id: 7, maintenance_request_id: 1000, from_status: null, to_status: "open", changed_by_user_id: null, changed_by_role: "tenant", note: "Created", created_at: at(2026, 11, 15, 9) },
      { id: 8, maintenance_request_id: 995, from_status: "open", to_status: "on_hold", changed_by_user_id: null, changed_by_role: null, note: null, created_at: at(2026, 11, 15, 8) },
    ];
    const { activity } = buildAdminDashboardModel(sources, NOW);
    expect(activity.groups).toHaveLength(1);
    expect(activity.groups[0].label).toBe("Yesterday · Sun 15 Nov 2026");
    expect(activity.groups[0].items.map((i) => i.title)).toEqual([
      "Tina Renter, tenant, commented on Kitchen faucet leaking",
      "Raj Patel, tenant, paid $725 by check",
      "A tenant reported Kitchen faucet leaking",
      "Boiler making noise was put on hold",
    ]);
    expect(activity.groups[0].items[1].context).toBe("Maple Court 1B · Rent for November 2026 · Sun 15 Nov 2026 · 12:00 pm");
  });

  test("older than 30 days or in the future is left out", () => {
    const sources = world({ documents: [], paymentsAwaitingVerification: [], accounts: [] });
    sources.statusEvents = [
      { id: 1, maintenance_request_id: 998, from_status: "open", to_status: "in_progress", changed_by_user_id: null, changed_by_role: null, note: null, created_at: at(2026, 10, 1, 9) },
      { id: 2, maintenance_request_id: 998, from_status: "open", to_status: "in_progress", changed_by_user_id: null, changed_by_role: null, note: null, created_at: at(2026, 11, 17, 9) },
    ];
    expect(buildAdminDashboardModel(sources, NOW).activity.groups).toEqual([]);
  });

  test("says so when no activity source loaded", () => {
    const { activity } = buildAdminDashboardModel(
      world({ statusEvents: null, comments: null, payments: null, documents: null, paymentsAwaitingVerification: null, accounts: null }),
      NOW,
    );
    expect(activity).toEqual({ summaryLine: "Recent activity isn’t available right now.", groups: [] });
  });
});

describe("rent this month", () => {
  test("matches the design sample", () => {
    expect(buildAdminDashboardModel(sampleWorld(), NOW).rent).toEqual({ ...fixtureModel.rent });
  });

  test("fully collected matches the design's all-clear frame", () => {
    const charges = sampleWorld().charges!.map((c) => ({ ...c, amount_paid: c.amount, status: "paid" as const }));
    const payments = [
      { id: 6, charge_id: 102, paid_at: at(2026, 11, 16, 9), amount: 725, method: "zelle" as never, reference: null, notes: null, charge: RAJ_CHARGE },
      { id: 5, charge_id: 101, paid_at: at(2026, 11, 2, 9), amount: 1450, method: "check" as const, reference: null, notes: null, charge: RAJ_CHARGE },
    ];
    const { rent } = buildAdminDashboardModel(world({ charges, payments, paymentsAwaitingVerification: [] }), NOW);
    expect(rent).toEqual(fixtureStates["all-clear"].model.rent);
  });

  test("fully collected with nothing else known", () => {
    const charges = sampleWorld().charges!.map((c) => ({ ...c, amount_paid: c.amount, status: "paid" as const }));
    const { rent } = buildAdminDashboardModel(world({ charges, payments: null, paymentsAwaitingVerification: null }), NOW);
    expect(rent.lines).toEqual(["100% collected · $0 outstanding", "No late tenants"]);
    expect(rent.noteLines).toBeUndefined();
  });

  test("several tenants late, a waived charge, and a single property", () => {
    const charges = [
      charge({ id: 1, lease_id: 1, amount: 1000, amount_paid: 0, tenant_id: 1 }),
      charge({ id: 2, lease_id: 2, amount: 1000, amount_paid: 400, tenant_id: 2 }),
      charge({ id: 3, lease_id: 3, amount: 500, amount_paid: 0, status: "waived" }),
      // Due later this month: outstanding, not late.
      charge({ id: 4, lease_id: 4, amount: 1000, amount_paid: 0, due_date: "2026-11-20" }),
    ];
    const { rent } = buildAdminDashboardModel(world({ charges, properties: [property(1, "Maple Court", 1)], paymentsAwaitingVerification: null }), NOW);
    expect(rent.scopeLine).toBe("November 2026 · Maple Court");
    expect(rent.headline).toBe("$400 of $3,000 collected");
    expect(rent.progress?.caption).toBe("$2,600 outstanding · 2 tenants late");
    expect(rent.lines).toEqual(["Collected $400", "Outstanding $2,600 · 2 tenants late"]);
  });

  test("unavailable when charges did not load", () => {
    expect(buildAdminDashboardModel(world({ charges: null }), NOW).rent).toMatchObject({
      headline: "Rent isn’t available right now.",
      progress: null,
      lines: [],
      href: "/rent",
    });
  });
});

describe("maintenance snapshot", () => {
  const { maintenance } = buildAdminDashboardModel(sampleWorld(), NOW);

  test("counts, spend and the three most important open requests", () => {
    expect(maintenance.summaryLine).toBe(fixtureModel.maintenance.summaryLine);
    expect(maintenance.countLines).toEqual(["New 0 · Assigned 1 · In progress 1", "On hold 1 · Completed 1 this month"]);
    expect(maintenance.spendLine).toBe(fixtureModel.maintenance.spendLine);
    expect(maintenance.href).toBe("/maintenance");
    expect(maintenance.requests.map((r) => r.id)).toEqual(["1000", "998", "995"]);
  });

  test("status is always followed by the next step", () => {
    expect(maintenance.requests[0]).toEqual(fixtureModel.maintenance.requests[0]);
    expect(maintenance.requests[1]).toEqual({
      id: "998",
      heading: "#MR-000998 · Hallway light out",
      context: "Maple Court · Office report",
      statusLine: "In progress → Assign a team member",
      meta: "Unassigned · Reported 3 days ago, Fri 13 Nov 2026",
      href: "/maintenance/998",
    });
    expect(maintenance.requests[2]).toEqual({
      id: "995",
      heading: "#MR-000995 · Boiler making noise",
      context: "Birch House · Office report",
      statusLine: "On hold → Follow up: Check part delivery",
      meta: "Follow-up in 4 days · Fri 20 Nov 2026",
      href: "/maintenance/995",
    });
  });

  test("emergencies lead, and spend is left out when nothing was priced this year", () => {
    const sources = world();
    sources.workOrders = [
      wo({ id: 1, title: "Normal" , assigned_staff_id: 1 }),
      wo({ id: 2, title: "No heat", priority: "urgent", assigned_staff_id: 1 }),
      wo({ id: 3, title: "Done, no price", status: "closed", completed_at: at(2026, 11, 2) }),
    ];
    const snapshot = buildAdminDashboardModel(sources, NOW).maintenance;
    expect(snapshot.requests.map((r) => r.id)).toEqual(["2", "1"]);
    expect(snapshot.requests[0].statusLine).toBe("Emergency · Assigned → Schedule a visit");
    expect(snapshot.requests[0].meta).toBe("Sam Fixit, team · Not scheduled yet");
    expect(snapshot.summaryLine).toBe("2 open · 1 emergency · 0 need action");
    expect(snapshot.spendLine).toBeNull();
  });
});

describe("messages", () => {
  test("latest office threads with real unread state", () => {
    const { messages } = buildAdminDashboardModel(sampleWorld(), NOW);
    expect(messages.summaryLine).toBe(fixtureModel.messages.summaryLine);
    expect(messages.threads.map((t) => [t.icon, t.name, t.preview, t.time, t.unread])).toEqual([
      ["wrench", "Sam Fixit · Team", "Tomorrow’s faucet visit is confirmed.", "Today · 16 Nov", true],
      ["user", "Lena Owner · Landlord", "Boiler follow-up — can we confirm the part?", "Today · 16 Nov", true],
      ["user", "Raj Patel · Tenant · 1B", "Sent the rest by Zelle. Please verify.", "Fri · 13 Nov", true],
    ]);
    // Each row opens its own conversation on the Messages page.
    expect(messages.threads.map((t) => t.href)).toEqual([
      "/messages?thread=office%3Au-sam",
      "/messages?thread=office%3Au-lena",
      "/messages?thread=office%3Au-raj",
    ]);
  });

  test("request conversations carry the shared unread state, and the KPI counts the same inbox", () => {
    const inbox: InboxConversation[] = [
      {
        key: "wo:1000",
        kind: "request",
        requestId: 1000,
        last: last({ at: at(2026, 11, 16, 9, 20), body: "Can someone come\nTuesday?", authorRole: "tenant", authorTenantId: 1 }),
        unread: true,
      },
      officeConversation("u-sam", false, last({ at: at(2026, 11, 16, 8, 50), body: "Thanks!", authorRole: "admin" })),
    ];
    const model = buildAdminDashboardModel(world({ inbox }), NOW);
    expect(model.messages.summaryLine).toBe("1 unread · Latest conversations");
    expect(model.kpis.find((k) => k.id === "unread-messages")!.value).toBe("1");
    expect(model.messages.threads[0]).toEqual({
      id: "wo-1000",
      icon: "user",
      name: "Tina Renter · Tenant · 1A",
      preview: "Kitchen faucet leaking — Can someone come Tuesday?",
      time: "Today · 16 Nov",
      unread: true,
      href: "/messages?thread=wo:1000",
    });
    expect(model.messages.threads[1]).toMatchObject({ id: "office-u-sam", unread: false });
  });

  test("a request conversation is named by who it is with — like the Messages page — not by who wrote last", () => {
    const base = sampleWorld();
    const inbox: InboxConversation[] = [
      {
        key: "wo:1000",
        kind: "request",
        requestId: 1000,
        // Sam (the team member on it) wrote last; the conversation is still with Tina.
        last: last({ at: at(2026, 11, 16, 9, 20), body: "On my way.", authorRole: "maintenance", authorStaffId: 1 }),
        unread: true,
      },
      {
        key: "wo:995",
        kind: "request",
        requestId: 995,
        last: last({ at: at(2026, 11, 16, 9, 10), body: "Part arrives Friday.", authorRole: "admin" }),
        unread: false,
      },
    ];
    // No tenant on the boiler job: it is with the team member assigned.
    const workOrders = base.workOrders.map((w) =>
      w.id === 995 ? { ...w, tenant_id: null, tenant_first_name: null, tenant_last_name: null } : w,
    );
    const { messages } = buildAdminDashboardModel({ ...base, workOrders, inbox }, NOW);
    expect(messages.threads.map((t) => [t.id, t.icon, t.name])).toEqual([
      ["wo-1000", "user", "Tina Renter · Tenant · 1A"],
      ["wo-995", "wrench", "Lee Wrench · Team"],
    ]);
  });

  test("unavailable when the inbox did not load", () => {
    expect(buildAdminDashboardModel(world({ inbox: null }), NOW).messages).toEqual({
      summaryLine: "Messages aren’t available right now.",
      threads: [],
      href: "/messages",
    });
  });
});

describe("listings and portfolio", () => {
  const model = buildAdminDashboardModel(sampleWorld(), NOW);

  test("listings: live count, what is vacant and unlisted, and an honest inquiries line", () => {
    expect(model.listings).toEqual({
      summaryLine: "Homes on your public marketing site",
      headline: "6 live · 1 vacant not listed",
      inquiryLine: "Website inquiries aren’t connected to the portal yet.",
      noteLines: ["Birch House · Unit 1", "Vacant, ready and not marketed"],
      href: "/listings",
    });
  });

  test("listings: nothing left to list", () => {
    const sources = world();
    sources.marketing = [...sources.marketing!.filter((m) => m.unit_id !== 21), { unit_id: 21, marketed: true }];
    expect(buildAdminDashboardModel(sources, NOW).listings).toMatchObject({
      summaryLine: "",
      headline: "7 live · 0 not listed",
      noteLines: [],
    });
  });

  test("listings: unavailable when the marketing flags did not load", () => {
    const degraded = buildAdminDashboardModel(world({ marketing: null }), NOW);
    expect(degraded.listings.headline).toBe("Website listings aren’t available right now.");
    // The home is still known to be vacant, just not whether it is listed.
    expect(degraded.attention.items.find((i) => i.id === "vacant-21")).toMatchObject({
      title: "Birch House Unit 1 is vacant",
      href: "/properties/2",
      actionLabel: "Open property",
    });
  });

  test("portfolio groups properties by landlord with unit and vacancy counts", () => {
    expect(model.portfolio).toEqual({
      groups: [
        { id: "1", owner: "Lena Owner · Landlord", lines: ["Birch House · 1 vacant unit", "Maple Court · 2 units"] },
        { id: "2", owner: "Oscar Owner · Landlord", lines: ["Cedar Row · 4 units", "Elm Street Duplex · 2 units"] },
      ],
      totalsLine: fixtureModel.portfolio.totalsLine,
    });
  });

  test("portfolio falls back to the landlord name on the property", () => {
    const sources = world({ landlords: null });
    sources.properties = sources.properties.map((p) => ({ ...p, landlord_name: p.landlord_id === 1 ? "Owner Holdings LLC" : null }));
    const groups = buildAdminDashboardModel(sources, NOW).portfolio.groups;
    expect(groups.map((g) => g.owner)).toEqual(["Landlord not set", "Owner Holdings LLC · Landlord"]);
  });
});

describe("every link is a route the portal has", () => {
  test("hrefs", () => {
    const model = buildAdminDashboardModel(sampleWorld(), NOW);
    const hrefs = [
      ...model.kpis.map((k) => k.href),
      ...model.attention.items.flatMap((i) => [i.href, i.actionHref]),
      ...model.calendar.events.map((e) => e.href),
      model.calendar.href,
      ...model.activity.groups.flatMap((g) => g.items.map((i) => i.href)),
      model.rent.href,
      model.maintenance.href,
      ...model.maintenance.requests.map((r) => r.href),
      model.messages.href,
      ...model.messages.threads.map((t) => t.href),
      model.listings.href,
    ].filter((href): href is string => Boolean(href));
    const route =
      /^\/(maintenance(\/\d+)?|rent(\?(period=\d{4}-\d{2}|verify=\d+))?|properties(\/\d+)?|people\?tab=approvals|messages(\?thread=(wo:\d+|office%3A[\w-]+))?|listings|leases(\?lease=\d+)?|applications\?app=\d+|calendar|documents)$/;
    for (const href of hrefs) expect(href).toMatch(route);
  });
});

/**
 * The loader's new read-only queries, against the local emulator's seeded
 * world, signed in as the admin exactly as the browser would be.
 */
describe("loading from the portal database", () => {
  let world: Awaited<ReturnType<typeof resetWorld>>;
  beforeAll(async () => {
    world = await resetWorld();
    await signInApp("admin");
    return async () => {
      await signOutApp();
    };
  });

  test("every source loads for an admin and builds a ready dashboard", async () => {
    const now = new Date();
    const viewer = { displayName: null, email: PERSONAS.admin.email, role: "admin" };
    const sources = await loadAdminDashboardSources({ viewer, properties: [], landlords: [], now });

    for (const [name, value] of Object.entries(sources)) {
      if (name === "landlords") continue; // comes from the app shell, not this loader
      expect(value, `${name} failed to load`).not.toBeNull();
    }
    expect(sources.properties.map((p) => p.name).sort()).toEqual(["Birch House", "Maple Court"]);
    expect(sources.units).toHaveLength(3);
    expect(sources.marketing).toHaveLength(3);

    const state = buildDashboardState(sources, viewer, now);
    expect(state.status).toBe("ready");
    if (state.status !== "ready") return;
    expect(state.model.kpis.map((k) => k.id)).toEqual(fixtureModel.kpis.map((k) => k.id));
    expect(state.model.kpis.find((k) => k.id === "occupancy")).toMatchObject({ value: "100%", detail: "3 of 3 units occupied" });
    // The seeded approval queue holds one pending account.
    expect(state.model.kpis.find((k) => k.id === "approvals")?.value).toBe("1");
    expect(state.model.portfolio.totalsLine).toBe("2 landlords · 2 properties · 3 units");
  });

  test("the dashboard loads open requests and recent closed ones, not old history", async () => {
    const make = (title: string) =>
      createWorkOrder({ title, property_id: world.property.id, unit_id: world.units.a.id });
    const longAgo = await make("Closed three years ago");
    const lately = await make("Closed yesterday");
    await make("Still open");
    await sql(
      // A request cannot close before it was created, so age the whole row.
      `update public."MaintenanceRequests" set status = 'Closed', resolution_notes = 'Done', started_at = null,
         created_at = now() - interval '3 years 1 day', closed_at = now() - interval '3 years' where id = $1`,
      [longAgo.id],
    );
    await sql(
      `update public."MaintenanceRequests" set status = 'Closed', resolution_notes = 'Done', started_at = null,
         created_at = now() - interval '2 days', closed_at = now() - interval '1 day' where id = $1`,
      [lately.id],
    );

    const all = await listWorkOrders();
    const loaded = await listWorkOrdersForDashboard(dashboardClosedSince(new Date()));
    const ids = loaded.map((wo) => wo.id).sort((x, y) => x - y);
    // Everything except the request closed three years ago, each exactly once.
    expect(ids).toEqual(
      all
        .filter((wo) => wo.id !== longAgo.id)
        .map((wo) => wo.id)
        .sort((x, y) => x - y),
    );
    expect(loaded.find((wo) => wo.id === lately.id)?.status).toBe("closed");
    // Same joined shape as the full list.
    expect(loaded.find((wo) => wo.id === lately.id)).toEqual(all.find((wo) => wo.id === lately.id));
  });
});
