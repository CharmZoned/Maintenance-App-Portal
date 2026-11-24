/**
 * The bell: what happened to the signed-in user, built from real events.
 *
 * Sources (one capped query each, read in parallel):
 *   - messages      — the inbox (lib/inbox.ts): the latest message from the
 *                     other side of each conversation. Read state IS the
 *                     inbox's, so the bell and Messages can never disagree.
 *   - status        — MaintenanceRequestStatusHistory: a visit booked, work
 *                     started, work completed (never the user's own change).
 *   - urgent        — owners only: new High / Emergency requests on their
 *                     properties.
 * plus one lookup for the requests those rows name (titles, who reported it).
 *
 * Status and urgent items keep their read marks in NotificationReads (own rows
 * only); its '*' row is the "Mark all read" point.
 *
 * Copy speaks to the reader ("Your request “Kitchen tap” was completed") and
 * never tells someone about themselves.
 */
import {
  hasRequestConversations,
  isOurs,
  loadInbox,
  markConversationRead,
  type InboxConversation,
  type InboxViewer,
} from "@/lib/inbox";
import { formatMessageTime, type NotificationItemData } from "@/lib/messages";
import { requestDayInSentence } from "@/lib/request-status";
import { supabase } from "@/lib/supabase";
import type { AppRole } from "@/types.supabase";

/** The reader, with the record their role is linked to. */
export interface NotificationViewer extends InboxViewer {
  tenantId: number | null;
  staffId: number | null;
}

export interface StatusEventRow {
  id: number;
  created_at: string;
  maintenance_request_id: number;
  from_status: string | null;
  to_status: string;
  changed_by_user_id: string | null;
  changed_by_role: AppRole | null;
}

export interface NotificationRequestRow {
  id: number;
  title: string;
  priority: string;
  created_at: string;
  scheduled_for: string | null;
  submitted_by_tenant_id: number | null;
  assigned_staff_id: number | null;
  property_id: number | null;
}

export interface NotificationReadRow {
  item_key: string;
  read_at: string;
}

/** The "Mark all read" point's key in NotificationReads. */
export const READ_ALL_KEY = "*";
/** Status changes and urgent requests older than this are not shown. */
export const NOTIFICATION_WINDOW_DAYS = 30;
/** At most this many rows in the panel, newest first. */
export const NOTIFICATION_CAP = 30;
const MESSAGE_CAP = 20;
const STATUS_SCAN = 40;
const URGENT_SCAN = 20;

const REQUEST_COLUMNS =
  "id, title, priority, created_at, scheduled_for, submitted_by_tenant_id, assigned_staff_id, property_id";

const ms = (iso: string | null | undefined) => {
  const t = iso ? Date.parse(iso) : Number.NaN;
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
};

const quote = (title: string | null | undefined) => `“${title?.trim() || "Untitled request"}”`;

const snippet = (body: string, max = 90) => {
  const text = body.replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
};

type StatusKind = "scheduled" | "started" | "completed";

function statusKind(toStatus: string): StatusKind | null {
  switch (toStatus.trim().toLowerCase()) {
    case "scheduled":
      return "scheduled";
    case "in progress":
      return "started";
    case "closed":
      return "completed";
    default:
      return null;
  }
}

