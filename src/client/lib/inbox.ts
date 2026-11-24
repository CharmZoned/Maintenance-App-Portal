/**
 * The inbox: every conversation the signed-in user can open in Messages, and
 * the ONE definition of "new activity" used for every role — by the Messages
 * page, the Messages nav badge, the bell, the admin dashboard's Unread
 * messages KPI and the landlord Home messages card.
 *
 * Two kinds of conversation:
 *   - office  — a direct thread between one portal user (tenant, landlord or
 *               team member) and the office (OfficeMessages / OfficeThreadReads)
 *   - request — the comment thread on a maintenance request
 *               (MaintenanceRequestComments / MaintenanceThreadReads)
 *
 * Whose side a message is on depends on who reads (see `isOurs`): for an admin
 * it is the office — every admin together, so a reply from any admin answers
 * the thread for all of them; for anyone else it is that person alone.
 *
 * Read state is saved per user (RLS: own rows only), so it survives reloads
 * and is the same on every screen.
 */
import { supabase } from "@/lib/supabase";
import type { AppRole } from "@/types.supabase";

/** Fired on `window` when the signed-in user read or answered a conversation. */
export const INBOX_CHANGED_EVENT = "lg:inbox-changed";

export function announceInboxChanged(): void {
  // Whatever was loading started before the change: later readers must not join it.
  inboxInFlight.clear();
  if (typeof window !== "undefined") window.dispatchEvent(new Event(INBOX_CHANGED_EVENT));
}

/** One message, reduced to what the unread rule needs. */
export interface InboxMessage {
  at: string;
  /** Written by the reader's own side (`isOurs`): the office for an admin, the reader themself otherwise. */
  ours: boolean;
  /** When the reader last read the thread this message belongs to; null = never. */
  readAt: string | null;
}

/** Who reads the inbox. `userId` only matters for non-admins. */
export interface InboxViewer {
  role: AppRole;
  userId: string | null;
}

/** The office's view: every signed-in admin reads the same inbox. */
export const OFFICE_VIEWER: InboxViewer = { role: "admin", userId: null };

/**
 * Is this message from the reader's own side? Admins speak as the office, so
 * any admin's message is "ours" to every admin. Everyone else speaks only for
 * themselves: a message is theirs when they wrote it.
 */
export function isOurs(
  viewer: InboxViewer,
  message: { author_role: AppRole | null; author_user_id: string | null },
): boolean {
  if (viewer.role === "admin") return message.author_role === "admin";
  return viewer.userId != null && message.author_user_id === viewer.userId;
}

const ms = (iso: string | null | undefined) => {
  if (!iso) return Number.NaN;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? Number.NaN : t;
};

/**
 * THE unread rule, for every role. A conversation is unread when someone on
 * the other side wrote in it after
 *   1. the reader's side last replied there (for admins: any admin), and
 *   2. the reader last opened it.
 * The reader's own side's messages are never unread.
 */
export function isConversationUnread(messages: readonly InboxMessage[]): boolean {
  let lastReply = Number.NEGATIVE_INFINITY;
  for (const m of messages) {
    const t = ms(m.at);
    if (m.ours && t > lastReply) lastReply = t;
  }
  return messages.some((m) => {
    if (m.ours) return false;
    const t = ms(m.at);
    if (Number.isNaN(t) || t <= lastReply) return false;
    const read = ms(m.readAt);
    return Number.isNaN(read) || t > read;
  });
}

/** How many conversations are unread — the number every surface shows. */
export function countUnreadConversations(conversations: readonly { unread: boolean }[]): number {
  return conversations.filter((c) => c.unread).length;
}

/** The latest message of a conversation, with who wrote it. */
export interface InboxLastMessage {
  at: string;
  body: string;
  authorRole: AppRole | null;
  authorUserId: string | null;
  /** Request comments only. */
  authorTenantId: number | null;
  authorStaffId: number | null;
}

export type InboxConversation =
  | { key: string; kind: "office"; threadUserId: string; last: InboxLastMessage; unread: boolean }
  | { key: string; kind: "request"; requestId: number; last: InboxLastMessage; unread: boolean };

