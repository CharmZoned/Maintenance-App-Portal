import type { RequestStatus } from "@/components/patterns/status-chip";
import type { WorkOrder, WorkOrderPriority, WorkOrderStatus } from "@/types";
import { formatDate } from "@/lib/utils";

/** Who is reading the label. D4: every audience sees the same five words today. */
export type StatusAudience = "tenant" | "landlord" | "staff";

/** The fields that decide a status label. Pass the order to tell New from Assigned. */
export type StatusInput = Pick<WorkOrder, "status"> & Partial<Pick<WorkOrder, "assigned_staff_id">>;

/**
 * The one place a status turns into words (owner decision D4).
 * DB: open | scheduled | in_progress | on_hold | closed
 * UI: New | Assigned | In progress | On hold | Completed
 *
 * A bare DB status `open` reads "New". Pass the order instead and an open
 * request with an assignee reads "Assigned".
 */
export function statusLabel(
  status: WorkOrderStatus | StatusInput,
  audience: StatusAudience,
): RequestStatus {
  void audience; // Same words for everyone (D4); kept so screens say who is reading.
  const order: StatusInput = typeof status === "string" ? { status } : status;
  switch (order.status as WorkOrderStatus) {
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
      return order.assigned_staff_id ? "Assigned" : "New";
  }
}

/** Map live MaintenanceRequests status (+ assignee) to Figma Q2 RequestStatus chips. */
export function toRequestStatus(wo: StatusInput): RequestStatus {
  return statusLabel(wo, "staff");
}

/**
 * The one place a priority turns into words (owner decision D5).
 * DB `urgent` reads "Emergency"; `low` and `normal` both read "Normal".
 * Never print the raw DB value.
 */
export function priorityLabel(p: WorkOrderPriority): "Normal" | "High" | "Emergency" {
  if (p === "urgent") return "Emergency";
  if (p === "high") return "High";
  return "Normal";
}

export type NextStepWho = "office" | "worker" | "landlord" | "none";

export interface LandlordNextStep {
  who: NextStepWho;
  text: string;
}

const NOTHING_NEEDED = "Nothing needed from you.";
const OFFICE = "Landlord Gopher";

/** Hold reasons that mean the office is waiting on the landlord. */
const LANDLORD_HOLD = /\b(landlord|owner|approv\w*|sign[- ]?off|go[- ]?ahead)\b/i;

/** Calendar day from a date-only or noon-UTC value, e.g. "Tue, Nov 17". */
function shortDay(iso: string | null | undefined): string {
  const key = iso?.trim().slice(0, 10);
  if (!key || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return "";
  return formatDate(key, { weekday: "short", day: "numeric", month: "short" });
}

function cleanReason(reason: string | null | undefined): string {
  return (reason ?? "").replace(/\s+/g, " ").trim().replace(/[\s.…!]+$/u, "");
}

/** "Waiting on a part" -> "Landlord Gopher is waiting on a part." */
function holdSentence(reason: string): string {
  if (!reason) return `${OFFICE} has paused this job.`;
  if (/^(waiting|awaiting)\b/i.test(reason)) {
    return `${OFFICE} is ${reason.charAt(0).toLowerCase()}${reason.slice(1)}.`;
  }
  return `On hold: ${reason}.`;
}

/**
 * One plain sentence telling a landlord who has the request and whether they
 * need to do anything. Uses `hold_reason` and `next_follow_up_date` on holds.
 */
export function landlordNextStep(o: WorkOrder): LandlordNextStep {
  switch (statusLabel(o, "landlord")) {
    case "New":
      return { who: "office", text: `${OFFICE} will assign someone. ${NOTHING_NEEDED}` };
    case "Assigned": {
      const when = shortDay(o.scheduled_at);
      if (when) return { who: "worker", text: `Visit booked for ${when}. ${NOTHING_NEEDED}` };
      return { who: "office", text: `${OFFICE} is booking a visit. ${NOTHING_NEEDED}` };
    }
    case "In progress":
      return { who: "worker", text: `The work is under way. ${NOTHING_NEEDED}` };
    case "On hold": {
      const reason = cleanReason(o.hold_reason);
      const follow = shortDay(o.next_follow_up_date);
      const parts = [holdSentence(reason)];
      if (follow) parts.push(`Next check-in ${follow}.`);
      if (reason && LANDLORD_HOLD.test(reason)) {
        parts.push(`Message ${OFFICE} to answer.`);
        return { who: "landlord", text: parts.join(" ") };
      }
      parts.push(NOTHING_NEEDED);
      return { who: "office", text: parts.join(" ") };
    }
    case "Completed":
    default:
      return { who: "none", text: `This job is done. ${NOTHING_NEEDED}` };
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

/** Chip level for Emergency / High; null for Normal (no chip). */
export function priorityLevel(priority: WorkOrderPriority): "Emergency" | "High" | null {
  const label = priorityLabel(priority);
  return label === "Normal" ? null : label;
}

/**
 * Date-only write path stores noon-UTC (`…T12:00:00.000Z` via updateWorkOrder).
 * Mappers often surface the same instant as `…T12:00:00+00:00` / fractional seconds.
 */
const NOON_UTC_DATE_SENTINEL =
  /^\d{4}-\d{2}-\d{2}T12:00:00(?:\.\d+)?(?:Z|[+]00:00)$/;

/** Human "Today 9:12 am" / "Yesterday" / short date for activity stamps. */
export function formatActivityStamp(iso: string | null | undefined): string {
  if (!iso) return "";
  const plainDate = /^\d{4}-\d{2}-\d{2}$/.test(iso);
  const noonUtcSentinel = NOON_UTC_DATE_SENTINEL.test(iso);
  // Noon-UTC sentinel is date-only intent — show calendar day from iso prefix, no clock.
  const dateOnly = plainDate || noonUtcSentinel;
  const dayKey = dateOnly ? iso.slice(0, 10) : null;
  const d = dayKey ? new Date(`${dayKey}T00:00:00`) : new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startThat = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayDiff = Math.round((startToday.getTime() - startThat.getTime()) / 86_400_000);
  if (dateOnly) {
    if (dayDiff === 0) return "Today";
    if (dayDiff === 1) return "Yesterday";
    return formatDate(dayKey!, { weekday: "short", day: "numeric", month: "short" });
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
