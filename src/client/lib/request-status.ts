import type { WorkOrder, WorkOrderPriority, WorkOrderStatus } from "@/types";
import { workOrderStatusFromDb } from "@/lib/mappers";
import { formatWeekdayDayMonth, toDay } from "@/lib/admin-dates";

/**
 * THE single source for request status / priority language (design brief §2.3).
 *
 * Every screen, for every role, shows exactly these five status labels and the
 * two priority badges below. Stored DB values never change:
 *   DB status:   Open | Scheduled | In Progress | On Hold | Closed
 *   DB priority: Low | Normal | High | Urgent
 *
 * Do not add another status → label switch anywhere in the client. Import from
 * here (components/maintenance/request-status.ts and work-order-status.ts only
 * re-export these for older importers).
 */

// ── Status ─────────────────────────────────────────────────────────

/** Q2 status labels only — never Open / Scheduled / Closed. */
export type RequestStatus = "New" | "Assigned" | "In progress" | "On hold" | "Completed";

/** Display order (queue tabs, filters, legends). */
export const REQUEST_STATUSES: readonly RequestStatus[] = [
  "New",
  "Assigned",
  "In progress",
  "On hold",
  "Completed",
] as const;

/**
 * Label for a bare stored status, when there is no row to inspect for an
 * assignee (status-history events, status dropdown options).
 * An Open row WITH an assignee reads "Assigned" — use toRequestStatus for rows.
 */
export const STATUS_LABEL: Record<WorkOrderStatus, RequestStatus> = {
  open: "New",
  scheduled: "Assigned",
  in_progress: "In progress",
  on_hold: "On hold",
  closed: "Completed",
};

/**
 * Map a live MaintenanceRequests row (status + assignee) to its status label.
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

/**
 * Label for a stored status string as it appears in MaintenanceRequestStatusHistory
 * ("In Progress", "On Hold", …) or as a client key ("in_progress").
 */
export function requestStatusFromDb(raw: string | null | undefined): RequestStatus {
  if (!raw) return "New";
  return STATUS_LABEL[workOrderStatusFromDb(raw)] ?? "New";
}

/** Options for a status picker: stored value + the shared label. */
export function statusOptions(
  values: readonly WorkOrderStatus[] = ["open", "scheduled", "in_progress", "on_hold", "closed"],
): { value: WorkOrderStatus; label: RequestStatus }[] {
  return values.map((value) => ({ value, label: STATUS_LABEL[value] }));
}

export function isOpenRequest(wo: Pick<WorkOrder, "status">): boolean {
  return wo.status !== "closed";
}

/**
 * THE day form for request screens: "Sat 14 Nov" (plus the year when it is not
 * this year). Every request date (page, lightbox, timeline, lists) goes through
 * here so one screen never mixes "Sun, Nov 15", "Nov 15" and "Sun 15 Nov".
 */
export function formatRequestDay(d: Date, now: Date = new Date()): string {
  const base = formatWeekdayDayMonth(toDay(d));
  return d.getFullYear() === now.getFullYear() ? base : `${base} ${d.getFullYear()}`;
}

/** Parse an ISO / date-only value; date-only (and the noon-UTC sentinel) keep their calendar day. */
function parseRequestDate(iso: string): { date: Date; dateOnly: boolean } | null {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(iso) || NOON_UTC_DATE_SENTINEL.test(iso);
  const d = dateOnly ? new Date(`${iso.slice(0, 10)}T00:00:00`) : new Date(iso);
  return Number.isNaN(d.getTime()) ? null : { date: d, dateOnly };
}

function daysBefore(d: Date, now: Date): number {
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startThat = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((startToday - startThat) / 86_400_000);
}

/** "Today" / "Yesterday" / "Tue 17 Nov" (date-only values keep their calendar day). */
export function requestDayWord(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "";
  const parsed = parseRequestDate(iso);
  if (!parsed) return "";
  const diff = daysBefore(parsed.date, now);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return formatRequestDay(parsed.date, now);
}

/** requestDayWord for use inside a sentence: "today", "yesterday", "Tue 17 Nov". */
export function requestDayInSentence(iso: string | null | undefined, now: Date = new Date()): string {
  const word = requestDayWord(iso, now);
  return word === "Today" || word === "Yesterday" ? word.toLowerCase() : word;
}

