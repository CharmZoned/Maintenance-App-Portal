import type {
  MaintenanceComment,
  MaintenanceStatusEvent,
  WorkOrder,
} from "@/types";
import { workOrderStatusFromDb } from "@/lib/mappers";
import { requestStatusFromDb, type RequestStatus } from "@/lib/request-status";
import { formatDate } from "@/lib/utils";

/**
 * Request timeline model (spec §2.4, owner review item 3).
 *
 * One chronological list, OLDEST FIRST, that mixes:
 *   - a synthetic "reported" entry at order.created_at,
 *   - status changes from MaintenanceRequestStatusHistory, written as plain
 *     sentences ("Sam Fixit started work"), never internal event names
 *     ("Offered to workers") or arrows ("Open → Scheduled"),
 *   - request messages (MaintenanceRequestComments).
 *
 * Every entry carries a person (name + role tag + initials) so the UI can draw
 * the who-line and avatar. Internal entries are dropped for tenant / landlord
 * viewers HERE, so a caller can never render them by mistake. The landlord
 * gets status events only (request messaging is out of scope per the SOW).
 *
 * Fix for the tenant "History out of order" bug ("Status · In progress" listed
 * under the creation date although it happened today): every entry is ordered
 * and stamped by its OWN timestamp (history row created_at, comment
 * created_at). Nothing is grouped under date headings and no date-only value
 * (scheduled_at, follow-up date) is ever used as an entry's time.
 */

/** Who is looking at the request page. Worker = the `maintenance` app role. */
export type RequestViewerRole = "admin" | "maintenance" | "tenant" | "landlord";

/**
 * Role tag shown next to a name. Admins read "Admin" to staff and
 * "Landlord Gopher" (the office) to tenants and landlords.
 */
export type TimelineRoleTag = "Admin" | "Maintenance" | "Tenant" | "Landlord" | "Landlord Gopher" | "System";

export interface TimelinePerson {
  /** Display name, e.g. "Sam Fixit". "You" when the viewer did it. */
  name: string;
  role: TimelineRoleTag;
  /** Initials for the avatar circle. */
  initials: string;
}

export type TimelineEntryKind = "reported" | "status" | "message";

export interface TimelineEntry {
  /** Stable React key: `reported`, `status-<id>`, `message-<id>`. */
  key: string;
  kind: TimelineEntryKind;
  /** ISO timestamp the entry is ordered by: when it happened. */
  at: string;
  actor: TimelinePerson;
  /** Status tag for status entries (and "New" on the report). */
  status?: RequestStatus;
  /** Sentence for reported/status entries; the message body for messages. */
  text: string;
  /** Optional extra line (a stored note that is not already in the sentence). */
  detail?: string;
  /** Staff-only: internal note or office-only event. Never true for tenant/landlord. */
  internal: boolean;
}

/**
 * A status history row. data.ts maps `changed_by_user_id`; pass
 * `people.nameForUserId` to name the real person instead of the role fallback.
 */
export type TimelineStatusEvent = MaintenanceStatusEvent & { changed_by_user_id?: string | null };

/**
 * Names the page can resolve. All optional: a missing name falls back to a
 * role phrase ("The worker", "Landlord Gopher"), never to a raw id.
 *
 * Sources (see request-ui-contract.md §4):
 *   staffById   ← listStaff()   (RLS: admin all; worker self; tenant/landlord the assigned worker)
 *   tenantName  ← order.tenant_first_name / tenant_last_name (listWorkOrders join)
 */
export interface TimelinePeople {
  staffById?: ReadonlyMap<number, { first_name: string; last_name: string }>;
  /** Reporter's name from the work order row. */
  tenantName?: string;
  /** The viewer's own Staff id (worker/admin): their entries read "You". */
  viewerStaffId?: number | null;
  /** The viewer's own Tenant id: their entries read "You". */
  viewerTenantId?: number | null;
  /** Office display name for admin-made entries without a resolvable name. */
  officeName?: string;
  /** Optional auth user id → display name (for history rows' changed_by_user_id). */
  nameForUserId?: (userId: string) => string | null | undefined;
}

export interface TimelineOptions {
  /** Day label used inside sentences ("Tue 17 Nov"). Injected so tests can pin it. */
  formatDay?: (iso: string) => string;
}

const DEFAULT_OFFICE = "Landlord Gopher";

