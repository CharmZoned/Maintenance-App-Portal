import type { WorkOrder, WorkOrderStatus } from "@/types";
import type { RequestStatus } from "@/components/patterns/status-chip";
import { priorityLabel, statusLabel } from "@/lib/request-status";

/** Map DB work-order status → Figma Q2 StatusChip labels (via lib/request-status). */
export function toRequestStatus(order: WorkOrder): RequestStatus {
  return statusLabel(order, "staff");
}

export function staffQueueTab(status: WorkOrderStatus, assigned: boolean): "needs" | "active" | "completed" {
  if (status === "closed") return "completed";
  if (status === "open" && !assigned) return "needs";
  return "active";
}

/** Parse ISO / date-only the same way for bucketing and relative labels. */
export function parseWhenDate(iso: string): Date | null {
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export type JobSection = "Today" | "Upcoming" | "On hold" | "Recently completed";

/**
 * My jobs bucketing (Figma Worker / U7).
 * Past-day and unscheduled open work stay under Today; future calendar days → Upcoming.
 * `in_progress` stays under Today even when scheduled later.
 */
export function jobSectionFor(order: Pick<WorkOrder, "status" | "scheduled_at">, now: Date): JobSection {
  if (order.status === "closed") return "Recently completed";
  if (order.status === "on_hold") return "On hold";
  if (order.status === "in_progress") return "Today";
  if (order.scheduled_at) {
    const d = parseWhenDate(order.scheduled_at);
    if (d && !isSameLocalDay(d, now) && d > now) {
      return "Upcoming";
    }
  }
  return "Today";
}

export function formatRelativeWhen(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "";
  const d = parseWhenDate(iso);
  if (!d) return iso;
  if (isSameLocalDay(d, now)) {
    return `Today ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameLocalDay(d, yesterday)) {
    return "Yesterday";
  }
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

/**
 * Schedule subtitle for queue/My jobs rows.
 * Past calendar days under Today would otherwise say "Yesterday" — use Overdue instead.
 */
export function formatScheduleWhen(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "";
  const d = parseWhenDate(iso);
  if (!d) return iso;
  if (isSameLocalDay(d, now)) {
    return `Today ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
  }
  if (d < now) return "Overdue";
  return formatRelativeWhen(iso, now);
}

export function workOrderContextLine(
  w: WorkOrder,
  opts?: { isTenant?: boolean; assigneeLabel?: string | null },
): string {
  const parts: string[] = [];
  if (w.property_name) parts.push(w.property_name);
  if (w.unit_name) parts.push(`Unit ${w.unit_name}`);
  if (!opts?.isTenant) {
    const tenant = [w.tenant_first_name, w.tenant_last_name].filter(Boolean).join(" ");
    if (tenant) parts.push(tenant);
  }
  if (priorityLabel(w.priority) === "Emergency") parts.push("Emergency");
  if (opts?.assigneeLabel) parts.push(opts.assigneeLabel);
  else if (w.status === "in_progress") parts.push("In progress");
  else if (w.status === "on_hold" && w.hold_reason) parts.push(w.hold_reason);
  else if (w.scheduled_at) parts.push(formatScheduleWhen(w.scheduled_at));
  else if (w.created_at) parts.push(formatRelativeWhen(w.created_at));
  return parts.filter(Boolean).join(" · ") || "—";
}
