import { formatDocumentDate } from "@/lib/landlord-documents";
import { formatMoney } from "@/lib/utils";
import type { WorkOrder, WorkOrderPriority } from "@/types";
import type { RequestStatus } from "@/components/patterns/status-chip";
import { formatVisit, hasScheduledVisit, parseWhenDate, toRequestStatus } from "@/lib/request-status";

/**
 * Landlord maintenance queue (Figma "001 - Landlord Pages", LM frames
 * `2045:918` desktop, `2046:858` tablet, `2046:939` phone, plus loading,
 * empty, filtered-empty, error, and the completed tab).
 *
 * Read-only. Reporting a new issue is a different flow and is not modeled
 * here. Dates go through `formatDocumentDate`. A visit or follow-up in the
 * next six days asks that helper for the weekday form ("Tue 17 Nov"); the
 * helper itself only adds a weekday for the past week.
 *
 * TODO(data-gap): list rows have `assigned_staff_id` but no staff name, so
 * the status line cannot say "Sam Fixit". There is no common-area flag;
 * "Common area" is used only when the unit is named that. Spend is the sum
 * of `landlord_price` on completed requests (null counts as nothing billed).
 */

export type LandlordQueueTab = "open" | "on_hold" | "completed" | "all";

export type LandlordQueueProperty = {
  id: number;
  name: string;
  address?: string | null;
  city?: string | null;
};

export type LandlordQueueCounts = {
  open: number;
  onHold: number;
  completed: number;
  all: number;
  emergency: number;
};

export type LandlordQueuePriority = "High priority" | "Emergency";

export type LandlordQueueRow = {
  id: number;
  title: string;
  priority: LandlordQueuePriority | null;
  context: string;
  status: RequestStatus;
  statusDetail: string;
};

export type LandlordQueueGroup = {
  propertyId: number | null;
  name: string;
  /** "12 Maple St, Baltimore · 2 open". Empty when both parts are missing. */
  subtitle: string;
  rows: LandlordQueueRow[];
};

export type LandlordQueueFooter = {
  desktop: string;
  phone: string;
};

export type LandlordQueueEmpty = {
  kind: "none" | "filtered";
  title: string;
  body: string;
};

export type LandlordQueueModel = {
  counts: LandlordQueueCounts;
  openDetail: string;
  onHoldDetail: string;
  onHoldDetailCompact: string;
  /** "$180 this month" */
  spendMonthLabel: string;
  /** "$180" */
  spendMonthAmount: string;
  /** "$1,240 this year" */
  spendYearLabel: string;
  /** "this month · $1,240 this year" */
  spendCompactDetail: string;
  /** "3 open · 0 emergency · 1 on hold" */
  phoneHeadline: string;
  /** "Spend: $180 this month · $1,240 this year" */
  phoneSpend: string;
  completedSpendLine: string;
  groups: LandlordQueueGroup[];
  openFooter: LandlordQueueFooter | null;
  completedNotes: string[];
  empty: LandlordQueueEmpty | null;
};

const EMPTY_BODY =
  "When you or your tenants report an issue, it shows up here with its status and next step.";