/** One message notification: the other side's latest word in a conversation. */
function messageItem(
  conversation: InboxConversation,
  viewer: NotificationViewer,
  requests: ReadonlyMap<number, NotificationRequestRow>,
  now: Date,
): NotificationItemData | null {
  const last = conversation.last;
  // Nothing new from the other side: the reader wrote last.
  if (isOurs(viewer, { author_role: last.authorRole, author_user_id: last.authorUserId })) return null;
  const base = {
    id: `msg:${conversation.key}`,
    at: last.at,
    time: formatMessageTime(last.at, now),
    unread: conversation.unread,
    href: `/messages?thread=${encodeURIComponent(conversation.key)}`,
    detail: last.body ? snippet(last.body) : undefined,
  };

  if (conversation.kind === "office") {
    if (viewer.role !== "admin") return { ...base, sentence: "Landlord Gopher sent you a message" };
    const who =
      last.authorRole === "tenant"
        ? "A tenant"
        : last.authorRole === "landlord"
          ? "An owner"
          : last.authorRole === "maintenance"
            ? "A technician"
            : "Someone";
    return { ...base, sentence: `${who} messaged the office` };
  }

  const request = requests.get(conversation.requestId);
  const title = quote(request?.title ?? `Request ${conversation.requestId}`);
  const author = last.authorRole;
  switch (viewer.role) {
    case "tenant": {
      const yours = request?.submitted_by_tenant_id != null && request.submitted_by_tenant_id === viewer.tenantId;
      const onIt = yours ? `your request ${title}` : `the request ${title} for your home`;
      const who =
        author === "admin" ? "Landlord Gopher" : author === "maintenance" ? "Your technician" : "Someone in your home";
      return { ...base, sentence: `${who} replied on ${onIt}` };
    }
    case "maintenance": {
      const who =
        author === "admin" ? "Landlord Gopher" : author === "tenant" ? "The tenant" : "Another technician";
      const mine = request?.assigned_staff_id != null && request.assigned_staff_id === viewer.staffId;
      return { ...base, sentence: `${who} wrote on ${mine ? "your job " : ""}${title}` };
    }
    default: {
      const who = author === "tenant" ? "The tenant" : author === "maintenance" ? "The technician" : "Someone";
      return { ...base, sentence: `${who} wrote on ${title}` };
    }
  }
}

/** One status notification, or null when it is not news to this reader. */
function statusItem(
  event: StatusEventRow,
  viewer: NotificationViewer,
  requests: ReadonlyMap<number, NotificationRequestRow>,
  propertyNames: ReadonlyMap<number, string>,
  now: Date,
): Omit<NotificationItemData, "unread"> | null {
  const kind = statusKind(event.to_status);
  if (!kind || event.from_status == null) return null;
  // Their own change is not news. For admins the office is one voice.
  if (viewer.userId != null && event.changed_by_user_id === viewer.userId) return null;
  if (viewer.role === "admin" && event.changed_by_role === "admin") return null;
  const request = requests.get(event.maintenance_request_id);
  if (!request) return null;
  const title = quote(request.title);
  let sentence: string | null = null;

  switch (viewer.role) {
    case "tenant": {
      const yours = request.submitted_by_tenant_id != null && request.submitted_by_tenant_id === viewer.tenantId;
      const subject = yours ? `Your request ${title}` : `The request ${title} for your home`;
      const day = requestDayInSentence(request.scheduled_for, now);
      sentence =
        kind === "scheduled"
          ? `${subject} is booked${day ? ` for ${day}` : ""}`
          : kind === "started"
            ? `Work started on ${yours ? "your request" : "the request"} ${title}`
            : `${subject} was completed`;
      break;
    }
    case "maintenance": {
      if (request.assigned_staff_id == null || request.assigned_staff_id !== viewer.staffId) return null;
      const day = requestDayInSentence(request.scheduled_for, now);
      sentence =
        kind === "scheduled"
          ? `You’re booked for ${title}${day ? (day === "today" || day === "yesterday" ? ` ${day}` : ` on ${day}`) : ""}`
          : kind === "started"
            ? `Your job ${title} was marked started`
            : `Your job ${title} was marked completed`;
      break;
    }
    case "landlord": {
      if (kind !== "completed") return null;
      const place = request.property_id != null ? propertyNames.get(request.property_id) : undefined;
      sentence = `${title}${place ? ` at ${place}` : ""} was completed`;
      break;
    }
    case "admin":
      if (kind === "scheduled") return null; // the office books visits itself
      sentence = kind === "started" ? `Work started on ${title}` : `${title} was completed`;
      break;
    default:
      return null;
  }

  return {
    id: `status:${event.id}`,
    sentence,
    at: event.created_at,
    time: formatMessageTime(event.created_at, now),
    href: `/maintenance/${request.id}`,
  };
}

function urgentItem(
  request: NotificationRequestRow,
  propertyNames: ReadonlyMap<number, string>,
  now: Date,
): Omit<NotificationItemData, "unread"> | null {
  const priority = request.priority.trim().toLowerCase();
  if (priority !== "urgent" && priority !== "high") return null;
  const place = request.property_id != null ? propertyNames.get(request.property_id) : undefined;
  const label = priority === "urgent" ? "Emergency request" : "High-priority request";
  return {
    id: `urgent:${request.id}`,
    sentence: `${label}${place ? ` at ${place}` : ""}: ${quote(request.title)}`,
    at: request.created_at,
    time: formatMessageTime(request.created_at, now),
    href: `/maintenance/${request.id}`,
  };
}