export const officeKey = (threadUserId: string) => `office:${threadUserId}`;
export const requestKey = (requestId: number) => `wo:${requestId}`;

// ── Raw rows (as read from Supabase) ────────────────────────────────

export interface OfficeMessageRow {
  id: number;
  created_at: string;
  thread_user_id: string;
  author_user_id: string | null;
  author_role: AppRole;
  body: string;
}

export interface OfficeReadRow {
  thread_user_id: string;
  last_read_at: string;
}

export interface RequestCommentRow {
  id: number;
  created_at: string;
  maintenance_request_id: number;
  author_user_id: string | null;
  author_role: AppRole | null;
  author_tenant_id: number | null;
  author_staff_id: number | null;
  visibility: string | null;
  body: string;
}

export interface RequestReadRow {
  maintenance_request_id: number;
  thread: string;
  last_read_at: string;
}

/** Which MaintenanceThreadReads row covers a comment: shared = tenant-visible, office = internal. */
export function requestReadThread(visibility: string | null | undefined): "shared" | "office" {
  return visibility === "internal" ? "office" : "shared";
}

/**
 * Group raw rows into conversations, newest first. Pure — the loader below and
 * the unit tests feed it. `viewer` decides whose side each message is on; it
 * defaults to the office (the admin inbox).
 */
export function buildInbox(
  input: {
    officeMessages: readonly OfficeMessageRow[];
    officeReads: readonly OfficeReadRow[];
    comments: readonly RequestCommentRow[];
    requestReads: readonly RequestReadRow[];
  },
  viewer: InboxViewer = OFFICE_VIEWER,
): InboxConversation[] {
  const conversations: InboxConversation[] = [];

  const officeRead = new Map(input.officeReads.map((r) => [r.thread_user_id, r.last_read_at]));
  const officeThreads = new Map<string, OfficeMessageRow[]>();
  for (const m of input.officeMessages) {
    const list = officeThreads.get(m.thread_user_id) ?? [];
    list.push(m);
    officeThreads.set(m.thread_user_id, list);
  }
  for (const [threadUserId, rows] of officeThreads) {
    const readAt = officeRead.get(threadUserId) ?? null;
    const last = latest(rows);
    conversations.push({
      key: officeKey(threadUserId),
      kind: "office",
      threadUserId,
      last: {
        at: last.created_at,
        body: last.body,
        authorRole: last.author_role,
        authorUserId: last.author_user_id,
        authorTenantId: null,
        authorStaffId: null,
      },
      unread: isConversationUnread(
        rows.map((m) => ({ at: m.created_at, ours: isOurs(viewer, m), readAt })),
      ),
    });
  }

  const requestRead = new Map(
    input.requestReads.map((r) => [`${r.maintenance_request_id}:${r.thread}`, r.last_read_at]),
  );
  const requestThreads = new Map<number, RequestCommentRow[]>();
  for (const c of input.comments) {
    const list = requestThreads.get(c.maintenance_request_id) ?? [];
    list.push(c);
    requestThreads.set(c.maintenance_request_id, list);
  }
  for (const [requestId, rows] of requestThreads) {
    const last = latest(rows);
    conversations.push({
      key: requestKey(requestId),
      kind: "request",
      requestId,
      last: {
        at: last.created_at,
        body: last.body,
        authorRole: last.author_role,
        authorUserId: last.author_user_id,
        authorTenantId: last.author_tenant_id,
        authorStaffId: last.author_staff_id,
      },
      unread: isConversationUnread(
        rows.map((c) => ({
          at: c.created_at,
          ours: isOurs(viewer, c),
          readAt: requestRead.get(`${requestId}:${requestReadThread(c.visibility)}`) ?? null,
        })),
      ),
    });
  }

  return conversations.sort((a, b) => ms(b.last.at) - ms(a.last.at) || a.key.localeCompare(b.key));
}

function latest<T extends { created_at: string; id: number }>(rows: readonly T[]): T {
  return rows.reduce((best, row) => {
    const diff = ms(row.created_at) - ms(best.created_at);
    return diff > 0 || (diff === 0 && row.id > best.id) ? row : best;
  });
}