/** History notes written by DB functions (supabase/migrations/*worker_job_pool.sql). */
const SYSTEM_NOTES = {
  created: "created",
  offered: "offered to workers",
  offerWithdrawn: "offer withdrawn",
  accepted: "accepted by worker",
  released: "released by worker",
  tenantConfirmed: "tenant confirmed it is fixed",
  tenantNotFixed: "tenant says it is not fixed",
} as const;

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function person(name: string, role: TimelineRoleTag): TimelinePerson {
  return { name, role, initials: initialsOf(name) };
}

function staffName(people: TimelinePeople, id: number | null | undefined): string | null {
  if (id == null) return null;
  const s = people.staffById?.get(id);
  if (!s) return null;
  return [s.first_name, s.last_name].filter(Boolean).join(" ").trim() || null;
}

function isStaffViewer(role: RequestViewerRole): boolean {
  return role === "admin" || role === "maintenance";
}

/** "Admin" to staff, "Landlord Gopher" to tenants and landlords. */
function adminTag(viewer: RequestViewerRole): TimelineRoleTag {
  return isStaffViewer(viewer) ? "Admin" : "Landlord Gopher";
}

function defaultFormatDay(iso: string): string {
  return formatDate(iso, { weekday: "short", day: "numeric", month: "short" });
}

function quoted(text: string): string {
  return `“${text}”`;
}

