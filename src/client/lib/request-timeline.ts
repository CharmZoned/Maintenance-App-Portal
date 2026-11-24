import type {
  MaintenanceComment,
  MaintenanceStatusEvent,
  WorkOrder,
} from "@/types";
import { workOrderStatusFromDb } from "@/lib/mappers";
import { requestStatusFromDb, type RequestStatus } from "@/lib/request-status";

/**
 * Request timeline model (brief N3 "Timeline", owner review item 3).
 *
 * One chronological list (oldest first) that mixes:
 *   - the report itself (order.created_at),
 *   - status changes from MaintenanceRequestStatusHistory, written as sentences
 *     ("Sam Fixit started work"), never internal event names
 *     ("Offered to workers") or arrows ("Open → Scheduled"),
 *   - request messages (MaintenanceRequestComments = the job chat).
 *
 * Every entry carries a person (name + role tag) so the UI can draw an avatar.
 * Internal entries are dropped for tenant / landlord viewers here, so a caller
 * can never render them by mistake.
 *
 * Fix for the tenant "History out of order" bug: the old tenant panel stamped
 * the CURRENT status onto order.created_at. Here each status entry uses its own
 * history row's created_at, and the report entry never carries a later status.
 */

/** Who is looking at the request page. Worker = the `maintenance` app role. */
export type RequestViewerRole = "admin" | "maintenance" | "tenant" | "landlord";

/** Role tag shown next to a name. "office" = Landlord Gopher staff without a name. */
export type TimelineRoleTag = "Admin" | "Maintenance" | "Tenant" | "Landlord" | "Landlord Gopher" | "System";

export interface TimelinePerson {
  /** Display name, e.g. "Sam Fixit". "You" when the viewer wrote it. */
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
  /** ISO timestamp the entry is ordered by. */
  at: string;
  actor: TimelinePerson;
  /** Status tag for status entries (and "New" on the report). */
  status?: RequestStatus;
  /** Sentence for reported/status entries; the message body for messages. */
  text: string;
  /** Optional second line (hold reason, resolution notes, a stored note). */
  detail?: string;
  /** Staff-only: internal note or office-only event. Never present for tenant/landlord. */
  internal: boolean;
}

/**
 * Names the page can resolve. All optional: a missing name falls back to the
 * role ("Maintenance", "Landlord Gopher"), never to a raw id.
 *
 * Sources (see request-ui-contract.md):
 *   staffById   ← listStaff()   (RLS: admin all; worker self; tenant/landlord the assigned worker)
 *   tenantName  ← order.tenant_first_name / tenant_last_name (listWorkOrders join)
 */
export interface TimelinePeople {
  staffById?: ReadonlyMap<number, { first_name: string; last_name: string }>;
  /** Reporter's name from the work order row. */
  tenantName?: string;
  /** The viewer's own Staff id (worker/admin) — their entries read "You". */
  viewerStaffId?: number | null;
  /** The viewer's own Tenant id — their entries read "You". */
  viewerTenantId?: number | null;
  /** Office display name for admin-authored entries without a Staff match. */
  officeName?: string;
}