export function buildLandlordQueue(input: {
  orders: readonly WorkOrder[];
  properties: readonly LandlordQueueProperty[];
  tab: LandlordQueueTab;
  propertyId: number | "all";
  now?: Date;
}): LandlordQueueModel {
  const now = input.now ?? new Date();
  const scoped = input.orders.filter((order) => inProperty(order, input.propertyId));
  const counts = countOrders(scoped);
  const spend = spendTotals(scoped, now);
  const spendMonthAmount = formatMoney(spend.month);
  const spendYearAmount = formatMoney(spend.year);
  const spendMonthLabel = `${spendMonthAmount} this month`;
  const spendYearLabel = `${spendYearAmount} this year`;
  const onHold = onHoldSummary(scoped, now);
  const groups = groupRows(scoped.filter((order) => inTab(order, input.tab)), input.properties, input.tab, now);
  const completedThisMonth = scoped.filter(
    (order) => order.status === "closed" && inMonth(order.completed_at ?? order.created_at, now),
  ).length;

  return {
    counts,
    openDetail: `${emergencyPhrase(counts.emergency)} · ${counts.onHold} on hold`,
    onHoldDetail: onHold.full,
    onHoldDetailCompact: onHold.compact,
    spendMonthLabel,
    spendMonthAmount,
    spendYearLabel,
    spendCompactDetail: `this month · ${spendYearLabel}`,
    phoneHeadline: `${counts.open} open · ${emergencyPhrase(counts.emergency)} · ${counts.onHold} on hold`,
    phoneSpend: `Spend: ${spendMonthLabel} · ${spendYearLabel}`,
    completedSpendLine: `Spend: ${spendMonthLabel} · ${spendYearLabel}`,
    groups,
    openFooter: input.tab === "open" ? openFooter(completedThisMonth) : null,
    completedNotes: input.tab === "completed" ? completedNotes(scoped, input.properties, input.propertyId, now) : [],
    empty: emptyState(input.orders.length, groups.length, input.tab, input.propertyId, input.properties),
  };
}

function inProperty(order: WorkOrder, propertyId: number | "all"): boolean {
  if (propertyId === "all") return true;
  return order.property_id === propertyId;
}

function inTab(order: WorkOrder, tab: LandlordQueueTab): boolean {
  if (tab === "all") return true;
  if (tab === "completed") return order.status === "closed";
  if (tab === "on_hold") return order.status === "on_hold";
  return order.status !== "closed";
}

function countOrders(orders: readonly WorkOrder[]): LandlordQueueCounts {
  let onHold = 0;
  let completed = 0;
  let emergency = 0;
  for (const order of orders) {
    if (order.status === "closed") completed += 1;
    else if (order.priority === "urgent") emergency += 1;
    if (order.status === "on_hold") onHold += 1;
  }
  return {
    open: orders.length - completed,
    onHold,
    completed,
    all: orders.length,
    emergency,
  };
}

function emergencyPhrase(n: number): string {
  return n > 1 ? `${n} emergencies` : `${n} emergency`;
}

function spendTotals(orders: readonly WorkOrder[], now: Date): { month: number; year: number } {
  let month = 0;
  let year = 0;
  for (const order of orders) {
    if (order.status !== "closed") continue;
    const when = order.completed_at ?? order.created_at;
    const price = order.landlord_price ?? 0;
    if (inYear(when, now)) year += price;
    if (inMonth(when, now)) month += price;
  }
  return { month, year };
}

function onHoldSummary(orders: readonly WorkOrder[], now: Date): { full: string; compact: string } {
  const held = orders.filter((order) => order.status === "on_hold");
  if (held.length === 0) return { full: "Nothing waiting", compact: "Nothing waiting" };
  const picked = [...held].sort((a, b) => followUpRank(a, now) - followUpRank(b, now))[0];
  const follow = queueDate(picked.next_follow_up_date, now);
  const title = firstWord(picked.title);
  if (follow && title) return { full: `${title} · follow-up ${follow}`, compact: `Follow-up ${follow}` };
  if (follow) return { full: `Follow-up ${follow}`, compact: `Follow-up ${follow}` };
  const reason = picked.hold_reason?.trim() || title || "Waiting";
  return { full: reason, compact: reason };
}

function followUpRank(order: WorkOrder, now: Date): number {
  const when = order.next_follow_up_date ? parseWhenDate(order.next_follow_up_date) : null;
  if (!when) return Number.POSITIVE_INFINITY;
  return when.getTime() - now.getTime();
}