function capitalise(text: string): string {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

/** Who made a status change. Uses changed_by_user_id when it can be named. */
function statusActor(
  ev: TimelineStatusEvent,
  order: WorkOrder,
  people: TimelinePeople,
  viewer: RequestViewerRole,
): TimelinePerson {
  const office = people.officeName ?? DEFAULT_OFFICE;
  const named = ev.changed_by_user_id ? people.nameForUserId?.(ev.changed_by_user_id)?.trim() : null;
  switch (ev.changed_by_role) {
    case "maintenance": {
      if (named) return person(named, "Maintenance");
      // No staff id on the history row: the assigned worker is the best guess.
      const mine = people.viewerStaffId != null && people.viewerStaffId === order.assigned_staff_id;
      return person(mine ? "You" : staffName(people, order.assigned_staff_id) ?? "The worker", "Maintenance");
    }
    case "tenant": {
      const mine =
        viewer === "tenant" && people.viewerTenantId != null && people.viewerTenantId === order.tenant_id;
      return person(mine ? "You" : named || people.tenantName || "The tenant", "Tenant");
    }
    case "landlord":
      return person(named || "The landlord", "Landlord");
    case "admin":
      return person(isStaffViewer(viewer) && named ? named : office, adminTag(viewer));
    default:
      return person(office, isStaffViewer(viewer) ? "System" : "Landlord Gopher");
  }
}

function messageActor(c: MaintenanceComment, people: TimelinePeople, viewer: RequestViewerRole): TimelinePerson {
  const office = people.officeName ?? DEFAULT_OFFICE;
  switch (c.author_role) {
    case "tenant": {
      const mine = people.viewerTenantId != null && people.viewerTenantId === c.author_tenant_id;
      return person(mine ? "You" : people.tenantName || "The tenant", "Tenant");
    }
    case "maintenance": {
      const mine = c.author_staff_id != null && people.viewerStaffId === c.author_staff_id;
      return person(mine ? "You" : staffName(people, c.author_staff_id) ?? "The worker", "Maintenance");
    }
    case "landlord":
      return person("The landlord", "Landlord");
    case "admin": {
      const mine = c.author_staff_id != null && people.viewerStaffId === c.author_staff_id;
      const name = isStaffViewer(viewer) ? staffName(people, c.author_staff_id) : null;
      return person(mine ? "You" : name ?? office, adminTag(viewer));
    }
    default:
      return person(office, isStaffViewer(viewer) ? "System" : "Landlord Gopher");
  }
}

interface Sentence {
  text: string;
  internal: boolean;
  detail?: string;
}

interface SentenceContext {
  order: WorkOrder;
  people: TimelinePeople;
  formatDay: (iso: string) => string;
  /** This row is the most recent assignment / hold / completion in history. */
  latestAssign: boolean;
  latestHold: boolean;
  latestClose: boolean;
}

function noteOf(ev: MaintenanceStatusEvent): string {
  return ev.note?.trim() ?? "";
}

function isCreationRow(ev: MaintenanceStatusEvent): boolean {
  return ev.from_status == null || noteOf(ev).toLowerCase() === SYSTEM_NOTES.created;
}

type EventCategory = "assign" | "hold" | "close" | "other";

/** Which "latest …" bucket a history row belongs to. */
function categoryOf(ev: MaintenanceStatusEvent): EventCategory {
  if (isCreationRow(ev)) return "other";
  const note = noteOf(ev).toLowerCase();
  if (note === SYSTEM_NOTES.accepted) return "assign";
  if (Object.values(SYSTEM_NOTES).includes(note as (typeof SYSTEM_NOTES)[keyof typeof SYSTEM_NOTES])) return "other";
  const from = workOrderStatusFromDb(ev.from_status ?? "");
  const to = workOrderStatusFromDb(ev.to_status);
  if (from === to) return "other";
  if (from === "closed") return "other"; // reopen
  if (to === "scheduled") return "assign";
  if (to === "on_hold") return "hold";
  if (to === "closed") return "close";
  return "other";
}

/** Plain-language sentence for one history row, or null to hide it. */
function statusSentence(ev: MaintenanceStatusEvent, actor: TimelinePerson, ctx: SentenceContext): Sentence | null {
  const { order, people, formatDay } = ctx;
  const note = noteOf(ev);
  const lower = note.toLowerCase();
  const who = actor.name;

  if (isCreationRow(ev)) return null; // the synthetic "reported" entry covers it

  // Rows written by the job-pool / tenant-fix RPCs carry a fixed note.
  switch (lower) {
    case SYSTEM_NOTES.offered:
      return { text: `${who} offered this job to workers`, internal: true };
    case SYSTEM_NOTES.offerWithdrawn:
      return { text: `${who} withdrew the job offer`, internal: true };
    case SYSTEM_NOTES.released:
      return { text: `${who} released this job`, internal: true };
    case SYSTEM_NOTES.tenantConfirmed:
      return { text: `${who} confirmed it’s fixed`, internal: false };
    case SYSTEM_NOTES.tenantNotFixed:
      return { text: `${who} said it’s not fixed yet`, internal: false };
    case SYSTEM_NOTES.accepted: {
      const when = ctx.latestAssign && order.scheduled_at ? `, scheduled ${formatDay(order.scheduled_at)}` : "";
      return { text: `${who} accepted the job${when}`, internal: false };
    }
    default:
      break;
  }

  const from = ev.from_status != null ? workOrderStatusFromDb(ev.from_status) : null;
  const to = workOrderStatusFromDb(ev.to_status);
  const detail = note || undefined;

  if (from === to) {
    // A same-status row with a note we do not know: keep the note, no arrow.
    return note ? { text: `${who} updated this`, internal: false, detail } : null;
  }

  if (from === "closed") return { text: `${who} reopened this`, internal: false, detail };

  switch (to) {
    case "scheduled": {
      if (!ctx.latestAssign) return { text: `${who} assigned this`, internal: false, detail };
      const mine = people.viewerStaffId != null && people.viewerStaffId === order.assigned_staff_id;
      const assignee = mine ? "you" : staffName(people, order.assigned_staff_id);
      if (!assignee) return { text: `${who} assigned this`, internal: false, detail };
      const when = order.scheduled_at ? `, scheduled ${formatDay(order.scheduled_at)}` : "";
      return { text: `${who} assigned ${assignee}${when}`, internal: false, detail };
    }
    case "in_progress":
      return { text: from === "on_hold" ? `${who} resumed work` : `${who} started work`, internal: false, detail };
    case "on_hold": {
      const reason = note || (ctx.latestHold ? order.hold_reason?.trim() ?? "" : "");
      const follow =
        ctx.latestHold && order.status === "on_hold" && order.next_follow_up_date
          ? ` · follow-up ${formatDay(order.next_follow_up_date)}`
          : "";
      const base = reason ? `${who} put this on hold: ${quoted(capitalise(reason))}` : `${who} put this on hold`;
      return { text: `${base}${follow}`, internal: false };
    }
    case "closed": {
      const fixed = (ctx.latestClose ? order.resolution_notes?.trim() : "") || note;
      return { text: fixed ? `${who} completed this: ${quoted(fixed)}` : `${who} completed this`, internal: false };
    }
    case "open":
    default:
      return { text: `${who} moved this back to New`, internal: false, detail };
  }
}

/** Parsed time, or NaN. */
function timeOf(iso: string): number {
  return Date.parse(iso);
}

const KIND_ORDER: Record<TimelineEntryKind, number> = { reported: 0, status: 1, message: 2 };

/** Numeric id at the end of a key ("status-12" → 12), for a natural tie-break. */
function keyId(key: string): number {
  const m = /-(\d+)$/.exec(key);
  return m ? Number(m[1]) : Number.NaN;
}

/**
 * Oldest first, by full timestamp. Ties: report, then status, then message,
 * then id (numeric when both keys carry one).
 */
export function compareTimeline(a: TimelineEntry, b: TimelineEntry): number {
  const ta = timeOf(a.at);
  const tb = timeOf(b.at);
  const aOk = !Number.isNaN(ta);
  const bOk = !Number.isNaN(tb);
  if (aOk && bOk && ta !== tb) return ta - tb;
  if (aOk !== bOk) return aOk ? -1 : 1; // unparseable times sink to the end
  if (!aOk && !bOk && a.at !== b.at) return a.at < b.at ? -1 : 1;
  const k = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
  if (k !== 0) return k;
  const ia = keyId(a.key);
  const ib = keyId(b.key);
  if (!Number.isNaN(ia) && !Number.isNaN(ib) && ia !== ib) return ia - ib;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/** History rows in the order they happened (by created_at, then id). */
function chronological<T extends { created_at: string; id: number }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    const d = timeOf(a.created_at) - timeOf(b.created_at);
    if (!Number.isNaN(d) && d !== 0) return d;
    return a.id - b.id;
  });
}