/** History notes written by DB functions; mapped to sentences or hidden. */
const SYSTEM_NOTES = {
  created: "created",
  offered: "offered to workers",
  accepted: "accepted by worker",
  released: "released by worker",
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

function roleTag(role: string | null | undefined): TimelineRoleTag {
  switch (role) {
    case "admin":
      return "Admin";
    case "maintenance":
      return "Maintenance";
    case "tenant":
      return "Tenant";
    case "landlord":
      return "Landlord";
    case "system":
      return "System";
    default:
      return "Landlord Gopher";
  }
}

function isStaffViewer(role: RequestViewerRole): boolean {
  return role === "admin" || role === "maintenance";
}

/**
 * Status history has only changed_by_role (no staff id on the mapped row), so a
 * `maintenance` actor is taken to be the request's assigned worker.
 */
function statusActor(
  ev: MaintenanceStatusEvent,
  order: WorkOrder,
  people: TimelinePeople,
): TimelinePerson {
  const office = people.officeName ?? "Landlord Gopher";
  switch (ev.changed_by_role) {
    case "maintenance": {
      const mine = people.viewerStaffId != null && people.viewerStaffId === order.assigned_staff_id;
      const name = mine ? "You" : staffName(people, order.assigned_staff_id) ?? "Maintenance";
      return person(name, "Maintenance");
    }
    case "tenant":
      return person(people.tenantName || "Tenant", "Tenant");
    case "admin":
      return person(office, "Admin");
    case "landlord":
      return person("Landlord", "Landlord");
    default:
      return person(office, "Landlord Gopher");
  }
}

function messageActor(c: MaintenanceComment, people: TimelinePeople): TimelinePerson {
  const role = roleTag(c.author_role);
  if (c.author_role === "tenant") {
    const mine = people.viewerTenantId != null && people.viewerTenantId === c.author_tenant_id;
    return person(mine ? "You" : people.tenantName || "Tenant", "Tenant");
  }
  if (c.author_staff_id != null && people.viewerStaffId === c.author_staff_id) {
    return person("You", role);
  }
  const name = staffName(people, c.author_staff_id);
  if (name) return person(name, role);
  if (c.author_role === "admin") return person(people.officeName ?? "Landlord Gopher", role);
  return person(role === "Landlord Gopher" ? "Landlord Gopher" : role, role);
}

/** Plain-language sentence for one history row, or null to hide it. */
function statusSentence(
  ev: MaintenanceStatusEvent,
  order: WorkOrder,
  actor: TimelinePerson,
  people: TimelinePeople,
): { text: string; internal: boolean; detail?: string } | null {
  const note = ev.note?.trim() ?? "";
  const lower = note.toLowerCase();
  if (ev.from_status == null || lower === SYSTEM_NOTES.created) return null; // report entry covers it
  if (lower === SYSTEM_NOTES.offered) return { text: `${actor.name} sent this job to workers`, internal: true };
  if (lower === SYSTEM_NOTES.released) return { text: `${actor.name} released this job`, internal: true };
  if (lower === SYSTEM_NOTES.accepted) return { text: `${actor.name} accepted the job`, internal: false };

  const assignee = staffName(people, order.assigned_staff_id);
  const detail = note || undefined;
  switch (workOrderStatusFromDb(ev.to_status)) {
    case "scheduled":
      return { text: assignee ? `${actor.name} assigned ${assignee}` : `${actor.name} assigned this request`, internal: false, detail };
    case "in_progress":
      return { text: `${actor.name} started work`, internal: false, detail };
    case "on_hold":
      return { text: `${actor.name} put this on hold`, internal: false, detail };
    case "closed":
      return { text: `${actor.name} marked this completed`, internal: false, detail };
    case "open":
    default:
      return { text: `${actor.name} reopened this request`, internal: false, detail };
  }
}

const KIND_ORDER: Record<TimelineEntryKind, number> = { reported: 0, status: 1, message: 2 };

/** Oldest first; on equal timestamps: report, then status, then message, then id. */
export function compareTimeline(a: TimelineEntry, b: TimelineEntry): number {
  const ta = Date.parse(a.at);
  const tb = Date.parse(b.at);
  if (!Number.isNaN(ta) && !Number.isNaN(tb) && ta !== tb) return ta - tb;
  if (a.at !== b.at && (Number.isNaN(ta) || Number.isNaN(tb))) return a.at < b.at ? -1 : 1;
  const k = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
  if (k !== 0) return k;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/**
 * Build the request timeline for one viewer.
 *
 * @param order     the work order (listWorkOrders row)
 * @param activity  listMaintenanceStatusHistory(order.id)
 * @param messages  listMaintenanceComments(order.id)
 * @param people    names the page could resolve (see TimelinePeople)
 * @param role      the viewer; tenant / landlord never receive internal entries
 */
export function buildTimeline(
  order: WorkOrder,
  activity: readonly MaintenanceStatusEvent[],
  messages: readonly MaintenanceComment[],
  people: TimelinePeople,
  role: RequestViewerRole,
): TimelineEntry[] {
  const staff = isStaffViewer(role);
  const reporterName =
    role === "tenant" && people.viewerTenantId != null && people.viewerTenantId === order.tenant_id
      ? "You"
      : people.tenantName || "Tenant";
  const reporter = person(reporterName, order.tenant_id != null ? "Tenant" : "Landlord Gopher");

  const entries: TimelineEntry[] = [
    {
      key: "reported",
      kind: "reported",
      at: order.created_at,
      actor: reporter,
      status: "New",
      text: `${reporter.name} reported this`,
      detail: order.description?.trim() || undefined,
      internal: false,
    },
  ];

  for (const ev of activity) {
    const actor = statusActor(ev, order, people);
    const sentence = statusSentence(ev, order, actor, people);
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

  for (const c of messages) {
    const internal = c.visibility === "internal";
    if (internal && !staff) continue;
    entries.push({
      key: `message-${c.id}`,
      kind: "message",
      at: c.created_at,
      actor: messageActor(c, people),
      text: c.body,
      internal,
    });
  }

  return entries.sort(compareTimeline);
}
