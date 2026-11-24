import type { StaffMember } from "@/lib/data";
import { dayDiff, formatDayShort, toDay } from "@/lib/admin-dates";
import type { WorkOrder, WorkOrderPriority } from "@/types";

/**
 * Pure helpers for the admin Maintenance list rows: how old a request is, who
 * is on it, and the order of the "Needs action" queue.
 */

/** Requests still being worked at least this old read as "stuck" (the age turns amber). */
export const STALE_AFTER_DAYS = 7;

/** Local calendar day of an ISO timestamp or `YYYY-MM-DD`; null when unparseable. */
function localDayOf(iso: string | null | undefined): string | null {
  if (!iso) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : toDay(d);
}

/**
 * Whole calendar days from `iso` to `now` (0 = today). A date in the future
 * (clock skew) counts as today. Null when the date is missing or unparseable.
 */
export function daysSince(iso: string | null | undefined, now: Date = new Date()): number | null {
  const day = localDayOf(iso);
  if (!day) return null;
  return Math.max(0, dayDiff(day, toDay(now)));
}

/** "today" · "yesterday" · "3 days ago" · "2 weeks ago" · "3 months ago" · "2 years ago" */
export function relativeAge(days: number): string {
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 365) return `${Math.min(11, Math.floor(days / 30))} months ago`;
  const years = Math.floor(days / 365);
  return years === 1 ? "1 year ago" : `${years} years ago`;
}

export interface RequestAge {
  /** "Opened 3 days ago" / "Completed yesterday". Empty when there is no date. */
  label: string;
  /** Absolute date for a tooltip: "Opened Tue 17 Nov 2026". */
  title: string;
  /** A request still being worked (not completed, not on hold) that has waited STALE_AFTER_DAYS or more. */
  stale: boolean;
}

/**
 * Age of a request for its list row. Completed requests say when they were
 * completed (when known); everything else says when it was opened.
 */
export function requestAge(
  order: Pick<WorkOrder, "status" | "created_at" | "completed_at">,
  now: Date = new Date(),
): RequestAge {
  const completed = order.status === "closed" && order.completed_at ? order.completed_at : null;
  const verb = completed ? "Completed" : "Opened";
  const iso = completed ?? order.created_at;
  const days = daysSince(iso, now);
  const day = localDayOf(iso);
  if (days == null || !day) return { label: "", title: "", stale: false };
  return {
    label: `${verb} ${relativeAge(days)}`,
    title: `${verb} ${formatDayShort(day)}`,
    // On hold is waiting on purpose (it has its own follow-up date), so it never reads as stuck.
    stale: order.status !== "closed" && order.status !== "on_hold" && days >= STALE_AFTER_DAYS,
  };
}

const PRIORITY_RANK: Record<WorkOrderPriority, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};

function priorityRank(priority: WorkOrderPriority | string): number {
  return PRIORITY_RANK[priority as WorkOrderPriority] ?? PRIORITY_RANK.normal;
}

/** Chip shown beside a request title: every priority except normal gets one. */
export type RequestPriorityChip = "Emergency" | "High" | "Low";

/**
 * Which priority chip a row shows. Normal is the default and shows nothing;
 * low is shown (quietly) so a low request sitting at the bottom of the Needs
 * action queue explains itself.
 */
export function priorityChipLevel(priority: WorkOrderPriority | string): RequestPriorityChip | null {
  switch (priority) {
    case "urgent":
      return "Emergency";
    case "high":
      return "High";
    case "low":
      return "Low";
    default:
      return null;
  }
}

/**
 * "Needs action" order: emergency first, then high, normal, low; within a
 * priority the request that has waited longest comes first.
 */
export function compareNeedsAction(
  a: Pick<WorkOrder, "id" | "priority" | "created_at">,
  b: Pick<WorkOrder, "id" | "priority" | "created_at">,
): number {
  const priority = priorityRank(a.priority) - priorityRank(b.priority);
  if (priority !== 0) return priority;
  const at = Date.parse(a.created_at);
  const bt = Date.parse(b.created_at);
  if (!Number.isNaN(at) && !Number.isNaN(bt) && at !== bt) return at - bt;
  return a.id - b.id;
}

/** Sorted copy for the Needs action tab; other tabs keep the loaded order. */
export function sortForQueueTab<T extends Pick<WorkOrder, "id" | "priority" | "created_at">>(
  list: readonly T[],
  tab: "needs" | "active" | "completed" | "all",
): T[] {
  return tab === "needs" ? [...list].sort(compareNeedsAction) : [...list];
}

/** "Sam Fixit" — how a team member reads in a row or the Assign menu. */
export function staffDisplayName(s: Pick<StaffMember, "first_name" | "last_name">): string {
  return [s.first_name, s.last_name].filter(Boolean).join(" ").trim() || "Team member";
}

export interface RequestAssignee {
  /** Who is on it, or "Unassigned". */
  label: string;
  unassigned: boolean;
}

/**
 * Who is on a request: the assigned team member, else the vendor, else
 * "Unassigned". A team member the staff list has not loaded reads as
 * "Team member".
 */
export function requestAssignee(
  order: Pick<WorkOrder, "assigned_staff_id" | "vendor_name">,
  staffById: ReadonlyMap<number, Pick<StaffMember, "first_name" | "last_name">>,
): RequestAssignee {
  if (order.assigned_staff_id != null) {
    const s = staffById.get(order.assigned_staff_id);
    return { label: s ? staffDisplayName(s) : "Team member", unassigned: false };
  }
  const vendor = order.vendor_name?.trim();
  if (vendor) return { label: vendor, unassigned: false };
  return { label: "Unassigned", unassigned: true };
}

/** "Maple Court · Unit 2B · Tom Lodger" */
export function requestPlaceLine(
  order: Pick<WorkOrder, "property_name" | "unit_name" | "tenant_first_name" | "tenant_last_name">,
): string {
  const tenant = [order.tenant_first_name, order.tenant_last_name].filter(Boolean).join(" ");
  return (
    [order.property_name, order.unit_name ? `Unit ${order.unit_name}` : null, tenant]
      .filter(Boolean)
      .join(" · ") || "—"
  );
}
