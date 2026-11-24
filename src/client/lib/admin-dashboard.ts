/**
 * Admin Dashboard data layer: portal records in, worded view model out.
 *
 * Everything here is pure. `now` is always passed in, all date math is in local
 * calendar days, and nothing is invented: where the portal has no source for
 * something the design shows, the model carries an honest fallback and the
 * spot is marked `TODO(data-gap)`.
 *
 * Core sources (`properties`, `units`, `workOrders`) are required. Every other
 * source is nullable — `null` means "failed or unavailable" — and only the
 * card or tile that needed it degrades.
 */
import type {
  ActivityGroup,
  ActivityItem,
  ActivityModel,
  AdminDashboardModel,
  AdminDashboardState,
  AdminIconName,
  AttentionItem,
  AttentionModel,
  DashboardCalendarEvent,
  DashboardCalendarModel,
  DashboardEventKind,
  DashboardIntroModel,
  KpiTile,
  ListingsModel,
  MaintenanceSnapshotModel,
  MessagesModel,
  PortfolioGroup,
  PortfolioModel,
  RentModel,
  RequestSummary,
  ThreadSummary,
} from "@/components/dashboard/admin-dashboard-model";
import {
  addDays,
  dayDiff,
  formatClock,
  formatDayLong,
  formatDayMonth,
  formatDayNoWeekday,
  formatDayShort,
  formatMonthYear,
  formatWeekdayDayMonth,
  greetingForHour,
  monthName,
  parseDay,
  relativeDayLabel,
  toDay,
  weekdayLong,
  weekdayShort,
} from "@/lib/admin-dates";
import { toCalendarDay } from "@/lib/calendar-events";
import type {
  PaymentAwaitingVerification,
  RecentDocumentUpload,
  RecentMaintenanceComment,
  RecentPayment,
  RecentStatusEvent,
  StaffMember,
  UnitMarketingFlag,
  UserAccountRow,
} from "@/lib/data";
import { staffQueueTab } from "@/components/maintenance/request-status";
import { countUnreadConversations, officeKey, type InboxConversation } from "@/lib/inbox";
import { displayNameFromEmail } from "@/lib/portal-nav";
import { liveUnits, vacantUnlistedUnits } from "@/lib/listings-overview";
import { isOpenRequest, toRequestStatus } from "@/lib/request-status";
import { formatMoney } from "@/lib/utils";
import {
  UNIT_READINESS_LABELS,
  type Application,
  type Landlord,
  type Lease,
  type Property,
  type RentCharge,
  type Tenant,
  type Unit,
  type WorkOrder,
  type WorkOrderStatus,
} from "@/types";

// ── Inputs ─────────────────────────────────────────────────────────

/** The signed-in admin, as the page knows them. */
export interface AdminDashboardViewer {
  displayName: string | null;
  email: string;
  role: string;
}

/** Raw portal data the dashboard is built from. `null` = that read failed. */
export interface AdminDashboardSources {
  // Core — without these the page cannot be drawn at all.
  properties: Property[];
  units: Unit[];
  /**
   * Every open request, plus closed ones completed since `dashboardClosedSince`
   * (they feed "completed", spend, and recent activity and threads).
   */
  workOrders: WorkOrder[];

  // Secondary — each degrades only the tiles and cards that use it.
  /** Used to put a name on activity by the signed-in admin. */
  viewer?: AdminDashboardViewer | null;
  landlords: Landlord[] | null;
  leases: Lease[] | null;
  /** Rent charges for last month, this month and next month. */
  charges: RentCharge[] | null;
  accounts: UserAccountRow[] | null;
  staff: StaffMember[] | null;
  tenants: Tenant[] | null;
  applications: Application[] | null;
  /** Which units are published on the public website. */
  marketing: UnitMarketingFlag[] | null;
  /** Tenant-reported Zelle payments the office has not confirmed. */
  paymentsAwaitingVerification: PaymentAwaitingVerification[] | null;
  statusEvents: RecentStatusEvent[] | null;
  comments: RecentMaintenanceComment[] | null;
  payments: RecentPayment[] | null;
  documents: RecentDocumentUpload[] | null;
  /** Every conversation the admin can open in Messages, with real unread state. */
  inbox: InboxConversation[] | null;
}

// ── Tunables ───────────────────────────────────────────────────────

/** A lease counts as "ending soon" this many days ahead. */
export const LEASE_ENDING_SOON_DAYS = 60;
/** A follow-up needs attention when overdue or due within this many days. */
export const FOLLOW_UP_SOON_DAYS = 7;
/** The attention list shows at most this many items (the summary says how many there are). */
export const ATTENTION_LIMIT = 8;
const ACTIVITY_LIMIT = 8;
const ACTIVITY_WINDOW_DAYS = 30;
const SNAPSHOT_REQUESTS = 3;
const MESSAGE_THREADS = 3;
const PORTFOLIO_GROUPS = 6;
const PORTFOLIO_LINES = 5;

const ROUTES = {
  maintenance: "/maintenance",
  request: (id: number) => `/maintenance/${id}`,
  rent: "/rent",
  rentPeriod: (period: string) => `/rent?period=${period}`,
  /** The Rent page opens the reported Zelle payment waiting to be verified. */
  rentVerify: (intentId: number) => `/rent?verify=${intentId}`,
  properties: "/properties",
  property: (id: number) => `/properties/${id}`,
  /** People → Approvals tab (the page reads `?tab=`). */
  approvals: "/people?tab=approvals",
  messages: "/messages",
  /** The Messages page opens a request thread from `?thread=wo:<id>`. */
  requestThread: (id: number) => `/messages?thread=wo:${id}`,
  /** …and a direct office thread from `?thread=office:<user id>`. */
  officeThread: (userId: string) => `/messages?thread=${encodeURIComponent(officeKey(userId))}`,
  listings: "/listings",
  /** The Leases page resolves `?lease=` to the tenant record or the lease editor. */
  lease: (id: number) => `/leases?lease=${id}`,
  leases: "/leases",
  application: (id: number) => `/applications?app=${id}`,
  calendar: "/calendar",
  documents: "/documents",
} as const;

// ── Small wording helpers ──────────────────────────────────────────