// ── Supabase access ─────────────────────────────────────────────────

/** How far back the inbox reads. Older conversations are not listed nor counted. */
const OFFICE_MESSAGE_WINDOW = 500;
const REQUEST_COMMENT_WINDOW = 1000;

function fail(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

/**
 * Loads already on their way, by viewer. Callers that ask at the same moment
 * (the nav badge, the bell and the Messages page on one navigation) share one
 * instead of reading the whole inbox several times. Cleared when it settles
 * and when the inbox announces a change, so a read after a write is fresh.
 */
const inboxInFlight = new Map<string, Promise<InboxConversation[]>>();

const viewerKey = (viewer: InboxViewer) =>
  viewer.role === "admin" ? "admin" : `${viewer.role}:${viewer.userId ?? ""}`;

/**
 * Every conversation the viewer can open in Messages, with their saved read
 * state. RLS limits the rows to what they may see (a tenant gets their own
 * office thread and the tenant-visible comments on their home's requests) and
 * returns only their own read rows.
 */
export function loadInbox(viewer: InboxViewer): Promise<InboxConversation[]> {
  const key = viewerKey(viewer);
  const pending = inboxInFlight.get(key);
  if (pending) return pending;
  const load = readInbox(viewer);
  inboxInFlight.set(key, load);
  const clear = () => {
    if (inboxInFlight.get(key) === load) inboxInFlight.delete(key);
  };
  load.then(clear, clear);
  return load;
}

/** The office inbox, as any signed-in admin reads it. */
export function loadAdminInbox(): Promise<InboxConversation[]> {
  return loadInbox(OFFICE_VIEWER);
}

/**
 * Landlords have no request conversations: request messaging with the owner
 * is out of scope (SOW), so their inbox is their office thread alone.
 */
export const hasRequestConversations = (role: AppRole) => role !== "landlord";

/**
 * `withBodies: false` reads the same rows without message text — enough for
 * the unread rule (authorship and times), and much lighter for the nav badge,
 * which reloads on every route change.
 */
async function readInbox(viewer: InboxViewer, { withBodies = true } = {}): Promise<InboxConversation[]> {
  const body = withBodies ? ", body" : "";
  const none = Promise.resolve({ data: [] as never[], error: null });
  const withRequests = hasRequestConversations(viewer.role);
  const [office, officeReads, comments, requestReads] = await Promise.all([
    supabase
      .from("OfficeMessages")
      .select(`id, created_at, thread_user_id, author_user_id, author_role${body}`)
      .order("created_at", { ascending: false })
      .limit(OFFICE_MESSAGE_WINDOW),
    supabase.from("OfficeThreadReads").select("thread_user_id, last_read_at"),
    withRequests
      ? supabase
          .from("MaintenanceRequestComments")
          .select(
            `id, created_at, maintenance_request_id, author_user_id, author_role, author_tenant_id, author_staff_id, visibility${body}`,
          )
          .order("created_at", { ascending: false })
          .limit(REQUEST_COMMENT_WINDOW)
      : none,
    withRequests
      ? supabase.from("MaintenanceThreadReads").select("maintenance_request_id, thread, last_read_at")
      : none,
  ]);
  fail(office.error);
  fail(officeReads.error);
  fail(comments.error);
  fail(requestReads.error);
  const withBody = <T extends object>(rows: T[]) => rows.map((r) => ({ body: "", ...r }));
  return buildInbox(
    {
      officeMessages: withBody(office.data ?? []) as unknown as OfficeMessageRow[],
      officeReads: (officeReads.data ?? []) as OfficeReadRow[],
      comments: withBody(comments.data ?? []) as unknown as RequestCommentRow[],
      requestReads: (requestReads.data ?? []) as RequestReadRow[],
    },
    viewer,
  );
}

/** The viewer's unread conversation count — the Messages nav badge. */
export async function countInboxUnread(viewer: InboxViewer): Promise<number> {
  // Same rows and rule as the Messages page, minus the message text.
  return countUnreadConversations(await readInbox(viewer, { withBodies: false }));
}

/** The signed-in admin's unread count (Messages badge). */
export function countAdminUnread(): Promise<number> {
  return countInboxUnread(OFFICE_VIEWER);
}

let viewerCache: { userId: string; viewer: Promise<InboxViewer | null> } | null = null;

/**
 * The signed-in user as an inbox viewer (id and portal role), or null when
 * signed out or without a role. Cached per signed-in user.
 */
export async function currentInboxViewer(): Promise<InboxViewer | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const userId = session?.user.id ?? null;
  if (!userId) {
    viewerCache = null;
    return null;
  }
  if (viewerCache?.userId !== userId) {
    const viewer = (async (): Promise<InboxViewer | null> => {
      const { data, error } = await supabase.from("user_roles").select("role").eq("user_id", userId).maybeSingle();
      if (error || !data?.role) return null;
      return { role: data.role as AppRole, userId };
    })();
    viewerCache = { userId, viewer };
    // A failed lookup must not stick for the whole session.
    void viewer.then((v) => {
      if (!v && viewerCache?.viewer === viewer) viewerCache = null;
    });
  }
  return viewerCache.viewer;
}

