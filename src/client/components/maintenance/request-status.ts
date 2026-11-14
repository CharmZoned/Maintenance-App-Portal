import type { WorkOrder, WorkOrderStatus } from "@/types";
import type { RequestStatus } from "@/components/patterns/status-chip";

/** Map DB work-order status → Figma Q2 StatusChip labels. */
export function toRequestStatus(order: WorkOrder): RequestStatus {
  switch (order.status) {
    case "open":
      return order.assigned_staff_id ? "Assigned" : "New";
    case "scheduled":
      return "Assigned";
    case "in_progress":
      return "In progress";
    case "on_hold":
      return "On hold";
    case "closed":
      return "Completed";
    default:
      return "New";
  }
}

export function staffQueueTab(status: WorkOrderStatus, assigned: boolean): "needs" | "active" | "completed" {
  if (status === "closed") return "completed";
  if (status === "open" && !assigned) return "needs";
  return "active";
}

export function formatRelativeWhen(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return `Today ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate()
  ) {
    return "Yesterday";
  }
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
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
  if (w.priority === "urgent") parts.push("Emergency");
  if (opts?.assigneeLabel) parts.push(opts.assigneeLabel);
  else if (w.status === "in_progress") parts.push("In progress");
  else if (w.status === "on_hold" && w.hold_reason) parts.push(w.hold_reason);
  else if (w.scheduled_at) parts.push(formatRelativeWhen(w.scheduled_at));
  else if (w.created_at) parts.push(formatRelativeWhen(w.created_at));
  return parts.filter(Boolean).join(" · ") || "—";
}