/**
 * The bell's rows, newest first. Pure — the loader below and the unit tests
 * feed it.
 *
 * Unread: a message row is unread exactly when its conversation is (the inbox
 * rule); any other row when it is newer than the "Mark all read" point and
 * has not been opened.
 */
export function buildNotifications(input: {
  viewer: NotificationViewer;
  inbox: readonly InboxConversation[];
  statusEvents: readonly StatusEventRow[];
  urgent: readonly NotificationRequestRow[];
  requests: readonly NotificationRequestRow[];
  reads: readonly NotificationReadRow[];
  propertyNames?: ReadonlyMap<number, string>;
  now?: Date;
}): NotificationItemData[] {
  const now = input.now ?? new Date();
  const since = now.getTime() - NOTIFICATION_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const propertyNames = input.propertyNames ?? new Map<number, string>();
  const requests = new Map<number, NotificationRequestRow>();
  for (const row of [...input.urgent, ...input.requests]) requests.set(row.id, row);

  const readAll = ms(input.reads.find((r) => r.item_key === READ_ALL_KEY)?.read_at);
  const opened = new Set(input.reads.map((r) => r.item_key));
  const unreadAfterMarks = (item: Omit<NotificationItemData, "unread">): NotificationItemData => ({
    ...item,
    unread: !opened.has(item.id) && ms(item.at) > readAll,
  });

  const items: NotificationItemData[] = [];

  const conversations = [...input.inbox].sort((a, b) => ms(b.last.at) - ms(a.last.at));
  let messages = 0;
  for (const conversation of conversations) {
    if (messages >= MESSAGE_CAP) break;
    const item = messageItem(conversation, input.viewer, requests, now);
    if (!item) continue;
    items.push(item);
    messages += 1;
  }

  for (const event of input.statusEvents) {
    if (ms(event.created_at) < since) continue;
    const item = statusItem(event, input.viewer, requests, propertyNames, now);
    if (item) items.push(unreadAfterMarks(item));
  }

  if (input.viewer.role === "landlord") {
    for (const request of input.urgent) {
      if (ms(request.created_at) < since) continue;
      const item = urgentItem(request, propertyNames, now);
      if (item) items.push(unreadAfterMarks(item));
    }
  }

  return items
    .sort((a, b) => ms(b.at) - ms(a.at) || a.id.localeCompare(b.id))
    .slice(0, NOTIFICATION_CAP);
}

// ── Supabase access ─────────────────────────────────────────────────

function fail(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

let viewerCache: { userId: string; viewer: Promise<NotificationViewer | null> } | null = null;

/** The signed-in user with their role and linked tenant / staff record, or null. Cached per user. */
export async function currentNotificationViewer(): Promise<NotificationViewer | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const userId = session?.user.id ?? null;
  if (!userId) {
    viewerCache = null;
    return null;
  }
  if (viewerCache?.userId !== userId) {
    const viewer = (async (): Promise<NotificationViewer | null> => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("role, tenant_id, staff_id")
        .eq("user_id", userId)
        .maybeSingle();
      if (error || !data?.role) return null;
      return {
        role: data.role as AppRole,
        userId,
        tenantId: data.tenant_id ?? null,
        staffId: data.staff_id ?? null,
      };
    })();
    viewerCache = { userId, viewer };
    void viewer.then((v) => {
      if (!v && viewerCache?.viewer === viewer) viewerCache = null;
    });
  }
  return viewerCache.viewer;
}

export interface NotificationsSnapshot {
  items: NotificationItemData[];
  /** Kept so a message row can be marked read through its conversation. */
  inbox: InboxConversation[];
}