/**
 * Which MaintenanceThreadReads rows a role keeps. Staff read the internal
 * ("office") comments too; tenants and landlords only ever see the shared
 * ones, and RLS refuses them a read row for the other.
 */
export function requestReadThreadsFor(role: AppRole): ReadonlyArray<"shared" | "office"> {
  return role === "admin" || role === "maintenance" ? ["shared", "office"] : ["shared"];
}

/**
 * Record that the signed-in user has read a request thread up to `through`
 * (the latest message they saw — a server timestamp, so clock skew cannot
 * leave it unread). Staff see the tenant-visible and the internal comments
 * together, so both are marked unless `threads` says otherwise.
 */
export async function markRequestThreadRead(
  requestId: number,
  through: string,
  threads: ReadonlyArray<"shared" | "office"> = ["shared", "office"],
): Promise<void> {
  const { error } = await supabase.from("MaintenanceThreadReads").upsert(
    threads.map((thread) => ({
      maintenance_request_id: requestId,
      thread,
      last_read_at: through,
    })),
    { onConflict: "user_id,maintenance_request_id,thread" },
  );
  fail(error);
}

/** Record that the signed-in user has read an office thread up to `through`. */
export async function markOfficeThreadRead(threadUserId: string, through: string): Promise<void> {
  const { error } = await supabase
    .from("OfficeThreadReads")
    .upsert({ thread_user_id: threadUserId, last_read_at: through }, { onConflict: "user_id,thread_user_id" });
  fail(error);
}

/** Record a conversation of either kind as read up to `through`, for `viewer` (default: an admin). */
export function markConversationRead(
  conversation: InboxConversation,
  through: string,
  viewer: InboxViewer = OFFICE_VIEWER,
): Promise<void> {
  return conversation.kind === "office"
    ? markOfficeThreadRead(conversation.threadUserId, through)
    : markRequestThreadRead(conversation.requestId, through, requestReadThreadsFor(viewer.role));
}

// ── Recording reads from the Messages page ──────────────────────────

/**
 * Decides when the Messages page writes a read, so a write that fails can never
 * turn into a retry loop. Kept free of React so it can be unit tested.
 *
 * - `open(key)`: the admin picked the conversation. Marks it read if it is
 *   unread. This is also how a failed write is retried: by the admin, once per
 *   click.
 * - `follow(key)`: the page's URL names this conversation (?thread=…). The page
 *   re-renders often while a thread is open, so this marks a given id at most
 *   once, until the URL names another one (or none: `follow(null)`). It never
 *   retries a write that failed.
 * - `seen(key, through)`: the open thread's messages loaded and the newest is
 *   `through`. If that is newer than the inbox knew (someone wrote after the
 *   page loaded), the read point moves up to it, so the thread does not come
 *   back as unread after a reload. Best effort, never retried.
 *
 * Writes for one conversation run one after another, so an older read point
 * can never land after a newer one.
 */