function capitaliseFirst(text: string): string {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

export interface RequestNextStepOptions {
  assigneeName?: string | null;
  /** Desktop list rows have their own Assigned to column: leave the name out. */
  omitAssignee?: boolean;
  /** When the request last moved to In progress (latest history event), for "Started today". */
  startedAt?: string | null;
  now?: Date;
}

/**
 * Words beside the status chip (spec §1), e.g. "Not assigned yet",
 * "Tue 17 Nov · Sam Fixit", "Started today · Sam Fixit",
 * "Waiting for part · follow-up Fri 20 Nov", "Today · Replaced the cartridge".
 * Returns undefined when there is nothing useful to add to the chip.
 */
export function requestNextStep(wo: WorkOrder, opts: RequestNextStepOptions = {}): string | undefined {
  const status = toRequestStatus(wo);
  const assignee = opts.omitAssignee ? undefined : opts.assigneeName?.trim() || undefined;
  const now = opts.now ?? new Date();
  const join = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(" · ") || undefined;
  switch (status) {
    case "New":
      return "Not assigned yet";
    case "Assigned":
      return join(requestDayWord(wo.scheduled_at, now), assignee) ?? "Not scheduled yet";
    case "In progress": {
      // Never surface draft resolution_notes until Completed.
      const day = requestDayInSentence(opts.startedAt, now);
      return join(day ? `Started ${day}` : null, assignee);
    }
    case "On hold": {
      const reason = wo.hold_reason?.trim();
      const follow = wo.next_follow_up_date ? `follow-up ${requestDayWord(wo.next_follow_up_date, now)}` : null;
      return join(reason ? capitaliseFirst(reason) : null, follow);
    }
    case "Completed":
      return join(requestDayWord(wo.completed_at, now), wo.resolution_notes?.trim());
    default:
      return undefined;
  }
}

/** Created-at of the latest history row that moved the request to In progress. */
export function inProgressSince(
  history: readonly { to_status: string; created_at: string }[],
): string | null {
  let latest: string | null = null;
  for (const ev of history) {
    if (requestStatusFromDb(ev.to_status) !== "In progress") continue;
    if (latest == null || Date.parse(ev.created_at) >= Date.parse(latest)) latest = ev.created_at;
  }
  return latest;
}

// ── Staff queue / worker "My jobs" bucketing ───────────────────────

export function staffQueueTab(status: WorkOrderStatus, assigned: boolean): "needs" | "active" | "completed" {
  if (status === "closed") return "completed";
  if (status === "open" && !assigned) return "needs";
  return "active";
}

export type JobSection = "Today" | "Upcoming" | "Job offers" | "On hold" | "Recently completed";

/** Display order of the My jobs sections. */
export const JOB_SECTIONS: readonly JobSection[] = ["Today", "Upcoming", "Job offers", "On hold", "Recently completed"];

/**
 * My jobs bucketing (Figma Worker / U7).
 * Past-day and unscheduled open work stay under Today; future calendar days → Upcoming.
 * `in_progress` stays under Today even when scheduled later.
 * A job offered to the worker pool but not accepted yet (open, nobody assigned)
 * is not one of the worker's jobs: it goes under "Job offers".
 */
export function jobSectionFor(
  order: Pick<WorkOrder, "status" | "scheduled_at"> & { assigned_staff_id?: number | null },
  now: Date,
): JobSection {
  if (order.status === "closed") return "Recently completed";
  if (order.status === "open" && order.assigned_staff_id === null) return "Job offers";
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

// ── Priority ───────────────────────────────────────────────────────

/** Priority badge — Emergency / High only (brief §2.3). */
export type PriorityLevel = "Emergency" | "High";

/**
 * Words for every stored priority. DB 'urgent' is ALWAYS "Emergency" — never
 * "Urgent" — so a request never says Emergency in one place and Urgent in another.
 */
export const PRIORITY_LABEL: Record<WorkOrderPriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Emergency",
};

/** Options for a priority picker (stored value + shared label). */
export const PRIORITY_OPTIONS: readonly { value: WorkOrderPriority; label: string }[] = [
  { value: "low", label: PRIORITY_LABEL.low },
  { value: "normal", label: PRIORITY_LABEL.normal },
  { value: "high", label: PRIORITY_LABEL.high },
  { value: "urgent", label: PRIORITY_LABEL.urgent },
];

/** Badge level, or null when the priority gets no badge (normal / low). */
export function priorityLevel(priority: WorkOrderPriority): PriorityLevel | null {
  if (priority === "urgent") return "Emergency";
  if (priority === "high") return "High";
  return null;
}

/** Plain word for a details row ("Priority  Emergency"). */
export function priorityLabel(priority: WorkOrderPriority | null | undefined): string {
  return PRIORITY_LABEL[priority ?? "normal"] ?? PRIORITY_LABEL.normal;
}

// ── Context lines ──────────────────────────────────────────────────

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

/** Staff queue row context: place · tenant · Emergency · assignee / schedule. */
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
  if (w.priority === "urgent") parts.push(PRIORITY_LABEL.urgent);
  if (opts?.assigneeLabel) parts.push(opts.assigneeLabel);
  else if (w.status === "in_progress") parts.push(STATUS_LABEL.in_progress);
  else if (w.status === "on_hold" && w.hold_reason) parts.push(w.hold_reason);
  else if (w.scheduled_at) parts.push(formatScheduleWhen(w.scheduled_at));
  else if (w.created_at) parts.push(formatRelativeWhen(w.created_at));
  return parts.filter(Boolean).join(" · ") || "—";
}

export function unitPropertyLabel(unit?: string | null, property?: string | null): string {
  const u = unit?.trim();
  const p = property?.trim();
  if (u && p) return `Unit ${u} · ${p}`;
  if (u) return `Unit ${u}`;
  if (p) return p;
  return "Your home";
}

// ── Dates ──────────────────────────────────────────────────────────

/**
 * Date-only write path stores noon-UTC (`…T12:00:00.000Z` via updateWorkOrder).
 * Mappers often surface the same instant as `…T12:00:00+00:00` / fractional seconds.
 */
const NOON_UTC_DATE_SENTINEL =
  /^\d{4}-\d{2}-\d{2}T12:00:00(?:\.\d+)?(?:Z|[+]00:00)$/;

/** Human "Today 9:12 am" / "Yesterday" / "Sat 14 Nov" for activity stamps. */
export function formatActivityStamp(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "";
  const parsed = parseRequestDate(iso);
  if (!parsed) return iso;
  const { date: d, dateOnly } = parsed;
  const dayDiff = daysBefore(d, now);
  if (dayDiff === 0) {
    // Date-only values carry no clock.
    return dateOnly ? "Today" : `Today ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
  }
  if (dayDiff === 1) return "Yesterday";
  return formatRequestDay(d, now);
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
  return formatRequestDay(d, now);
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

/** Newest first; stable on equal timestamps. */
export function compareCreatedDesc(a: { created_at: string; id?: number }, b: { created_at: string; id?: number }): number {
  if (a.created_at === b.created_at) {
    if (a.id != null && b.id != null) return b.id - a.id;
    return 0;
  }
  return a.created_at < b.created_at ? 1 : -1;
}