/** "$10,575" — whole dollars without cents; cents only when there are some. */
export function money(amount: number): string {
  if (Number.isInteger(amount)) return formatMoney(amount);
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * What a completed request cost, for "Spend" and the activity feed: the price
 * the landlord is billed (`landlord_price`), not what the worker is paid.
 * The dashboard reports on the landlords' portfolio, so it shows their cost.
 */
export function requestCost(wo: Pick<WorkOrder, "landlord_price">): number | null {
  return wo.landlord_price;
}

/**
 * "#MR-001000". The database already numbers requests `MR-000000`
 * (`request_number`), so this only adds the "#"; a row without a number falls
 * back to its id rather than a made-up reference.
 */
export function requestRef(wo: Pick<WorkOrder, "id" | "request_number">): string {
  const number = wo.request_number?.trim();
  return `#${number || wo.id}`;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function fullName(first?: string | null, last?: string | null): string {
  return [first, last]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ");
}

/** Collapse whitespace and cap the length so free text stays one short line. */
function oneLine(text: string, max = 80): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

function joinParts(parts: (string | null | undefined | false)[], separator = " · "): string {
  return parts.filter((part): part is string => Boolean(part)).join(separator);
}

/** "Unit 1A" — unless the label already says "Unit". */
function unitWord(label: string): string {
  return /^unit\b/i.test(label.trim()) ? label.trim() : `Unit ${label.trim()}`;
}

/** Rounded share that only says 100 when it really is all of it. */
function percentOf(part: number, whole: number): number {
  if (whole <= 0) return 0;
  const raw = Math.round((part / whole) * 100);
  const capped = Math.max(0, Math.min(100, raw));
  return capped === 100 && part < whole ? 99 : capped;
}

/**
 * The date-only write path stores a visit as noon UTC (see lib/request-status).
 * Such a visit has a day but no real clock time.
 */
const NOON_UTC_DATE_SENTINEL = /^\d{4}-\d{2}-\d{2}T12:00:00(?:\.\d+)?(?:Z|[+]00:00)$/;

interface Moment {
  /** Local `YYYY-MM-DD`. */
  day: string;
  /** "9:15 am"; null when the value is a date without a time. */
  clock: string | null;
  ms: number;
}

function momentOf(iso: string | null | undefined, opts?: { dateOnlySentinel?: boolean }): Moment | null {
  if (!iso) return null;
  const dateOnly =
    /^\d{4}-\d{2}-\d{2}$/.test(iso) || (opts?.dateOnlySentinel && NOON_UTC_DATE_SENTINEL.test(iso));
  if (dateOnly) {
    const day = toCalendarDay(iso.slice(0, 10));
    return day ? { day, clock: null, ms: parseDay(day).getTime() } : null;
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return { day: toDay(date), clock: formatClock(date), ms: date.getTime() };
}

/** "Today, 16 Nov 2026" / "In 4 days, 20 Nov 2026" / "3 days ago, 13 Nov 2026" */
function relativeWithDate(day: string, today: string): string {
  return `${relativeDayLabel(day, today)}, ${formatDayNoWeekday(day)}`;
}

/** "Tomorrow, Tue 17 Nov 2026" */
function relativeWithWeekday(day: string, today: string): string {
  return `${relativeDayLabel(day, today)}, ${formatDayShort(day)}`;
}

/** "Today, 16 Nov 2026 · 9:15 am" / "Fri 13 Nov 2026 · 6:12 pm" */
function whenLabel(moment: Moment, today: string): string {
  const day = moment.day === today ? `Today, ${formatDayNoWeekday(moment.day)}` : formatDayShort(moment.day);
  return joinParts([day, moment.clock]);
}

function periodOf(day: string): string {
  return day.slice(0, 7);
}

/** "November 2026" for a `YYYY-MM` period. */
function periodLabel(period: string): string {
  const [year, month] = period.split("-").map(Number);
  return formatMonthYear(year, (month ?? 1) - 1);
}

function shiftPeriod(period: string, delta: number): string {
  const [year, month] = period.split("-").map(Number);
  const d = new Date(year, (month ?? 1) - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** The three rent periods the dashboard reads: last month, this month, next month. */
/** How far back closed requests still matter for recent activity and threads. */
export const CLOSED_REQUEST_LOOKBACK_DAYS = 90;

/**
 * The oldest completion time a closed request can have and still show on the
 * dashboard: the start of this year (spend "this year") or the activity
 * look-back, whichever is earlier. Returned as an ISO instant for the query.
 */
export function dashboardClosedSince(now: Date): string {
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const lookBack = new Date(now.getFullYear(), now.getMonth(), now.getDate() - CLOSED_REQUEST_LOOKBACK_DAYS);
  return (startOfYear < lookBack ? startOfYear : lookBack).toISOString();
}

export function dashboardChargePeriods(now: Date): string[] {
  const current = periodOf(toDay(now));
  return [shiftPeriod(current, -1), current, shiftPeriod(current, 1)];
}

// ── People: always "Name, role" ────────────────────────────────────

type RoleWord = "admin" | "landlord" | "tenant" | "team" | "vendor" | "applicant";

interface Person {
  name: string;
  role: RoleWord;
  /** A tenant's current unit label, when known. */
  unit?: string | null;
}

const ROLE_TITLE: Record<RoleWord, string> = {
  admin: "Admin",
  landlord: "Landlord",
  tenant: "Tenant",
  team: "Team",
  vendor: "Vendor",
  applicant: "Applicant",
};

/** How an unnamed actor is referred to at the start of a sentence. */
const ROLE_ANONYMOUS: Record<RoleWord, string> = {
  admin: "An admin",
  landlord: "A landlord",
  tenant: "A tenant",
  team: "A team member",
  vendor: "A vendor",
  applicant: "An applicant",
};

function roleWord(role: string | null | undefined): RoleWord | null {
  switch (role) {
    case "admin":
      return "admin";
    case "landlord":
      return "landlord";
    case "tenant":
      return "tenant";
    case "maintenance":
      return "team";
    default:
      return null;
  }
}

/** "Sam Fixit, team" */
function personRef(person: Person): string {
  return `${person.name}, ${person.role}`;
}

/** "Raj Patel · Tenant · 1B" */
function personHeading(person: Person): string {
  return joinParts([person.name, ROLE_TITLE[person.role], person.unit]);
}

/** Sentence subject: "Lee Wrench, team," or "A tenant"; null when nothing is known. */
function actorSubject(person: Person | null, role: RoleWord | null): string | null {
  if (person) return `${personRef(person)},`;
  return role ? ROLE_ANONYMOUS[role] : null;
}

interface Directory {
  tenant(id: number | null | undefined): Person | null;
  landlordOf(property: Property | null | undefined): Person | null;
  staff(id: number | null | undefined): Person | null;
  /** The person behind a portal account id (auth user id). */
  user(userId: string | null | undefined): Person | null;
  account(account: UserAccountRow): Person | null;
  /** Who is doing the work on a request: assigned team member, else its vendor. */
  assignee(wo: WorkOrder): Person | null;
}

function buildDirectory(sources: AdminDashboardSources): Directory {
  const tenants = new Map<number, Person>();
  const addTenant = (id: number | null | undefined, name: string, unit?: string | null) => {
    if (id == null || !name) return;
    tenants.set(id, { name, role: "tenant", unit: unit ?? null });
  };
  // Names carried by other records first; the tenant list, when it loaded, wins.
  for (const wo of sources.workOrders) {
    if (!tenants.has(wo.tenant_id ?? -1)) {
      addTenant(wo.tenant_id, fullName(wo.tenant_first_name, wo.tenant_last_name));
    }
  }
  for (const lease of sources.leases ?? []) {
    if (lease.status !== "active") continue;
    addTenant(
      lease.primary_tenant_id,
      fullName(lease.tenant_first_name, lease.tenant_last_name),
      lease.unit_name,
    );
  }
  for (const tenant of sources.tenants ?? []) {
    addTenant(tenant.id, fullName(tenant.first_name, tenant.last_name), tenant.active_unit_name);
  }

  const landlords = new Map<number, string>();
  for (const landlord of sources.landlords ?? []) {
    const name = fullName(landlord.first_name, landlord.last_name) || landlord.company_name?.trim() || "";
    if (name) landlords.set(landlord.id, name);
  }

  const staff = new Map<number, string>();
  for (const member of sources.staff ?? []) {
    const name = fullName(member.first_name, member.last_name);
    if (name) staff.set(member.id, name);
  }

  const accounts = new Map<string, UserAccountRow>();
  for (const account of sources.accounts ?? []) accounts.set(account.user_id, account);

  const viewer = sources.viewer ?? null;
  const viewerEmail = viewer?.email.trim().toLowerCase() || null;
  const viewerName = viewer ? viewer.displayName?.trim() || displayNameFromEmail(viewer.email) : null;

  const tenant = (id: number | null | undefined) => (id == null ? null : tenants.get(id) ?? null);
  const staffPerson = (id: number | null | undefined): Person | null => {
    const name = id == null ? undefined : staff.get(id);
    return name ? { name, role: "team" } : null;
  };

  const account = (row: UserAccountRow): Person | null => {
    const email = row.email?.trim() || null;
    const isViewer = Boolean(email && viewerEmail && email.toLowerCase() === viewerEmail);
    switch (row.role) {
      case "admin": {
        const name = (row.staff_id != null ? staff.get(row.staff_id) : undefined) ?? (isViewer ? viewerName : null) ?? email;
        return name ? { name, role: "admin" } : null;
      }
      case "maintenance": {
        const name = (row.staff_id != null ? staff.get(row.staff_id) : undefined) ?? email;
        return name ? { name, role: "team" } : null;
      }
      case "tenant":
        return tenant(row.tenant_id) ?? (email ? { name: email, role: "tenant" } : null);
      case "landlord": {
        const name = (row.landlord_id != null ? landlords.get(row.landlord_id) : undefined) ?? email;
        return name ? { name, role: "landlord" } : null;
      }
      default:
        // No role yet: someone who signed up and is waiting for the office.
        return email ? { name: email, role: "applicant" } : null;
    }
  };

  return {
    tenant,
    staff: staffPerson,
    account,
    landlordOf(property) {
      if (!property) return null;
      const name = landlords.get(property.landlord_id) ?? property.landlord_name?.trim();
      return name ? { name, role: "landlord" } : null;
    },
    user(userId) {
      const row = userId ? accounts.get(userId) : undefined;
      return row ? account(row) : null;
    },
    assignee(wo) {
      const member = staffPerson(wo.assigned_staff_id);
      if (member) return member;
      if (wo.assigned_staff_id == null && wo.vendor_name?.trim()) {
        return { name: wo.vendor_name.trim(), role: "vendor" };
      }
      return null;
    },
  };
}

// ── Shared context for one build ───────────────────────────────────

interface RentStats {
  period: string;
  chargeCount: number;
  expected: number;
  collected: number;
  outstanding: number;
  /** Tenants (or leases) with an unpaid balance past its due date. */
  lateCount: number;
  /** Days since the oldest unpaid due date. */
  maxDaysLate: number;
}

interface Ctx {
  sources: AdminDashboardSources;
  now: Date;
  today: string;
  period: string;
  people: Directory;
  propertyById: Map<number, Property>;
  unitById: Map<number, Unit>;
  open: WorkOrder[];
  /** null when rent charges did not load. */
  rent: RentStats | null;
  awaiting: PaymentAwaitingVerification[] | null;
  /** null when the marketing flags did not load. */
  marketedUnitIds: Set<number> | null;
  /** Vacant units with no lease on the way that are not on the website (or, when marketing is unknown, simply vacant). */
  vacantUnlisted: Unit[];
  /** Homes live on the website — the same rule as the Website listings page (null = flags unknown). */
  liveCount: number | null;
}

function isEmergency(wo: WorkOrder): boolean {
  return wo.priority === "urgent";
}

/**
 * Nobody is on it: no team member and no vendor.
 * TODO(data-gap): a request offered to the worker pool but not yet accepted
 * (`offered_at`) is not on the mapped WorkOrder, so it reads as unassigned.
 */
function isUnassigned(wo: WorkOrder): boolean {
  return wo.assigned_staff_id == null && wo.vendor_id == null;
}

/**
 * Waiting on the office: the Maintenance page's "Needs action" tab, and the
 * number on the Maintenance rail badge (see use-admin-nav-counts.ts).
 */
function needsOfficeAction(wo: WorkOrder): boolean {
  return staffQueueTab(wo.status, Boolean(wo.assigned_staff_id)) === "needs";
}

function placeOfUnit(ctx: Ctx, propertyId: number | null | undefined, unitName: string | null | undefined) {
  const property = propertyId != null ? ctx.propertyById.get(propertyId) : undefined;
  return { propertyName: property?.name ?? null, unitName: unitName?.trim() || null, property: property ?? null };
}

function requestPlace(ctx: Ctx, wo: WorkOrder) {
  const place = placeOfUnit(ctx, wo.property_id, wo.unit_name);
  return { ...place, propertyName: place.propertyName ?? wo.property_name ?? null };
}

/** "Maple Court · Unit 1A" */
function placeLine(propertyName: string | null, unitName: string | null): string {
  return joinParts([propertyName, unitName ? unitWord(unitName) : null]);
}

/** "Maple Court 1B" — the compact form used in context lines. */
function placeCompact(propertyName: string | null, unitName: string | null): string {
  return joinParts([propertyName, unitName], " ");
}

/** "Birch House Unit 1" */
function placeName(propertyName: string | null, unitName: string | null): string {
  return joinParts([propertyName, unitName ? unitWord(unitName) : null], " ");
}

function summariseRent(charges: RentCharge[], period: string, today: string): RentStats {
  const stats: RentStats = {
    period,
    chargeCount: 0,
    expected: 0,
    collected: 0,
    outstanding: 0,
    lateCount: 0,
    maxDaysLate: 0,
  };
  const late = new Set<string>();
  for (const charge of charges) {
    if (charge.period !== period) continue;
    stats.chargeCount += 1;
    const waived = charge.status === "waived";
    // A waived charge is no longer expected beyond what was already paid on it.
    stats.expected += waived ? charge.amount_paid : charge.amount;
    stats.collected += charge.amount_paid;
    const balance = waived || charge.status === "paid" ? 0 : Math.max(0, charge.amount - charge.amount_paid);
    stats.outstanding += balance;
    const dueDay = toCalendarDay(charge.due_date);
    if (balance > 0 && dueDay && dueDay < today) {
      late.add(charge.tenant_id != null ? `t${charge.tenant_id}` : `l${charge.lease_id}`);
      stats.maxDaysLate = Math.max(stats.maxDaysLate, dayDiff(dueDay, today));
    }
  }
  stats.lateCount = late.size;
  return stats;
}

/** "1 tenant 15 days late" / "3 tenants late"; null when nobody is late. */
function lateLabel(rent: RentStats): string | null {
  if (rent.lateCount === 0) return null;
  if (rent.lateCount === 1) return `1 tenant ${plural(rent.maxDaysLate, "day")} late`;
  return `${rent.lateCount} tenants late`;
}

function createCtx(sources: AdminDashboardSources, now: Date): Ctx {
  const today = toDay(now);
  const period = periodOf(today);
  const propertyById = new Map(sources.properties.map((p) => [p.id, p]));
  const unitById = new Map(sources.units.map((u) => [u.id, u]));
  const marketedUnitIds = sources.marketing
    ? new Set(sources.marketing.filter((m) => m.marketed).map((m) => m.unit_id))
    : null;

  const vacantUnlisted = vacantUnlistedUnits({
    units: sources.units,
    marketedUnitIds,
    leases: sources.leases,
    propertyById,
  });

  return {
    sources,
    now,
    today,
    period,
    people: buildDirectory(sources),
    propertyById,
    unitById,
    open: sources.workOrders.filter(isOpenRequest),
    rent: sources.charges ? summariseRent(sources.charges, period, today) : null,
    awaiting: sources.paymentsAwaitingVerification,
    marketedUnitIds,
    vacantUnlisted,
    liveCount: marketedUnitIds
      ? liveUnits({ units: sources.units, marketedUnitIds, propertyById }).length
      : null,
  };
}

// ── Requests: status is always followed by the next step ───────────

const PRIORITY_PREFIX: Partial<Record<WorkOrder["priority"], string>> = {
  urgent: "Emergency",
  high: "High priority",
};

/** The one thing that moves a request forward, in the imperative. */
function nextStepFor(wo: WorkOrder): string {
  if (isUnassigned(wo)) return "Assign a team member";
  switch (toRequestStatus(wo)) {
    case "On hold": {
      const reason = wo.hold_reason?.trim();
      return reason ? `Follow up: ${oneLine(reason, 60)}` : "Follow up";
    }
    case "In progress":
      return "Complete the work";
    case "Completed":
      return "Closed";
    default:
      return wo.scheduled_at ? "Attend scheduled visit" : "Schedule a visit";
  }
}

/** "In progress → Assign a team member" */
function statusThenNextStep(wo: WorkOrder): string {
  return `${toRequestStatus(wo)} → ${nextStepFor(wo)}`;
}

function priorityRank(wo: WorkOrder): number {
  if (wo.priority === "urgent") return 0;
  if (wo.priority === "high") return 1;
  return 2;
}

/** What a follow-up is about, for the calendar: the hold reason when there is one. */
function followUpTask(wo: WorkOrder): string {
  if (isUnassigned(wo)) return nextStepFor(wo);
  const reason = wo.status === "on_hold" ? wo.hold_reason?.trim() : "";
  return reason ? oneLine(reason, 60) : nextStepFor(wo);
}

function followUpDay(wo: WorkOrder): string | null {
  return toCalendarDay(wo.next_follow_up_date);
}

function tenantOrOffice(ctx: Ctx, wo: WorkOrder): string {
  const tenant = ctx.people.tenant(wo.tenant_id);
  if (tenant) return personRef({ name: tenant.name, role: "tenant" });
  // Only tenants and the office create requests, so no tenant means the office logged it.
  return wo.tenant_id == null ? "Office report" : "Tenant report";
}

// ── KPIs ───────────────────────────────────────────────────────────

const UNAVAILABLE = "—";

function pendingAccounts(ctx: Ctx): UserAccountRow[] | null {
  if (!ctx.sources.accounts) return null;
  return ctx.sources.accounts
    .filter((a) => a.account_status === "pending")
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

function accountName(ctx: Ctx, account: UserAccountRow): string {
  return ctx.people.account(account)?.name ?? "Someone";
}

function buildKpis(ctx: Ctx): KpiTile[] {
  const { sources, open, rent } = ctx;
  const emergencies = open.filter(isEmergency).length;
  const needsAction = open.filter(needsOfficeAction).length;

  const rentTile: KpiTile =
    rent == null
      ? { id: "rent-collected", label: "Rent collected", value: UNAVAILABLE, detail: "Rent isn’t available right now", href: ROUTES.rent }
      : rent.expected <= 0
        ? {
            id: "rent-collected",
            label: "Rent collected",
            value: UNAVAILABLE,
            detail: `No rent charged for ${monthName(ctx.now.getMonth())} yet`,
            href: ROUTES.rent,
          }
        : {
            id: "rent-collected",
            label: "Rent collected",
            value: `${percentOf(rent.collected, rent.expected)}%`,
            detail: `${money(rent.collected)} of ${money(rent.expected)}`,
            href: ROUTES.rent,
          };

  const totalUnits = sources.units.length;
  const occupied = sources.units.filter((u) => u.status === "occupied").length;

  const pending = pendingAccounts(ctx);
  const approvalsDetail =
    pending == null
      ? "Approvals aren’t available right now"
      : pending.length === 0
        ? "No one is waiting"
        : pending.length === 1
          ? accountName(ctx, pending[0])
          : `${pending.length} people waiting`;

  // Same count as the Messages page header and the Messages rail badge.
  const unread = sources.inbox ? countUnreadConversations(sources.inbox) : null;

  const live = ctx.liveCount;
  const notListed = ctx.vacantUnlisted.length;

  return [
    {
      id: "open-requests",
      label: "Open requests",
      value: String(open.length),
      detail: `${emergencies} emergency · ${needsAction} need action`,
      href: ROUTES.maintenance,
    },
    rentTile,
    {
      id: "occupancy",
      label: "Occupancy",
      value: totalUnits > 0 ? `${percentOf(occupied, totalUnits)}%` : UNAVAILABLE,
      detail: totalUnits > 0 ? `${occupied} of ${plural(totalUnits, "unit")} occupied` : "No units yet",
      href: ROUTES.properties,
    },
    {
      id: "approvals",
      label: "Approvals waiting",
      value: pending == null ? UNAVAILABLE : String(pending.length),
      detail: approvalsDetail,
      href: ROUTES.approvals,
    },
    {
      id: "unread-messages",
      label: "Unread messages",
      value: unread == null ? UNAVAILABLE : String(unread),
      detail: unread == null ? "Messages aren’t available right now" : "Across your portfolio",
      href: ROUTES.messages,
    },
    {
      id: "homes-live",
      label: "Homes live online",
      value: live == null ? UNAVAILABLE : String(live),
      // TODO(data-gap): the portal has no "draft listing" state — a unit is either
      // published (`currently_being_marketed`) or not — so drafts are not counted.
      detail:
        live == null
          ? "Listings aren’t available right now"
          : notListed > 0
            ? `${notListed} vacant not listed`
            : "No vacant homes unlisted",
      href: ROUTES.listings,
    },
  ];
}

// ── Needs your attention ───────────────────────────────────────────

/**
 * Ranking rule — lower tier first, then `order` ascending within the tier:
 *   1. Emergency requests nobody is assigned to (oldest first)
 *   2. Money: payments awaiting verification (oldest report first)
 *   3. Other unassigned requests (high priority first, then oldest)
 *   4. Accounts awaiting approval (oldest first)
 *   5. Leases ending within 60 days, or already past their end, with no renewal (soonest first)
 *   6. Vacant homes that are ready and not listed (property, then unit)
 *   7. Follow-ups overdue or due within 7 days (earliest date first)
 * Only things the office itself can resolve are listed.
 */
const TIER = {
  emergency: 1,
  money: 2,
  unassigned: 3,
  approval: 4,
  lease: 5,
  vacancy: 6,
  followUp: 7,
} as const;

interface RankedItem {
  tier: number;
  order: number;
  item: AttentionItem;
}

const METHOD_NAME: Record<string, string> = {
  zelle: "Zelle",
  ach: "ACH",
  card: "card",
  credit: "card",
  check: "check",
  cash: "cash",
};

function methodName(method: string): string {
  return METHOD_NAME[method.toLowerCase()] ?? "";
}

/** "$725 Zelle from Raj Patel" */
function paymentPhrase(ctx: Ctx, intent: PaymentAwaitingVerification): string {
  const tenant = ctx.people.tenant(intent.tenant_id) ?? chargeTenant(intent.charge);
  return joinParts(
    [joinParts([money(intent.amount), methodName(intent.method) || "payment"], " "), tenant ? `from ${tenant.name}` : null],
    " ",
  );
}

function chargeTenant(charge: RentCharge | null): Person | null {
  const name = charge ? fullName(charge.tenant_first_name, charge.tenant_last_name) : "";
  return name ? { name, role: "tenant", unit: charge?.unit_name ?? null } : null;
}

/** The lease on the same unit that takes over from `lease`, if one exists. */
function renewalOf(lease: Lease, leases: Lease[]): Lease | null {
  return (
    leases
      .filter(
        (other) =>
          other.id !== lease.id &&
          other.unit_id === lease.unit_id &&
          (other.status === "upcoming" || other.status === "active") &&
          other.start_date > lease.start_date,
      )
      .sort((a, b) => a.start_date.localeCompare(b.start_date))[0] ?? null
  );
}

const WANTS_TO_BE: Record<RoleWord, string | null> = {
  tenant: "Wants to be a tenant",
  landlord: "Wants to be a landlord",
  team: "Wants to join the team",
  admin: "Wants admin access",
  vendor: null,
  applicant: null,
};

function buildAttention(ctx: Ctx): AttentionModel {
  const { sources, today, people } = ctx;
  const ranked: RankedItem[] = [];
  const listedRequests = new Set<number>();

  // 1 + 3 — unassigned requests.
  for (const wo of ctx.open) {
    if (!isUnassigned(wo)) continue;
    listedRequests.add(wo.id);
    const created = momentOf(wo.created_at)?.ms ?? 0;
    const emergency = isEmergency(wo);
    ranked.push({
      tier: emergency ? TIER.emergency : TIER.unassigned,
      // Within "other unassigned": high priority ahead of normal, then oldest.
      order: emergency ? created : priorityRank(wo) * 1e15 + created,
      item: {
        id: `assign-${wo.id}`,
        icon: "wrench",
        title: `${emergency ? "Unassigned emergency" : "Unassigned request"}: ${wo.title}`,
        context: joinParts([statusThenNextStep(wo), requestRef(wo)]),
        href: ROUTES.request(wo.id),
        actionLabel: "Assign",
      },
    });
  }

  // 2 — money the office has to confirm.
  for (const intent of ctx.awaiting ?? []) {
    const charge = intent.charge;
    const dueDay = toCalendarDay(charge?.due_date);
    const lateness = !dueDay
      ? null
      : dueDay < today
        ? `${plural(dayDiff(dueDay, today), "day")} late`
        : `Due ${formatDayShort(dueDay)}`;
    ranked.push({
      tier: TIER.money,
      order: momentOf(intent.reported_at)?.ms ?? 0,
      item: {
        id: `verify-${intent.id}`,
        icon: "dollar",
        title: `Verify ${paymentPhrase(ctx, intent)}`,
        context: joinParts([
          "Tenant",
          placeCompact(charge?.property_name ?? null, charge?.unit_name ?? null),
          lateness,
        ]),
        href: ROUTES.rentVerify(intent.id),
        actionLabel: "Verify",
      },
    });
  }

  // 4 — accounts waiting for the office.
  for (const account of pendingAccounts(ctx) ?? []) {
    const created = momentOf(account.created_at);
    const role = roleWord(account.role);
    ranked.push({
      tier: TIER.approval,
      order: created?.ms ?? 0,
      item: {
        id: `approve-${account.user_id}`,
        icon: "user",
        title: `${accountName(ctx, account)} is waiting for approval`,
        context: joinParts([
          "Applicant",
          role ? WANTS_TO_BE[role] : null,
          // `null` = not confirmed; `undefined` = the column is not there yet.
          account.email_confirmed_at === null ? "Email not confirmed yet" : null,
          created ? relativeWithDate(created.day, today) : null,
        ]),
        href: ROUTES.approvals,
        actionLabel: "Review",
      },
    });
  }

  // 5 — leases running out with nothing lined up.
  const leases = sources.leases ?? [];
  for (const lease of leases) {
    if (lease.status !== "active") continue;
    const endDay = toCalendarDay(lease.end_date);
    if (!endDay) continue;
    const daysLeft = dayDiff(today, endDay);
    if (daysLeft > LEASE_ENDING_SOON_DAYS || renewalOf(lease, leases)) continue;
    const tenant = people.tenant(lease.primary_tenant_id);
    const ends =
      daysLeft > 1
        ? `Lease ends in ${daysLeft} days`
        : daysLeft === 1
          ? "Lease ends tomorrow"
          : daysLeft === 0
            ? "Lease ends today"
            : `Lease ended ${plural(-daysLeft, "day")} ago`;
    ranked.push({
      tier: TIER.lease,
      order: daysLeft,
      item: {
        id: `lease-${lease.id}`,
        icon: "calendar",
        title: joinParts([ends, lease.unit_name ? unitWord(lease.unit_name) : null]),
        context: joinParts([
          tenant ? personRef({ name: tenant.name, role: "tenant" }) : null,
          lease.property_name,
          formatDayShort(endDay),
        ]),
        href: ROUTES.lease(lease.id),
        actionLabel: "Start renewal",
        actionHref: ROUTES.leases,
      },
    });
  }

  // 6 — homes that could be earning rent.
  ctx.vacantUnlisted
    .filter((unit) => unit.readiness_status === "ready")
    .forEach((unit, index) => {
      const property = ctx.propertyById.get(unit.property_id) ?? null;
      const landlord = people.landlordOf(property);
      const name = placeName(property?.name ?? unit.property_name ?? null, unit.name);
      const marketingKnown = ctx.marketedUnitIds != null;
      ranked.push({
        tier: TIER.vacancy,
        order: index,
        item: {
          id: `vacant-${unit.id}`,
          icon: "building",
          // Without the marketing flags we only know the home is vacant.
          title: marketingKnown ? `${name} is vacant and not listed` : `${name} is vacant`,
          context: joinParts([landlord ? personRef(landlord) : null, "Ready for move-in"]),
          // Listings can't be published from the portal yet, so the action
          // opens the property, where the unit and its lease are managed.
          href: ROUTES.property(unit.property_id),
          actionLabel: "Open property",
        },
      });
    });

  // 7 — follow-ups that are due.
  for (const wo of ctx.open) {
    if (listedRequests.has(wo.id)) continue;
    const day = followUpDay(wo);
    if (!day) continue;
    const diff = dayDiff(today, day);
    if (diff > FOLLOW_UP_SOON_DAYS) continue;
    ranked.push({
      tier: TIER.followUp,
      order: diff,
      item: {
        id: `follow-up-${wo.id}`,
        icon: "calendar",
        title:
          diff < 0
            ? `${wo.title} · follow-up overdue since ${formatWeekdayDayMonth(day)}`
            : `${wo.title} · follow-up due ${formatWeekdayDayMonth(day)}`,
        context: joinParts([statusThenNextStep(wo), relativeWithDate(day, today)]),
        href: ROUTES.request(wo.id),
        actionLabel: "Open",
      },
    });
  }

  ranked.sort((a, b) => a.tier - b.tier || a.order - b.order || a.item.id.localeCompare(b.item.id));
  const total = ranked.length;
  const items = ranked.slice(0, ATTENTION_LIMIT).map((r) => r.item);

  return {
    summaryLine:
      total === 0
        ? // The all-clear card shows its own notice and no summary line.
          ""
        : total > items.length
          ? `${total} items · Showing the ${items.length} most urgent. Only your office can resolve these.`
          : `${plural(total, "item")} · Ranked by urgency. Only your office can resolve these.`,
    items,
    clearedLine: total === 0 ? clearedLine(ctx) : undefined,
    // The design's all-clear footer reads "Resolved today"; the portal cannot
    // know what was resolved today, so it only says when this was checked.
    resolvedLine: `Checked today · ${formatDayShort(today)}`,
  };
}

/** "a, b and c" */
function listWords(words: string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/**
 * All clear: what was actually checked. A source that did not load is named
 * as not checked instead of being counted as clear.
 */
function clearedLine(ctx: Ctx): string {
  const { sources } = ctx;
  const clear: string[] = [];
  const unchecked: string[] = [];
  if (ctx.awaiting) clear.push("no payments to verify");
  else unchecked.push("payments");
  if (sources.accounts) clear.push("no one waiting for approval");
  else unchecked.push("approvals");
  if (sources.leases) clear.push("no lease ending without a renewal");
  else unchecked.push("leases");
  clear.push(ctx.marketedUnitIds ? "no ready home left unlisted" : "no ready home standing vacant");

  const first = listWords(clear);
  return joinParts(
    [
      `${first.charAt(0).toUpperCase()}${first.slice(1)}.`,
      ctx.open.length === 0
        ? "No requests are open."
        : "Every open request has someone assigned and no follow-up is due this week.",
      unchecked.length > 0 ? `Couldn’t check ${listWords(unchecked)} right now.` : null,
    ],
    " ",
  );
}

// ── Calendar ───────────────────────────────────────────────────────

const KIND_ORDER: Record<DashboardEventKind, number> = {
  rent_due: 0,
  visit: 1,
  follow_up: 2,
  lease_start: 3,
  move_in: 4,
  lease_end: 5,
};

/** "12 months" from a lease's first and last day. */
function leaseTerm(startDay: string, endDay: string): string {
  const days = dayDiff(startDay, endDay) + 1;
  const months = Math.round(days / 30.4375);
  return months >= 1 ? plural(months, "month") : plural(Math.max(days, 0), "day");
}

const APPLICATION_STATUS_LABEL: Record<string, string> = {
  new: "New application",
  screening: "Application in screening",
  approved: "Application approved",
};

function buildCalendar(ctx: Ctx): DashboardCalendarModel {
  const { sources, today, people } = ctx;
  // The card can step one month either way, so the model covers three months.
  const first = toDay(new Date(ctx.now.getFullYear(), ctx.now.getMonth() - 1, 1));
  const last = toDay(new Date(ctx.now.getFullYear(), ctx.now.getMonth() + 2, 0));
  const inWindow = (day: string | null): day is string => day != null && day >= first && day <= last;
  const events: DashboardCalendarEvent[] = [];

  for (const wo of ctx.open) {
    const place = requestPlace(ctx, wo);
    const assignee = people.assignee(wo);
    const record = joinParts([wo.title, requestRef(wo)]);
    const placeDetail = placeLine(place.propertyName, place.unitName);
    const href = ROUTES.request(wo.id);

    const visit = momentOf(wo.scheduled_at, { dateOnlySentinel: true });
    if (visit && inWindow(visit.day)) {
      const tenant = people.tenant(wo.tenant_id);
      events.push({
        id: `visit-${wo.id}`,
        kind: "visit",
        day: visit.day,
        // TODO(data-gap): a visit has a start time only (`scheduled_for`), no end
        // time or duration, so the design's "10:00–11:00 am" range cannot be shown.
        title: joinParts(["Scheduled visit", visit.clock]),
        record,
        details: [
          joinParts([
            assignee ? personRef(assignee) : isUnassigned(wo) ? "Unassigned" : null,
            tenant ? personRef({ name: tenant.name, role: "tenant" }) : null,
          ]),
          placeDetail,
        ].filter(Boolean),
        actionLabel: "Open request",
        href,
      });
    }

    const followUp = followUpDay(wo);
    const who = joinParts([
      assignee ? personRef(assignee) : isUnassigned(wo) ? "Unassigned" : null,
      tenantOrOffice(ctx, wo),
    ]);
    if (inWindow(followUp)) {
      events.push({
        id: `follow-up-${wo.id}`,
        kind: "follow_up",
        day: followUp,
        title: `Follow-up due · ${followUpTask(wo)}`,
        record,
        details: [who, placeDetail].filter(Boolean),
        actionLabel: "Open request",
        href,
      });
    } else if (isUnassigned(wo) && !followUp) {
      // A request nobody is assigned to has no date of its own; the assignment
      // is due now, so it sits on today (the design does the same).
      events.push({
        id: `assign-${wo.id}`,
        kind: "follow_up",
        day: today,
        title: "Follow-up due · Assign a team member",
        record,
        details: [who, placeDetail].filter(Boolean),
        actionLabel: "Open request",
        href,
      });
    }
  }

  for (const intent of ctx.awaiting ?? []) {
    const reported = momentOf(intent.reported_at);
    if (!reported || !inWindow(reported.day)) continue;
    const tenant = people.tenant(intent.tenant_id) ?? chargeTenant(intent.charge);
    events.push({
      id: `verify-${intent.id}`,
      kind: "follow_up",
      day: reported.day,
      title: "Follow-up due · Verify payment",
      record: paymentPhrase(ctx, intent),
      details: [
        tenant ? personRef({ name: tenant.name, role: "tenant" }) : "",
        placeLine(intent.charge?.property_name ?? null, intent.charge?.unit_name ?? null),
      ].filter(Boolean),
      actionLabel: "Open rent",
      href: ROUTES.rentVerify(intent.id),
    });
  }

  // Rent due: one event per due date, not one per tenant.
  // TODO(data-gap): rent due comes from generated charges only, so a month whose
  // charges have not been generated yet (usually next month) shows no rent due.
  const rentGroups = new Map<string, { period: string; day: string; count: number; expected: number; properties: Set<number> }>();
  for (const charge of sources.charges ?? []) {
    const day = toCalendarDay(charge.due_date);
    if (!inWindow(day) || charge.status === "waived") continue;
    const key = `${charge.period}|${day}`;
    const group = rentGroups.get(key) ?? { period: charge.period, day, count: 0, expected: 0, properties: new Set<number>() };
    group.count += 1;
    group.expected += charge.amount;
    if (charge.property_id != null) group.properties.add(charge.property_id);
    rentGroups.set(key, group);
  }
  const propertyCount = sources.properties.length;
  for (const group of rentGroups.values()) {
    const [, month] = group.period.split("-").map(Number);
    const onlyProperty = group.properties.size === 1 ? ctx.propertyById.get([...group.properties][0]) : undefined;
    const scope =
      group.properties.size === 0
        ? ""
        : onlyProperty
          ? onlyProperty.name
          : group.properties.size === propertyCount
            ? `All ${propertyCount} properties`
            : `${group.properties.size} of ${plural(propertyCount, "property", "properties")}`;
    events.push({
      id: `rent-${group.period}-${group.day}`,
      kind: "rent_due",
      day: group.day,
      title: `Rent due · ${plural(group.count, "unit")}`,
      record: `${monthName((month ?? 1) - 1)} rent · ${money(group.expected)} expected`,
      details: [scope].filter(Boolean),
      actionLabel: "Open rent",
      href: ROUTES.rentPeriod(group.period),
    });
  }

  const leases = sources.leases ?? [];
  for (const lease of leases) {
    if (lease.status === "cancelled") continue;
    const property = lease.property_id != null ? ctx.propertyById.get(lease.property_id) : undefined;
    const propertyName = property?.name ?? lease.property_name ?? null;
    const unitName = lease.unit_name?.trim() || null;
    const tenant = people.tenant(lease.primary_tenant_id);
    const landlord = people.landlordOf(property);
    const details = [
      joinParts([tenant ? personRef({ name: tenant.name, role: "tenant" }) : null, landlord ? personRef(landlord) : null]),
      placeLine(propertyName, unitName),
    ].filter(Boolean);
    const where = placeName(propertyName, unitName);
    const startDay = toCalendarDay(lease.start_date);
    const endDay = toCalendarDay(lease.end_date);

    if (inWindow(startDay) && lease.status !== "ended") {
      events.push({
        id: `lease-start-${lease.id}`,
        kind: "lease_start",
        day: startDay,
        title: joinParts(["Lease starts", where]),
        record: joinParts([endDay ? leaseTerm(startDay, endDay) : null, `${money(lease.monthly_rent)} a month`]),
        details,
        actionLabel: "Open lease",
        href: ROUTES.lease(lease.id),
      });
    }
    if (inWindow(endDay) && lease.status === "active") {
      const renewal = renewalOf(lease, leases);
      const renewalStart = toCalendarDay(renewal?.start_date);
      events.push({
        id: `lease-end-${lease.id}`,
        kind: "lease_end",
        day: endDay,
        title: joinParts(["Lease ends", where]),
        record: renewalStart ? `Renewal starts ${formatDayShort(renewalStart)}` : "Renewal not started",
        details,
        actionLabel: "Open lease",
        href: ROUTES.lease(lease.id),
      });
    }
  }

  // TODO(data-gap): leases carry no move-in date and there is no walk-through
  // record, so "move-in" is the desired move-in date on a live rental application.
  for (const application of sources.applications ?? []) {
    const status = APPLICATION_STATUS_LABEL[application.status];
    const day = toCalendarDay(application.desired_move_in);
    if (!status || !inWindow(day)) continue;
    const name = fullName(application.first_name, application.last_name);
    events.push({
      id: `move-in-${application.id}`,
      kind: "move_in",
      day,
      title: joinParts(["Desired move-in", placeName(application.property_name ?? null, application.unit_name ?? null)]),
      record: joinParts([name ? personRef({ name, role: "applicant" }) : null, status]),
      details: [placeLine(application.property_name ?? null, application.unit_name ?? null)].filter(Boolean),
      actionLabel: "Open application",
      href: ROUTES.application(application.id),
    });
  }

  events.sort(
    (a, b) =>
      a.day.localeCompare(b.day) ||
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      a.title.localeCompare(b.title) ||
      a.id.localeCompare(b.id),
  );
  return { today, events, href: ROUTES.calendar };
}

// ── Recent activity ────────────────────────────────────────────────

interface ActivityEntry extends ActivityItem {
  moment: Moment;
}

const MOVED_TO: Record<WorkOrderStatus, string> = {
  open: "reopened",
  scheduled: "scheduled",
  in_progress: "started work on",
  on_hold: "put on hold",
  closed: "completed",
};

const PAID_BY: Record<string, string> = {
  cash: "in cash",
  check: "by check",
  ach: "by ACH",
  credit: "by card",
  card: "by card",
  zelle: "by Zelle",
};

/**
 * There is no activity-feed table. The feed is assembled from records that
 * carry their own timestamp and author: request status history, request
 * comments, recorded payments, Zelle payments reported by tenants, document
 * uploads and new sign-ups.
 * TODO(data-gap): edits that leave no history row (rent changes, lease edits,
 * unit updates, approvals) do not appear here.
 */
function buildActivity(ctx: Ctx): ActivityModel {
  const { sources, today, people } = ctx;
  const feeds = [sources.statusEvents, sources.comments, sources.payments, sources.documents];
  if (feeds.every((feed) => feed == null) && ctx.awaiting == null && sources.accounts == null) {
    return { summaryLine: "Recent activity isn’t available right now.", groups: [] };
  }

  const entries: ActivityEntry[] = [];
  const requests = new Map(sources.workOrders.map((wo) => [wo.id, wo]));
  const requestPlaceCompact = (wo: WorkOrder) => {
    const place = requestPlace(ctx, wo);
    return placeCompact(place.propertyName, place.unitName);
  };

  for (const event of sources.statusEvents ?? []) {
    const wo = requests.get(event.maintenance_request_id);
    const moment = momentOf(event.created_at);
    if (!wo || !moment) continue;
    const actor = people.user(event.changed_by_user_id);
    const subject = actorSubject(actor, roleWord(event.changed_by_role));
    const place = requestPlaceCompact(wo);
    const href = ROUTES.request(wo.id);

    if (event.to_status === "closed") {
      // "Bathroom fan completed · $180 · Harbor Electric, vendor"
      const worker = people.assignee(wo);
      entries.push({
        id: `status-${event.id}`,
        icon: "check",
        title: joinParts([
          `${wo.title} completed`,
          requestCost(wo) != null ? money(requestCost(wo)!) : null,
          worker ? personRef(worker) : null,
        ]),
        context: joinParts([place, requestRef(wo), whenLabel(moment, today)]),
        href,
        moment,
      });
      continue;
    }

    const verb = event.from_status == null ? "reported" : MOVED_TO[event.to_status];
    const passive: Record<string, string> = {
      reported: "was reported",
      reopened: "was reopened",
      scheduled: "was scheduled",
      "started work on": "is now in progress",
      "put on hold": "was put on hold",
    };
    entries.push({
      id: `status-${event.id}`,
      icon: "wrench",
      title: subject ? `${subject} ${verb} ${wo.title}` : `${wo.title} ${passive[verb] ?? "was updated"}`,
      context: joinParts([place, requestRef(wo), whenLabel(moment, today)]),
      href,
      moment,
    });
  }

  for (const comment of sources.comments ?? []) {
    const wo = requests.get(comment.maintenance_request_id);
    const moment = momentOf(comment.created_at);
    if (!wo || !moment) continue;
    const subject = actorSubject(commentAuthor(ctx, comment), roleWord(comment.author_role));
    entries.push({
      id: `comment-${comment.id}`,
      icon: "message",
      title: subject ? `${subject} commented on ${wo.title}` : `New comment on ${wo.title}`,
      context: joinParts([requestPlaceCompact(wo), requestRef(wo), whenLabel(moment, today)]),
      href: ROUTES.request(wo.id),
      moment,
    });
  }

  for (const payment of sources.payments ?? []) {
    const moment = momentOf(payment.paid_at);
    if (!moment) continue;
    const charge = payment.charge;
    const tenant = people.tenant(charge?.tenant_id) ?? chargeTenant(charge);
    const how = PAID_BY[payment.method] ?? "";
    entries.push({
      id: `payment-${payment.id}`,
      icon: "dollar",
      title: tenant
        ? joinParts([`${personRef({ name: tenant.name, role: "tenant" })}, paid ${money(payment.amount)}`, how], " ")
        : joinParts([`${money(payment.amount)} payment recorded`, how], " "),
      context: joinParts([
        placeCompact(charge?.property_name ?? null, charge?.unit_name ?? null),
        charge?.period ? `Rent for ${periodLabel(charge.period)}` : null,
        whenLabel(moment, today),
      ]),
      href: charge?.period ? ROUTES.rentPeriod(charge.period) : ROUTES.rent,
      moment,
    });
  }

  for (const intent of ctx.awaiting ?? []) {
    const moment = momentOf(intent.reported_at);
    if (!moment) continue;
    const tenant = people.tenant(intent.tenant_id) ?? chargeTenant(intent.charge);
    const how = PAID_BY[intent.method] ?? "";
    entries.push({
      id: `reported-${intent.id}`,
      icon: "dollar",
      title: tenant
        ? joinParts([`${personRef({ name: tenant.name, role: "tenant" })}, sent ${money(intent.amount)}`, how], " ")
        : joinParts([`A tenant sent ${money(intent.amount)}`, how], " "),
      context: joinParts([
        placeCompact(intent.charge?.property_name ?? null, intent.charge?.unit_name ?? null),
        "Awaiting verification",
        whenLabel(moment, today),
      ]),
      href: ROUTES.rentVerify(intent.id),
      moment,
    });
  }

  for (const doc of sources.documents ?? []) {
    const moment = momentOf(doc.created_at);
    if (!moment) continue;
    const property = ctx.propertyById.get(doc.property_id);
    const unit = doc.unit_id != null ? ctx.unitById.get(doc.unit_id) : undefined;
    const tenant = people.tenant(doc.uploaded_by_tenant_id);
    const actor = tenant ? { name: tenant.name, role: "tenant" as const } : people.user(doc.uploaded_by_user_id);
    const subject = actorSubject(actor, roleWord(doc.uploaded_by_role));
    const name = doc.title.trim() || doc.file_name;
    const verb = (actor?.role ?? roleWord(doc.uploaded_by_role)) === "tenant" ? "uploaded" : "shared";
    entries.push({
      id: `document-${doc.id}`,
      icon: "file",
      title: subject ? `${subject} ${verb} ${name}` : `${name} was added to documents`,
      context: joinParts([placeCompact(property?.name ?? null, unit?.name ?? null), whenLabel(moment, today)]),
      href: ROUTES.documents,
      moment,
    });
  }

  for (const account of pendingAccounts(ctx) ?? []) {
    const moment = momentOf(account.created_at);
    if (!moment) continue;
    const role = roleWord(account.role);
    entries.push({
      id: `signup-${account.user_id}`,
      icon: "user",
      title: `${accountName(ctx, account)}, applicant, asked for portal access`,
      context: joinParts([role ? WANTS_TO_BE[role] : null, whenLabel(moment, today)]),
      href: ROUTES.approvals,
      moment,
    });
  }

  const oldest = addDays(today, -ACTIVITY_WINDOW_DAYS);
  const recent = entries
    .filter((entry) => entry.moment.day >= oldest && entry.moment.ms <= ctx.now.getTime())
    .sort((a, b) => b.moment.ms - a.moment.ms || a.id.localeCompare(b.id))
    .slice(0, ACTIVITY_LIMIT);

  const groups: ActivityGroup[] = [];
  for (const { moment, ...item } of recent) {
    let group = groups[groups.length - 1];
    if (!group || group.id !== moment.day) {
      group = { id: moment.day, label: activityDayLabel(moment.day, today), items: [] };
      groups.push(group);
    }
    group.items.push(item);
  }

  return { summaryLine: "Across all properties · People shown by name and role", groups };
}

/** "Today · Mon 16 Nov 2026" / "Friday · 13 Nov 2026 · 3 days ago" */
function activityDayLabel(day: string, today: string): string {
  const diff = dayDiff(day, today);
  if (diff === 0) return `Today · ${formatDayShort(day)}`;
  if (diff === 1) return `Yesterday · ${formatDayShort(day)}`;
  return `${weekdayLong(day)} · ${formatDayNoWeekday(day)} · ${diff} days ago`;
}

function commentAuthor(
  ctx: Ctx,
  comment: Pick<RecentMaintenanceComment, "author_tenant_id" | "author_user_id" | "author_staff_id">,
): Person | null {
  const tenant = ctx.people.tenant(comment.author_tenant_id);
  if (tenant) return tenant;
  // An account knows whether a staff-linked author is an admin or a team member.
  return ctx.people.user(comment.author_user_id) ?? ctx.people.staff(comment.author_staff_id);
}

// ── Rent this month ────────────────────────────────────────────────

function buildRent(ctx: Ctx): RentModel {
  const { rent, sources } = ctx;
  const month = periodLabel(ctx.period);
  const propertyCount = sources.properties.length;
  const scope = propertyCount === 1 ? sources.properties[0].name : `All ${propertyCount} properties`;
  const scopeLine = joinParts([month, scope]);

  if (!rent) {
    return { scopeLine, headline: "Rent isn’t available right now.", progress: null, lines: [], href: ROUTES.rent };
  }
  if (rent.expected <= 0) {
    return {
      scopeLine,
      headline: `No rent charged for ${month} yet`,
      progress: null,
      lines: rent.chargeCount === 0 ? ["Generate this month’s charges from the rent ledger."] : [],
      href: ROUTES.rent,
    };
  }

  // Only this month's charges, so "awaiting verification" adds up with the rest.
  const reported = ctx.awaiting?.filter((intent) => intent.charge?.period === ctx.period) ?? null;
  const awaitingTotal = reported?.reduce((sum, intent) => sum + intent.amount, 0) ?? null;
  const headline = `${money(rent.collected)} of ${money(rent.expected)} collected`;

  if (rent.outstanding <= 0) {
    // Figma "All clear": no scope line and no progress bar, two summary lines
    // and the latest rent event underneath.
    return {
      scopeLine: "",
      headline,
      progress: null,
      lines: [
        "100% collected · $0 outstanding",
        joinParts([awaitingTotal != null ? `${money(awaitingTotal)} awaiting verification` : null, "No late tenants"]),
      ],
      noteLines: latestRentEvent(ctx),
      href: ROUTES.rent,
    };
  }

  const percent = percentOf(rent.collected, rent.expected);
  const outstanding = joinParts([`${money(rent.outstanding)} outstanding`, lateLabel(rent)]);
  const lines = [`Collected ${money(rent.collected)}`, joinParts([`Outstanding ${money(rent.outstanding)}`, lateLabel(rent)])];

  if (reported && awaitingTotal != null) {
    const methods = [...new Set(reported.map((intent) => methodName(intent.method)).filter(Boolean))];
    lines.push(joinParts([`Awaiting verification ${money(awaitingTotal)}`, methods.join(", ")]));
  }

  return {
    scopeLine,
    headline,
    progress: { percent, label: `${percent}% collected`, caption: outstanding },
    lines,
    href: ROUTES.rent,
  };
}

/** ["Raj Patel, tenant · $725 Zelle verified", "Today, Mon 16 Nov 2026"] — this month's newest payment. */
function latestRentEvent(ctx: Ctx): string[] | undefined {
  const latest = (ctx.sources.payments ?? [])
    .filter((payment) => payment.charge?.period === ctx.period)
    .map((payment) => ({ payment, moment: momentOf(payment.paid_at) }))
    .filter((row): row is { payment: RecentPayment; moment: Moment } => row.moment != null && row.moment.day <= ctx.today)
    .sort((a, b) => b.moment.ms - a.moment.ms || b.payment.id - a.payment.id)[0];
  if (!latest) return undefined;
  const { payment, moment } = latest;
  const tenant = ctx.people.tenant(payment.charge?.tenant_id) ?? chargeTenant(payment.charge);
  // The database also stores "zelle" (a tenant's Zelle payment the office confirmed).
  const how =
    String(payment.method) === "zelle" ? "Zelle verified" : joinParts(["paid", PAID_BY[payment.method]], " ");
  return [
    joinParts([tenant ? personRef({ name: tenant.name, role: "tenant" }) : null, `${money(payment.amount)} ${how}`]),
    relativeWithWeekday(moment.day, ctx.today),
  ];
}

// ── Maintenance snapshot ───────────────────────────────────────────

function buildMaintenance(ctx: Ctx): MaintenanceSnapshotModel {
  const { sources, today, open, people } = ctx;
  const counts = { New: 0, Assigned: 0, "In progress": 0, "On hold": 0 };
  for (const wo of open) {
    const status = toRequestStatus(wo);
    if (status !== "Completed") counts[status] += 1;
  }

  const year = today.slice(0, 4);
  let completedThisMonth = 0;
  let spendMonth = 0;
  let spendYear = 0;
  let pricedThisYear = 0;
  for (const wo of sources.workOrders) {
    if (wo.status !== "closed") continue;
    const day = momentOf(wo.completed_at)?.day;
    if (!day || day > today) continue;
    if (periodOf(day) === ctx.period) completedThisMonth += 1;
    const cost = requestCost(wo);
    if (day.slice(0, 4) !== year || cost == null) continue;
    pricedThisYear += 1;
    spendYear += cost;
    if (periodOf(day) === ctx.period) spendMonth += cost;
  }

  const requests: RequestSummary[] = open
    .slice()
    // Most important first: emergency, then high priority; then unassigned;
    // then whichever has the nearest visit or follow-up; then oldest.
    .sort((a, b) => {
      const priority = priorityRank(a) - priorityRank(b);
      if (priority !== 0) return priority;
      const unassigned = Number(isUnassigned(b)) - Number(isUnassigned(a));
      if (unassigned !== 0) return unassigned;
      const next = (nextDate(a) ?? "9999").localeCompare(nextDate(b) ?? "9999");
      if (next !== 0) return next;
      return a.created_at.localeCompare(b.created_at) || a.id - b.id;
    })
    .slice(0, SNAPSHOT_REQUESTS)
    .map((wo) => {
      const place = requestPlace(ctx, wo);
      const prefix = PRIORITY_PREFIX[wo.priority];
      return {
        id: String(wo.id),
        heading: joinParts([requestRef(wo), wo.title]),
        context: joinParts([place.propertyName, place.unitName, tenantOrOffice(ctx, wo)]),
        statusLine: joinParts([prefix, statusThenNextStep(wo)]),
        meta: requestMeta(ctx, wo, people.assignee(wo)),
        href: ROUTES.request(wo.id),
      };
    });

  return {
    summaryLine: `${open.length} open · ${open.filter(isEmergency).length} emergency · ${open.filter(needsOfficeAction).length} need action`,
    countLines: [
      `New ${counts.New} · Assigned ${counts.Assigned} · In progress ${counts["In progress"]}`,
      // "Completed" is this month's, so the number stays meaningful as history grows.
      `On hold ${counts["On hold"]} · Completed ${completedThisMonth} this month`,
    ],
    // Spend is what landlords were billed (see `requestCost`) on requests
    // completed in the period. TODO(data-gap): a request completed without a
    // recorded landlord price
    // adds nothing, so with no priced request this year the line is left out
    // rather than shown as $0.
    spendLine: pricedThisYear > 0 ? `Spend · ${money(spendMonth)} this month · ${money(spendYear)} this year` : null,
    requests,
    href: ROUTES.maintenance,
  };
}

function nextDate(wo: WorkOrder): string | null {
  const days = [momentOf(wo.scheduled_at, { dateOnlySentinel: true })?.day, followUpDay(wo)].filter(
    (day): day is string => Boolean(day),
  );
  return days.sort()[0] ?? null;
}

/** "Sam Fixit, team · Tomorrow, Tue 17 Nov 2026" */
function requestMeta(ctx: Ctx, wo: WorkOrder, assignee: Person | null): string {
  const { today } = ctx;
  if (isUnassigned(wo)) {
    const reported = momentOf(wo.created_at);
    // TODO(data-gap): requests have no "last updated" time, so this is when it was reported.
    return joinParts([
      "Unassigned",
      reported ? `Reported ${relativeWithWeekday(reported.day, today).replace(/^[A-Z]/, (c) => c.toLowerCase())}` : null,
    ]);
  }
  const followUp = followUpDay(wo);
  if (wo.status === "on_hold" && followUp) {
    const diff = dayDiff(today, followUp);
    const lead =
      diff < 0 ? "Follow-up overdue" : diff === 0 ? "Follow-up today" : diff === 1 ? "Follow-up tomorrow" : `Follow-up in ${diff} days`;
    return joinParts([lead, formatDayShort(followUp)]);
  }
  const who = assignee ? personRef(assignee) : "Team member assigned";
  const visit = momentOf(wo.scheduled_at, { dateOnlySentinel: true });
  return joinParts([who, visit ? relativeWithWeekday(visit.day, today) : "Not scheduled yet"]);
}

// ── Messages ───────────────────────────────────────────────────────

/** "Today · 16 Nov" / "Fri · 13 Nov" */
function threadTime(moment: Moment, today: string): string {
  const diff = dayDiff(moment.day, today);
  const lead = diff === 0 ? "Today" : diff === 1 ? "Yesterday" : weekdayShort(moment.day);
  const sameYear = moment.day.slice(0, 4) === today.slice(0, 4);
  return joinParts([lead, sameYear ? formatDayMonth(moment.day) : formatDayNoWeekday(moment.day)]);
}

function threadIcon(person: Person | null, role: RoleWord | null): AdminIconName {
  return (person?.role ?? role) === "team" ? "wrench" : "user";
}

/** Who the office talks to on a request: its tenant (at the request's unit), else the team member on it. */
function requestCounterpartPerson(ctx: Ctx, wo: WorkOrder): Person | null {
  const tenant = ctx.people.tenant(wo.tenant_id);
  if (tenant) return { ...tenant, unit: wo.unit_name?.trim() || tenant.unit };
  return ctx.people.staff(wo.assigned_staff_id);
}

function buildMessages(ctx: Ctx): MessagesModel {
  const { sources, today, people } = ctx;
  if (!sources.inbox) {
    return { summaryLine: "Messages aren’t available right now.", threads: [], href: ROUTES.messages };
  }

  const rows: (ThreadSummary & { ms: number })[] = [];
  const requests = new Map(sources.workOrders.map((wo) => [wo.id, wo]));

  for (const conversation of sources.inbox) {
    const moment = momentOf(conversation.last.at);
    if (!moment) continue;
    if (conversation.kind === "office") {
      // Direct thread between one person and the office.
      const person = people.user(conversation.threadUserId);
      rows.push({
        id: `office-${conversation.threadUserId}`,
        icon: threadIcon(person, null),
        name: person ? personHeading(person) : "Portal user",
        preview: oneLine(conversation.last.body, 140),
        time: threadTime(moment, today),
        unread: conversation.unread,
        href: ROUTES.officeThread(conversation.threadUserId),
        ms: moment.ms,
      });
      continue;
    }
    // Request conversation, headed by who it is with — the same person the
    // Messages page names (lib/messages.ts requestCounterpart): the tenant who
    // reported it, else the team member on it, else the place.
    const wo = requests.get(conversation.requestId);
    if (!wo) continue;
    const counterpart = requestCounterpartPerson(ctx, wo);
    rows.push({
      id: `wo-${wo.id}`,
      icon: threadIcon(counterpart, null),
      name: counterpart
        ? personHeading(counterpart)
        : joinParts(["Office request", wo.property_name, wo.unit_name?.trim() || null]),
      preview: oneLine(`${wo.title} — ${conversation.last.body}`, 140),
      time: threadTime(moment, today),
      unread: conversation.unread,
      href: ROUTES.requestThread(wo.id),
      ms: moment.ms,
    });
  }

  rows.sort((a, b) => Number(b.unread) - Number(a.unread) || b.ms - a.ms || a.id.localeCompare(b.id));
  const unread = countUnreadConversations(sources.inbox);

  return {
    summaryLine: `${unread} unread · Latest conversations`,
    threads: rows.slice(0, MESSAGE_THREADS).map(({ ms: _ms, ...thread }) => thread),
    href: ROUTES.messages,
  };
}

// ── Website listings ───────────────────────────────────────────────

function buildListings(ctx: Ctx): ListingsModel {
  const summaryLine = "Homes on your public marketing site";
  // TODO(data-gap): website inquiries live in the `inquiries` table, which only
  // the marketing site's server key can read — the portal cannot count them.
  const inquiryLine = "Website inquiries aren’t connected to the portal yet.";

  if (!ctx.marketedUnitIds) {
    return {
      summaryLine,
      headline: "Website listings aren’t available right now.",
      inquiryLine: null,
      noteLines: [],
      href: ROUTES.listings,
    };
  }

  const live = ctx.liveCount ?? 0;
  const unlisted = ctx.vacantUnlisted;
  const firstUnlisted = unlisted[0];
  const noteLines: string[] = [];
  if (firstUnlisted) {
    const property = ctx.propertyById.get(firstUnlisted.property_id);
    const more = unlisted.length - 1;
    noteLines.push(
      joinParts([placeLine(property?.name ?? firstUnlisted.property_name ?? null, firstUnlisted.name), more > 0 ? `and ${more} more` : null], " "),
      firstUnlisted.readiness_status === "ready"
        ? "Vacant, ready and not marketed"
        : `Vacant, ${UNIT_READINESS_LABELS[firstUnlisted.readiness_status].toLowerCase()}, not marketed`,
    );
  }

  return {
    // Figma "All clear" drops the summary line once nothing is left to list.
    summaryLine: unlisted.length > 0 ? summaryLine : "",
    // TODO(data-gap): there is no "draft" listing state in the portal (a unit is
    // published or it is not), so the design's "1 draft" has no counterpart.
    headline: unlisted.length > 0 ? `${live} live · ${unlisted.length} vacant not listed` : `${live} live · 0 not listed`,
    inquiryLine,
    noteLines,
    href: ROUTES.listings,
  };
}

// ── Your portfolio ─────────────────────────────────────────────────

function buildPortfolio(ctx: Ctx): PortfolioModel {
  const { sources, people } = ctx;
  const unitsByProperty = new Map<number, Unit[]>();
  for (const unit of sources.units) {
    const list = unitsByProperty.get(unit.property_id) ?? [];
    list.push(unit);
    unitsByProperty.set(unit.property_id, list);
  }

  const byLandlord = new Map<number, Property[]>();
  for (const property of sources.properties) {
    const list = byLandlord.get(property.landlord_id) ?? [];
    list.push(property);
    byLandlord.set(property.landlord_id, list);
  }

  const groups: PortfolioGroup[] = [...byLandlord.entries()]
    .map(([landlordId, properties]) => {
      const landlord = people.landlordOf(properties[0]);
      const sorted = properties.slice().sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
      const lines = sorted.slice(0, PORTFOLIO_LINES).map((property) => {
        const units = unitsByProperty.get(property.id) ?? [];
        const vacant = units.filter((u) => u.status === "vacant").length;
        const detail =
          units.length === 0
            ? "No units yet"
            : vacant === units.length
              ? plural(vacant, "vacant unit")
              : vacant > 0
                ? `${plural(units.length, "unit")} · ${vacant} vacant`
                : plural(units.length, "unit");
        return joinParts([property.name, detail]);
      });
      const more = sorted.length - PORTFOLIO_LINES;
      if (more > 0) lines.push(`and ${plural(more, "more property", "more properties")}`);
      return {
        id: String(landlordId),
        owner: landlord ? joinParts([landlord.name, "Landlord"]) : "Landlord not set",
        lines,
      };
    })
    .sort((a, b) => a.owner.localeCompare(b.owner) || a.id.localeCompare(b.id));

  return {
    groups: groups.slice(0, PORTFOLIO_GROUPS),
    totalsLine: joinParts([
      plural(byLandlord.size, "landlord"),
      plural(sources.properties.length, "property", "properties"),
      plural(sources.units.length, "unit"),
    ]),
  };
}

// ── Public builders ────────────────────────────────────────────────

/** The whole dashboard for `now`. Pure: same sources and `now`, same model. */
export function buildAdminDashboardModel(sources: AdminDashboardSources, now: Date): AdminDashboardModel {
  const ctx = createCtx(sources, now);
  return {
    kpis: buildKpis(ctx),
    attention: buildAttention(ctx),
    calendar: buildCalendar(ctx),
    activity: buildActivity(ctx),
    rent: buildRent(ctx),
    maintenance: buildMaintenance(ctx),
    messages: buildMessages(ctx),
    listings: buildListings(ctx),
    portfolio: buildPortfolio(ctx),
  };
}

function viewerName(viewer: Pick<AdminDashboardViewer, "displayName" | "email">): string {
  return viewer.displayName?.trim() || (viewer.email ? displayNameFromEmail(viewer.email) : "");
}

/** Greeting and date line; shown in every state, including loading and error. */
export function buildDashboardIntro(
  viewer: Pick<AdminDashboardViewer, "displayName" | "email">,
  now: Date,
): DashboardIntroModel {
  const firstName = viewerName(viewer).split(/\s+/)[0] ?? "";
  const greeting = greetingForHour(now.getHours());
  return {
    eyebrow: "Your portfolio, at a glance",
    greeting: firstName ? `${greeting}, ${firstName}.` : `${greeting}.`,
    dateLine: `Your office command center · ${formatDayLong(toDay(now))}`,
  };
}

/** What the empty state can still say truthfully when there are no properties. */
export interface EmptyStateFacts {
  units?: number;
  requests?: number;
  /** Rent expected this month; null/undefined when rent did not load. */
  expectedRent?: number | null;
  /** Units published on the website; null/undefined when the flags did not load. */
  liveHomes?: number | null;
}

/** The `empty` state: no properties yet. */
export function buildEmptyState(
  viewer: AdminDashboardViewer,
  facts: EmptyStateFacts = {},
): Extract<AdminDashboardState, { status: "empty" }> {
  const units = facts.units ?? 0;
  const requests = facts.requests ?? 0;
  const role = roleWord(viewer.role);
  const name = viewerName(viewer);
  return {
    status: "empty",
    statsLines: [
      joinParts([
        "No properties",
        units > 0 ? plural(units, "unit") : "No units",
        requests > 0 ? plural(requests, "request") : "No requests",
      ]),
      joinParts([
        facts.expectedRent != null ? `${money(facts.expectedRent)} expected` : null,
        facts.liveHomes != null ? plural(facts.liveHomes, "live home") : null,
      ]),
    ].filter(Boolean),
    // TODO(data-gap): the portal has no support contact on record (the design
    // shows a help address), so this names the signed-in account instead.
    contactLines: [joinParts([name, role ? ROLE_TITLE[role] : null, "Landlord Gopher"]), viewer.email].filter(Boolean),
  };
}

/** Empty-state facts read from whatever did load. */
export function emptyFactsFromSources(sources: AdminDashboardSources, now: Date): EmptyStateFacts {
  const today = toDay(now);
  return {
    units: sources.units.length,
    requests: sources.workOrders.length,
    expectedRent: sources.charges ? summariseRent(sources.charges, periodOf(today), today).expected : null,
    liveHomes: sources.marketing ? sources.marketing.filter((m) => m.marketed).length : null,
  };
}

/**
 * Loaded sources → what the page shows: `empty` while there are no properties,
 * otherwise `ready` with the full model.
 */
export function buildDashboardState(
  sources: AdminDashboardSources,
  viewer: AdminDashboardViewer,
  now: Date,
): Extract<AdminDashboardState, { status: "empty" | "ready" }> {
  if (sources.properties.length === 0) {
    return buildEmptyState(viewer, emptyFactsFromSources(sources, now));
  }
  return { status: "ready", model: buildAdminDashboardModel({ ...sources, viewer: sources.viewer ?? viewer }, now) };
}

/** The `error` state: the core reads failed at `attemptedAt`. */
export function buildErrorState(
  attemptedAt: Date,
  now: Date = attemptedAt,
): Extract<AdminDashboardState, { status: "error" }> {
  const minutes = Math.floor((now.getTime() - attemptedAt.getTime()) / 60_000);
  const sameDay = toDay(attemptedAt) === toDay(now);
  const when = minutes < 1 ? "Just now" : sameDay && minutes < 60 ? `${plural(minutes, "minute")} ago` : formatClock(attemptedAt);
  return {
    status: "error",
    message:
      "I couldn’t retrieve your portfolio. Your saved records have not changed. Try again to get the latest data.",
    lastAttemptLine: `Last attempt · ${when}, ${formatDayShort(toDay(attemptedAt))}`,
  };
}
