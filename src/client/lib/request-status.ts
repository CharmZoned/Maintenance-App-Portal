import type { RequestStatus } from "@/components/patterns/status-chip";
import type { WorkOrder, WorkOrderPriority, WorkOrderStatus } from "@/types";
import { formatDate } from "@/lib/utils";

/**
 * Map live MaintenanceRequests status (+ assignee) to Figma Q2 RequestStatus chips.
 * DB: open | scheduled | in_progress | on_hold | closed
 * UI: New | Assigned | In progress | On hold | Completed
 */
export function toRequestStatus(wo: Pick<WorkOrder, "status" | "assigned_staff_id">): RequestStatus {
  switch (wo.status as WorkOrderStatus) {
    case "closed":
      return "Completed";
    case "on_hold":
      return "On hold";
    case "in_progress":
      return "In progress";
    case "scheduled":
      return "Assigned";
    case "open":
    default:
      return wo.assigned_staff_id ? "Assigned" : "New";
  }
}

export function isOpenRequest(wo: Pick<WorkOrder, "status">): boolean {
  return wo.status !== "closed";
}

/** Compact next-step / context line under a status chip. */
export function requestNextStep(
  wo: WorkOrder,
  opts?: { assigneeName?: string | null },
): string | undefined {
  const status = toRequestStatus(wo);
  const assignee = opts?.assigneeName?.trim();
  switch (status) {
    case "New":
      return "Needs assignment";
    case "Assigned": {
      const when = wo.scheduled_at
        ? formatDate(wo.scheduled_at, { weekday: "short", day: "numeric", month: "short" })
        : null;
      return [when, assignee].filter(Boolean).join(" · ") || "Assigned";
    }
    case "In progress":
      // Do not surface draft resolution_notes until Closed.
      return "Work in progress";
    case "On hold": {
      const reason = wo.hold_reason?.trim();
      const follow = wo.next_follow_up_date
        ? `follow-up ${formatDate(wo.next_follow_up_date, { weekday: "short", day: "numeric", month: "short" })}`
        : null;
      return [reason, follow].filter(Boolean).join(" · ") || "On hold";
    }
    case "Completed":
      return wo.resolution_notes?.trim() || "Closed";
    default:
      return undefined;
  }
}

/**
 * List-row context — place / property only (status + next-step live on StatusChip).
 */
export function requestContextLine(
  wo: WorkOrder,
  opts?: { includeProperty?: boolean; titleIncludesUnit?: boolean },
): string {
  const parts: string[] = [];
  if (opts?.includeProperty && wo.property_name) parts.push(wo.property_name);
  if (wo.unit_name && !opts?.titleIncludesUnit) {
    parts.push(`Unit ${wo.unit_name}`);
  }
  return parts.join(" · ");
}

export function priorityLevel(priority: WorkOrderPriority): "Emergency" | "High" | null {
  if (priority === "urgent") return "Emergency";
  if (priority === "high") return "High";
  return null;
}

/** Human "Today 9:12 am" / "Yesterday" / short date for activity stamps. */
export function formatActivityStamp(iso: string | null | undefined): string {
  if (!iso) return "";
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(iso);
  const d = new Date(dateOnly ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startThat = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayDiff = Math.round((startToday.getTime() - startThat.getTime()) / 86_400_000);
  if (dateOnly) {
    if (dayDiff === 0) return "Today";
    if (dayDiff === 1) return "Yesterday";
    return formatDate(iso, { weekday: "short", day: "numeric", month: "short" });
  }
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (dayDiff === 0) return `Today ${time}`;
  if (dayDiff === 1) return "Yesterday";
  return formatDate(iso, { day: "numeric", month: "short" });
}

export function unitPropertyLabel(unit?: string | null, property?: string | null): string {
  const u = unit?.trim();
  const p = property?.trim();
  if (u && p) return `Unit ${u} · ${p}`;
  if (u) return `Unit ${u}`;
  if (p) return p;
  return "Your home";
}

/** Newest first; stable on equal timestamps. */
export function compareCreatedDesc(a: { created_at: string; id?: number }, b: { created_at: string; id?: number }): number {
  if (a.created_at === b.created_at) {
    if (a.id != null && b.id != null) return b.id - a.id;
    return 0;
  }
  return a.created_at < b.created_at ? 1 : -1;
}