/** Everything the bell shows for `viewer`. */
export async function loadNotifications(
  viewer: NotificationViewer,
  opts?: { propertyNames?: ReadonlyMap<number, string>; now?: Date },
): Promise<NotificationsSnapshot> {
  const now = opts?.now ?? new Date();
  const since = new Date(now.getTime() - NOTIFICATION_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const none = Promise.resolve({ data: [] as never[], error: null });
  const toStatuses = viewer.role === "landlord" ? ["Closed"] : ["Scheduled", "In Progress", "Closed"];

  const [inbox, history, urgent, reads] = await Promise.all([
    loadInbox(viewer),
    supabase
      .from("MaintenanceRequestStatusHistory")
      .select("id, created_at, maintenance_request_id, from_status, to_status, changed_by_user_id, changed_by_role")
      .in("to_status", toStatuses)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(STATUS_SCAN),
    viewer.role === "landlord"
      ? supabase
          .from("MaintenanceRequests")
          .select(REQUEST_COLUMNS)
          .in("priority", ["High", "Urgent"])
          .gte("created_at", since)
          .order("created_at", { ascending: false })
          .limit(URGENT_SCAN)
      : none,
    supabase.from("NotificationReads").select("item_key, read_at"),
  ]);
  fail(history.error);
  fail(urgent.error);
  fail(reads.error);

  const statusEvents = (history.data ?? []) as StatusEventRow[];
  const urgentRows = (urgent.data ?? []) as NotificationRequestRow[];

  // Titles for the requests the other sources name (one lookup, bounded).
  const known = new Set(urgentRows.map((r) => r.id));
  const wanted = new Set<number>();
  for (const event of statusEvents) if (!known.has(event.maintenance_request_id)) wanted.add(event.maintenance_request_id);
  if (hasRequestConversations(viewer.role)) {
    const recent = inbox
      .filter((c): c is Extract<InboxConversation, { kind: "request" }> => c.kind === "request")
      .sort((a, b) => ms(b.last.at) - ms(a.last.at))
      .slice(0, MESSAGE_CAP);
    for (const c of recent) if (!known.has(c.requestId)) wanted.add(c.requestId);
  }
  const ids = [...wanted].slice(0, STATUS_SCAN + MESSAGE_CAP);
  const lookup = ids.length
    ? await supabase.from("MaintenanceRequests").select(REQUEST_COLUMNS).in("id", ids)
    : { data: [] as NotificationRequestRow[], error: null };
  fail(lookup.error);

  return {
    inbox,
    items: buildNotifications({
      viewer,
      inbox,
      statusEvents,
      urgent: urgentRows,
      requests: (lookup.data ?? []) as NotificationRequestRow[],
      reads: (reads.data ?? []) as NotificationReadRow[],
      propertyNames: opts?.propertyNames,
      now,
    }),
  };
}

/** Save that the reader opened one row. Message rows mark their conversation read. */
export async function markNotificationRead(
  item: NotificationItemData,
  snapshot: NotificationsSnapshot,
  viewer: InboxViewer,
): Promise<void> {
  if (item.id.startsWith("msg:")) {
    const conversation = snapshot.inbox.find((c) => `msg:${c.key}` === item.id);
    if (conversation?.unread) await markConversationRead(conversation, conversation.last.at, viewer);
    return;
  }
  const { error } = await supabase
    .from("NotificationReads")
    .upsert({ item_key: item.id, read_at: new Date().toISOString() }, { onConflict: "user_id,item_key" });
  fail(error);
}

/**
 * "Mark all read": every unread conversation in the panel is read through its
 * latest message (so Messages agrees), and the '*' point moves up to the
 * newest event shown — a server time, so an event that lands meanwhile stays
 * unread. Per-row marks it covers are dropped to keep the table small.
 */
export async function markAllNotificationsRead(
  snapshot: NotificationsSnapshot,
  viewer: InboxViewer,
): Promise<void> {
  const shown = new Set(snapshot.items.filter((i) => i.unread).map((i) => i.id));
  const conversations = snapshot.inbox.filter((c) => c.unread && shown.has(`msg:${c.key}`));
  const newest = snapshot.items
    .filter((i) => !i.id.startsWith("msg:"))
    .reduce<string | null>((best, i) => (i.at && ms(i.at) > ms(best) ? i.at : best), null);

  const writes: Promise<unknown>[] = conversations.map((c) => markConversationRead(c, c.last.at, viewer));
  if (newest) {
    writes.push(
      (async () => {
        const { error } = await supabase
          .from("NotificationReads")
          .upsert({ item_key: READ_ALL_KEY, read_at: newest }, { onConflict: "user_id,item_key" });
        fail(error);
        // Every row shown is now covered by the new point; best effort.
        await supabase.from("NotificationReads").delete().neq("item_key", READ_ALL_KEY);
      })(),
    );
  }
  const results = await Promise.allSettled(writes);
  const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failed) throw failed.reason instanceof Error ? failed.reason : new Error(String(failed.reason));
}