function groupRows(
  orders: readonly WorkOrder[],
  properties: readonly LandlordQueueProperty[],
  tab: LandlordQueueTab,
  now: Date,
): LandlordQueueGroup[] {
  const groups = new Map<string, { propertyId: number | null; name: string; place: string; rows: LandlordQueueRow[] }>();
  for (const order of orders) {
    const meta = propertyMeta(order, properties);
    const key = order.property_id == null ? "none" : String(order.property_id);
    let group = groups.get(key);
    if (!group) {
      group = { propertyId: order.property_id, name: meta.name, place: meta.place, rows: [] };
      groups.set(key, group);
    }
    group.rows.push(rowModel(order, meta.name, now));
  }
  return [...groups.values()]
    .map((group) => ({
      propertyId: group.propertyId,
      name: group.name,
      subtitle: [group.place, groupCount(group.rows, tab)].filter(Boolean).join(" · "),
      rows: group.rows,
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || (a.propertyId ?? 0) - (b.propertyId ?? 0));
}

function propertyMeta(
  order: WorkOrder,
  properties: readonly LandlordQueueProperty[],
): { name: string; place: string } {
  const found = order.property_id == null ? undefined : properties.find((property) => property.id === order.property_id);
  if (found) {
    return {
      name: found.name.trim() || `Property #${found.id}`,
      place: [found.address?.trim(), found.city?.trim()].filter(Boolean).join(", "),
    };
  }
  const name = order.property_name?.trim() || (order.property_id == null ? "Property" : `Property #${order.property_id}`);
  return { name, place: "" };
}

function groupCount(rows: readonly LandlordQueueRow[], tab: LandlordQueueTab): string {
  const onHold = rows.filter((row) => row.status === "On hold").length;
  const completed = rows.filter((row) => row.status === "Completed").length;
  const open = rows.length - onHold - completed;
  if (tab === "completed") return `${completed} completed`;
  if (tab === "on_hold") return `${onHold} on hold`;
  const bits: string[] = [];
  if (open > 0) bits.push(`${open} open`);
  if (onHold > 0) bits.push(`${onHold} on hold`);
  if (tab === "all" && completed > 0) bits.push(`${completed} completed`);
  return bits.join(" · ");
}

function rowModel(order: WorkOrder, propertyName: string, now: Date): LandlordQueueRow {
  return {
    id: order.id,
    title: order.title.trim() || "Request",
    priority: priorityLabel(order.priority),
    context: contextLine(order, propertyName, now),
    status: toRequestStatus(order),
    statusDetail: statusDetail(order, now),
  };
}

function priorityLabel(priority: WorkOrderPriority): LandlordQueuePriority | null {
  if (priority === "urgent") return "Emergency";
  if (priority === "high") return "High priority";
  return null;
}

function contextLine(order: WorkOrder, propertyName: string, now: Date): string {
  const location = locationLabel(order);
  const parts = [requestRef(order), location];
  if (location !== "Unit" && !location.startsWith("Unit ")) parts.push(propertyName);
  const reporter = [order.tenant_first_name, order.tenant_last_name].filter(Boolean).join(" ").trim();
  if (reporter) parts.push(`Reported by ${reporter}`);
  const reported = queueDate(order.created_at, now);
  if (reported) parts.push(reported);
  return parts.filter(Boolean).join(" · ");
}

function requestRef(order: Pick<WorkOrder, "id" | "request_number">): string {
  const number = order.request_number?.trim();
  return `#${number || order.id}`;
}

function locationLabel(order: WorkOrder): string {
  const unit = order.unit_name?.trim();
  if (!unit) return "Whole property";
  if (/^common(\s+area)?$/i.test(unit)) return "Common area";
  return `Unit ${unit}`;
}

function statusDetail(order: WorkOrder, now: Date): string {
  if (order.status === "closed") {
    const when = queueDate(order.completed_at ?? order.created_at, now);
    const bits = [when ? `Completed ${when}` : "Completed"];
    if (order.landlord_price != null) bits.push(formatMoney(order.landlord_price));
    const vendor = order.vendor_name?.trim();
    if (vendor) bits.push(vendor);
    return bits.join(" · ");
  }
  if (order.status === "on_hold") {
    const bits: string[] = [];
    const reason = order.hold_reason?.trim();
    if (reason) bits.push(reason);
    const follow = queueDate(order.next_follow_up_date, now);
    if (follow) bits.push(`follow-up ${follow}`);
    return bits.join(" · ");
  }
  if (order.status === "in_progress") {
    if (isToday(order.scheduled_at, now) || (!order.scheduled_at && isToday(order.created_at, now))) {
      return "Started today";
    }
    const visit = formatVisit(order, { now });
    return visit ? `Visit ${visit}` : "";
  }
  // A New request has no visit yet, whatever scheduled_at holds (pool offers).
  const visit = hasScheduledVisit(order) ? formatVisit(order, { now }) : "";
  return visit ? `Visit ${visit}` : "";
}

function openFooter(completedThisMonth: number): LandlordQueueFooter | null {
  if (completedThisMonth <= 0) return null;
  const noun = completedThisMonth === 1 ? "request" : "requests";
  return {
    desktop: `${completedThisMonth} ${noun} completed this month. See the Completed tab for cost and vendor.`,
    phone: `${completedThisMonth} completed this month · see Completed tab`,
  };
}

function completedNotes(
  scoped: readonly WorkOrder[],
  properties: readonly LandlordQueueProperty[],
  propertyId: number | "all",
  now: Date,
): string[] {
  const withCompletedThisMonth = new Set(
    scoped
      .filter((order) => order.status === "closed" && inMonth(order.completed_at ?? order.created_at, now))
      .map((order) => order.property_id),
  );
  return properties
    .filter((property) => propertyId === "all" || property.id === propertyId)
    .filter((property) => !withCompletedThisMonth.has(property.id))
    .map((property) => `${property.name} has no completed requests this month.`)
    .sort((a, b) => a.localeCompare(b));
}

function emptyState(
  totalOrders: number,
  visible: number,
  tab: LandlordQueueTab,
  propertyId: number | "all",
  properties: readonly LandlordQueueProperty[],
): LandlordQueueEmpty | null {
  if (visible > 0) return null;
  if (totalOrders === 0) {
    return { kind: "none", title: "No maintenance requests yet.", body: EMPTY_BODY };
  }
  const property = propertyId === "all" ? undefined : properties.find((item) => item.id === propertyId);
  const noun = tabNoun(tab);
  const title = property ? `No ${noun} for ${property.name}.` : `No ${noun}.`;
  const body =
    tab === "all"
      ? "Try another property."
      : property
        ? "Try another property, or look in the All tab."
        : "Look in the All tab.";
  return { kind: "filtered", title, body };
}

function tabNoun(tab: LandlordQueueTab): string {
  if (tab === "completed") return "completed requests";
  if (tab === "on_hold") return "on hold requests";
  if (tab === "open") return "open requests";
  return "requests";
}

function firstWord(title: string): string {
  return title.trim().split(/\s+/)[0] ?? "";
}

/**
 * Display date for a queue line. Near-future dates reuse `formatDocumentDate`
 * with that date as "today" so the weekday is included ("Tue 17 Nov").
 */
export function queueDate(iso: string | null | undefined, now: Date): string {
  if (!iso) return "";
  const parsed = parseWhenDate(iso);
  if (!parsed) return formatDocumentDate(iso, now);
  const ahead = calendarDaysAfter(parsed, now);
  if (ahead > 0 && ahead <= 6) return formatDocumentDate(iso, parsed);
  return formatDocumentDate(iso, now);
}

function calendarDaysAfter(then: Date, now: Date): number {
  const startNow = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startThen = new Date(then.getFullYear(), then.getMonth(), then.getDate());
  return Math.round((startThen.getTime() - startNow.getTime()) / 86_400_000);
}

function isToday(iso: string | null | undefined, now: Date): boolean {
  if (!iso) return false;
  const parsed = parseWhenDate(iso);
  if (!parsed) return false;
  return calendarDaysAfter(parsed, now) === 0;
}

function inMonth(iso: string | null | undefined, now: Date): boolean {
  const parsed = iso ? parseWhenDate(iso) : null;
  if (!parsed) return false;
  return parsed.getFullYear() === now.getFullYear() && parsed.getMonth() === now.getMonth();
}

function inYear(iso: string | null | undefined, now: Date): boolean {
  const parsed = iso ? parseWhenDate(iso) : null;
  if (!parsed) return false;
  return parsed.getFullYear() === now.getFullYear();
}