export interface InboxReadMarker {
  open(key: string): void;
  follow(key: string | null): void;
  seen(key: string, through: string): void;
}

export function createInboxReadMarker(deps: {
  /** The conversation as the page has it right now. */
  getConversation: (key: string) => InboxConversation | undefined;
  /** Show the conversation as read (false), or as unread again after a failed write (true). */
  setUnread: (key: string, unread: boolean) => void;
  write?: (conversation: InboxConversation, through: string) => Promise<void>;
  /** A read was stored, e.g. so the rail badge can catch up. */
  onWritten?: () => void;
}): InboxReadMarker {
  const write = deps.write ?? markConversationRead;
  /** Furthest read point written (or being written) per conversation. */
  const readThrough = new Map<string, number>();
  /** The tail of each conversation's write queue. */
  const queue = new Map<string, Promise<void>>();
  let followed: string | null = null;

  const enqueue = (key: string, task: () => Promise<void>): Promise<void> => {
    const run = (queue.get(key) ?? Promise.resolve()).then(task);
    const tail = run.catch(() => undefined);
    queue.set(key, tail);
    void tail.then(() => {
      if (queue.get(key) === tail) queue.delete(key);
    });
    return run;
  };

  const markUnreadAsRead = (key: string) => {
    const conversation = deps.getConversation(key);
    // Already read, or a write for it is on its way (it is shown read meanwhile).
    if (!conversation?.unread) return;
    const through = conversation.last.at;
    const previous = readThrough.get(key);
    readThrough.set(key, Math.max(previous ?? Number.NEGATIVE_INFINITY, ms(through)));
    deps.setUnread(key, false);
    enqueue(key, () => write(conversation, through)).then(
      () => deps.onWritten?.(),
      () => {
        // Not stored: show it unread again. `follow` will not try this id
        // again, so re-rendering cannot start a loop; a click retries.
        if (previous === undefined) readThrough.delete(key);
        else readThrough.set(key, previous);
        // Only if nothing happened there since: a reply sent meanwhile (or any
        // newer message) already settled the conversation's unread state.
        const current = deps.getConversation(key);
        if (current && ms(current.last.at) <= ms(through)) deps.setUnread(key, true);
      },
    );
  };

  return {
    open(key) {
      markUnreadAsRead(key);
    },
    follow(key) {
      if (key === followed) return;
      followed = key;
      if (key) markUnreadAsRead(key);
    },
    seen(key, through) {
      const conversation = deps.getConversation(key);
      const t = ms(through);
      if (!conversation || Number.isNaN(t)) return;
      // Nothing newer than the inbox's own latest message: open() and the inbox cover it.
      if (t <= ms(conversation.last.at)) return;
      if (t <= (readThrough.get(key) ?? Number.NEGATIVE_INFINITY)) return;
      readThrough.set(key, t);
      enqueue(key, () => write(conversation, through)).then(
        () => deps.onWritten?.(),
        () => undefined,
      );
    },
  };
}

/** Every message in one office thread, oldest first. */
export async function listOfficeMessages(threadUserId: string): Promise<OfficeMessageRow[]> {
  const { data, error } = await supabase
    .from("OfficeMessages")
    .select("id, created_at, thread_user_id, author_user_id, author_role, body")
    .eq("thread_user_id", threadUserId)
    .order("created_at", { ascending: true });
  fail(error);
  return (data ?? []) as OfficeMessageRow[];
}

/**
 * Write in an office thread: the office (an admin) answering a portal user, or
 * — with `as` set to their role — a portal user writing in their own thread.
 * RLS checks both the role and whose thread it is.
 */
export async function sendOfficeMessage(
  threadUserId: string,
  body: string,
  as: AppRole = "admin",
): Promise<OfficeMessageRow> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  const { data, error } = await supabase
    .from("OfficeMessages")
    .insert({ thread_user_id: threadUserId, author_user_id: user.id, author_role: as, body: body.trim() })
    .select("id, created_at, thread_user_id, author_user_id, author_role, body")
    .single();
  fail(error);
  return data as OfficeMessageRow;
}