/**
 * Build the request timeline for one viewer.
 *
 * @param order     the work order (listWorkOrders row)
 * @param activity  listMaintenanceStatusHistory(order.id)
 * @param messages  listMaintenanceComments(order.id)
 * @param people    names the page could resolve (see TimelinePeople)
 * @param role      the viewer; tenant / landlord never receive internal entries,
 *                  and the landlord receives no messages at all
 * @param options   formatting hooks (tests pin the day label)
 */
export function buildTimeline(
  order: WorkOrder,
  activity: readonly TimelineStatusEvent[],
  messages: readonly MaintenanceComment[],
  people: TimelinePeople,
  role: RequestViewerRole,
  options: TimelineOptions = {},
): TimelineEntry[] {
  const staff = isStaffViewer(role);
  const formatDay = options.formatDay ?? defaultFormatDay;
  const history = chronological(activity);

  // ── Reported (synthetic) ─────────────────────────────────────────
  const creation = history.find(isCreationRow);
  let reporter: TimelinePerson;
  if (order.tenant_id != null) {
    const mine = role === "tenant" && people.viewerTenantId != null && people.viewerTenantId === order.tenant_id;
    reporter = person(mine ? "You" : people.tenantName || "The tenant", "Tenant");
  } else if (creation && creation.changed_by_role && creation.changed_by_role !== "tenant") {
    // Staff-reported: name whoever created it (falls back to the office).
    reporter = statusActor(creation, order, people, role);
  } else {
    reporter = person(people.officeName ?? DEFAULT_OFFICE, staff ? "Admin" : "Landlord Gopher");
  }

  const entries: TimelineEntry[] = [
    {
      key: "reported",
      kind: "reported",
      at: order.created_at,
      actor: reporter,
      status: "New",
      text: `${reporter.name} reported this`,
      internal: false,
    },
  ];

  // ── Status events ────────────────────────────────────────────────
  const latestId: Record<Exclude<EventCategory, "other">, number | undefined> = {
    assign: undefined,
    hold: undefined,
    close: undefined,
  };
  for (const ev of history) {
    const cat = categoryOf(ev);
    if (cat !== "other") latestId[cat] = ev.id;
  }

  for (const ev of history) {
    const actor = statusActor(ev, order, people, role);
    const sentence = statusSentence(ev, actor, {
      order,
      people,
      formatDay,
      latestAssign: latestId.assign === ev.id,
      latestHold: latestId.hold === ev.id,
      latestClose: latestId.close === ev.id,
    });
    if (!sentence) continue;
    if (sentence.internal && !staff) continue;
    entries.push({
      key: `status-${ev.id}`,
      kind: "status",
      at: ev.created_at,
      actor,
      status: requestStatusFromDb(ev.to_status),
      text: sentence.text,
      detail: sentence.detail,
      internal: sentence.internal,
    });
  }

  // ── Messages (not for the landlord: request messaging is out of scope) ──
  if (role !== "landlord") {
    for (const c of messages) {
      const internal = c.visibility === "internal";
      if (internal && !staff) continue;
      entries.push({
        key: `message-${c.id}`,
        kind: "message",
        at: c.created_at,
        actor: messageActor(c, people, role),
        text: c.body,
        internal,
      });
    }
  }

  return entries.sort(compareTimeline);
}
