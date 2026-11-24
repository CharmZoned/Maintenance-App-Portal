/**
 * Direct chat between one portal user (a landlord or a worker) and the
 * Landlord Gopher office, on the `OfficeMessages` / `OfficeThreadReads` tables
 * (migration 20261118190000_worker_job_pool.sql).
 *
 * A thread is keyed by the non-admin user it belongs to (`thread_user_id`).
 * RLS lets that user read and write only their own thread; every admin reads
 * and answers every thread. Kept out of data.ts so the landlord wave streams
 * don't fight over one file (docs/landlord-wave-plan.md, LG-B).
 */
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { listLandlords, listStaff, listUserAccounts, listOfficeThreads } from "./data";
import type { AppRole } from "../types.supabase";

export { listOfficeThreads };
export type { OfficeThreadSummary } from "./data";
export { useOfficeThreadPreview } from "../hooks/use-office-thread-preview";

export interface OfficeMessage {
  id: number;
  created_at: string;
  /** Whose thread this is (the landlord or worker talking to the office). */
  thread_user_id: string;
  author_user_id: string | null;
  author_role: AppRole;
  body: string;
  /** The request this message is about ("Regarding #MR-…"), when one was picked. */
  request_id: number | null;
}

/** Longest message the database accepts (CHECK on OfficeMessages.body). */
export const OFFICE_MESSAGE_MAX_LENGTH = 5000;

/** Fired on `window` after the signed-in user marks a thread read, so previews refresh. */
export const OFFICE_THREAD_READ_EVENT = "office-thread-read";

function fail(error: { message: string } | null): never {
  throw new Error(error?.message || "Supabase request failed");
}

type OfficeMessageRow = {
  id: number;
  created_at: string;
  thread_user_id: string;
  author_user_id: string | null;
  author_role: AppRole;
  body: string;
  request_id?: number | null;
};

/** `request_id` arrives with LG-A2's migration; until then it reads as null. */
export function toOfficeMessage(row: OfficeMessageRow): OfficeMessage {
  return {
    id: Number(row.id),
    created_at: row.created_at,
    thread_user_id: row.thread_user_id,
    author_user_id: row.author_user_id,
    author_role: row.author_role,
    body: row.body,
    request_id: row.request_id == null ? null : Number(row.request_id),
  };
}

/** The signed-in user's id, from the local session (no network round trip). */
export async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

/** Every message in one thread, oldest first. */
export async function listOfficeMessages(threadUserId: string): Promise<OfficeMessage[]> {
  // `*` rather than a column list: request_id only exists once LG-A2's migration lands.
  const { data, error } = await supabase
    .from("OfficeMessages")
    .select("*")
    .eq("thread_user_id", threadUserId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (error) fail(error);
  return ((data ?? []) as OfficeMessageRow[]).map(toOfficeMessage);
}

/**
 * Post a message into a thread as the signed-in user. A landlord or worker
 * writes into their own thread; an admin answers any landlord's or worker's
 * thread. `requestId` links the message to a request ("Regarding #MR-…") and
 * is only sent when given.
 */
export async function sendOfficeMessage(i: {
  threadUserId: string;
  body: string;
  requestId?: number;
}): Promise<OfficeMessage> {
  const body = i.body.trim();
  if (!body) throw new Error("Write a message first.");
  if (body.length > OFFICE_MESSAGE_MAX_LENGTH) {
    throw new Error(`Messages can be up to ${OFFICE_MESSAGE_MAX_LENGTH} characters.`);
  }

  const userId = await currentUserId();
  if (!userId) throw new Error("Not signed in.");

  const { data: roleRow, error: roleErr } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();
  if (roleErr) fail(roleErr);
  if (!roleRow) throw new Error("Your account has no portal role yet.");

  const row: Record<string, unknown> = {
    thread_user_id: i.threadUserId,
    author_user_id: userId,
    author_role: roleRow.role,
    body,
  };
  if (i.requestId != null) row.request_id = i.requestId;

  const insert = (values: Record<string, unknown>) =>
    supabase
      .from("OfficeMessages")
      // request_id is not in the generated types until LG-A2 regenerates them.
      .insert(values as never)
      .select("*")
      .single();

  let { data, error } = await insert(row);
  if (error && i.requestId != null && isMissingRequestIdColumn(error)) {
    // A database without OfficeMessages.request_id yet (D6's plain-text
    // fallback): keep the link as text so the office still knows which request.
    const { request_id: _dropped, ...plain } = row;
    void _dropped;
    plain.body = `Regarding ${await requestTag(i.requestId)}: ${body}`.slice(0, OFFICE_MESSAGE_MAX_LENGTH);
    ({ data, error } = await insert(plain));
  }
  if (error) fail(error);
  return toOfficeMessage(data as OfficeMessageRow);
}

function isMissingRequestIdColumn(error: { message?: string; code?: string }): boolean {
  const message = error.message ?? "";
  return /request_id/.test(message) && /(column|schema cache)/i.test(message);
}

/** "#MR-001007" for a request the caller can see, else "request #<id>". */
async function requestTag(requestId: number): Promise<string> {
  const { data } = await supabase
    .from("MaintenanceRequests")
    .select("request_number")
    .eq("id", requestId)
    .maybeSingle();
  const num = (data as { request_number?: string | null } | null)?.request_number?.trim();
  return num ? `#${num}` : `request #${requestId}`;
}

/**
 * Record that the signed-in user has read a thread up to now. Uses the later
 * of this device's clock and the thread's newest message, so a slow device
 * clock can't leave the latest message looking unread.
 */
export async function markOfficeThreadRead(threadUserId: string): Promise<void> {
  const userId = await currentUserId();
  if (!userId) throw new Error("Not signed in.");

  const latest = await supabase
    .from("OfficeMessages")
    .select("created_at")
    .eq("thread_user_id", threadUserId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (latest.error) fail(latest.error);

  let readAt = Date.now();
  const newest = latest.data?.[0]?.created_at;
  if (newest) {
    const ms = Date.parse(newest);
    if (Number.isFinite(ms) && ms > readAt) readAt = ms;
  }

  const { error } = await supabase
    .from("OfficeThreadReads")
    .upsert(
      { user_id: userId, thread_user_id: threadUserId, last_read_at: new Date(readAt).toISOString() },
      { onConflict: "user_id,thread_user_id" },
    );
  if (error) fail(error);

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(OFFICE_THREAD_READ_EVENT, { detail: { threadUserId } }));
  }
}

/** When the signed-in user last read a thread, or null if never. */
export async function getOfficeThreadReadAt(threadUserId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("OfficeThreadReads")
    .select("last_read_at")
    .eq("thread_user_id", threadUserId)
    .maybeSingle();
  if (error) fail(error);
  return data?.last_read_at ?? null;
}

/**
 * Messages the viewer has not read yet: written by the other side (for an
 * admin, by the landlord or worker; for them, by the office) after `readAt`.
 */
export function countUnreadOfficeMessages(
  messages: OfficeMessage[],
  viewer: { userId: string | null; isAdmin: boolean },
  readAt: string | null,
): number {
  const mine = (m: OfficeMessage) =>
    (viewer.userId != null && m.author_user_id === viewer.userId) ||
    (viewer.isAdmin ? m.author_role === "admin" : m.author_role !== "admin");
  // Replying counts as reading everything before the reply.
  let since = readAt ? Date.parse(readAt) : Number.NEGATIVE_INFINITY;
  for (const m of messages) {
    if (mine(m)) since = Math.max(since, Date.parse(m.created_at));
  }
  return messages.filter((m) => !mine(m) && Date.parse(m.created_at) > since).length;
}

// ── Live updates ──────────────────────────────────────────────────────

/** How often to re-check when the realtime socket is unavailable. */
const POLL_MS = 10_000;

export interface SubscribeOptions {
  /** Polling interval used when realtime is unavailable (default 10 s). */
  pollMs?: number;
}

/**
 * Call `cb` for every new message in the matching threads. Uses Supabase
 * realtime; if the socket can't connect (offline, or the local test
 * emulator, which has no realtime), it falls back to polling. Returns an
 * unsubscribe function.
 */
function subscribeOfficeMessages(
  threadUserId: string | null,
  cb: (message: OfficeMessage) => void,
  opts?: SubscribeOptions,
): () => void {
  const pollMs = opts?.pollMs ?? POLL_MS;
  let stopped = false;
  let channel: RealtimeChannel | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let lastSeenId = 0;
  const seen = new Set<number>();

  const deliver = (message: OfficeMessage) => {
    if (stopped || seen.has(message.id)) return;
    seen.add(message.id);
    if (message.id > lastSeenId) lastSeenId = message.id;
    cb(message);
  };

  const poll = async () => {
    await baseline;
    let query = supabase.from("OfficeMessages").select("*").gt("id", lastSeenId);
    if (threadUserId) query = query.eq("thread_user_id", threadUserId);
    const { data, error } = await query.order("id", { ascending: true }).limit(200);
    if (error || stopped) return;
    for (const row of (data ?? []) as OfficeMessageRow[]) deliver(toOfficeMessage(row));
  };

  const startPolling = () => {
    if (pollTimer || stopped) return;
    pollTimer = setInterval(() => void poll(), pollMs);
  };

  // Baseline: only messages after the newest one now count as new.
  const baseline = (async () => {
    let query = supabase.from("OfficeMessages").select("id");
    if (threadUserId) query = query.eq("thread_user_id", threadUserId);
    const { data } = await query.order("id", { ascending: false }).limit(1);
    const newest = data?.[0]?.id;
    if (newest != null && Number(newest) > lastSeenId) lastSeenId = Number(newest);
  })().catch(() => {});

  try {
    channel = supabase
      .channel(`office-messages:${threadUserId ?? "all"}:${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "OfficeMessages",
          ...(threadUserId ? { filter: `thread_user_id=eq.${threadUserId}` } : {}),
        },
        (payload) => deliver(toOfficeMessage(payload.new as OfficeMessageRow)),
      )
      .subscribe((status) => {
        if (stopped) return;
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          // Stop the socket retrying and check on a timer instead.
          if (channel) {
            const dead = channel;
            channel = null;
            void supabase.removeChannel(dead);
          }
          startPolling();
        }
      });
  } catch {
    startPolling();
  }

  return () => {
    stopped = true;
    if (pollTimer) clearInterval(pollTimer);
    if (channel) void supabase.removeChannel(channel);
  };
}

/** Live updates for one thread. Returns an unsubscribe function. */
export function subscribeOfficeThread(
  threadUserId: string,
  cb: (message: OfficeMessage) => void,
  opts?: SubscribeOptions,
): () => void {
  return subscribeOfficeMessages(threadUserId, cb, opts);
}

/** Admin: live updates across every thread (for the inbox's unread dots). */
export function subscribeOfficeInbox(cb: (message: OfficeMessage) => void, opts?: SubscribeOptions): () => void {
  return subscribeOfficeMessages(null, cb, opts);
}

// ── People the office can message (admin) ────────────────────────────

export type OfficeContactRole = "landlord" | "maintenance" | "tenant";

export interface OfficeContact {
  userId: string;
  role: OfficeContactRole;
  /** Display name: the landlord's or worker's name, else their company, else their email. */
  name: string;
  /** A second line: company or email. */
  detail: string | null;
}

function joinName(first?: string | null, last?: string | null): string {
  return [first?.trim(), last?.trim()].filter(Boolean).join(" ");
}

/**
 * Admin only: every approved landlord and worker login (plus tenants, whose
 * threads the same table can carry), with a display name, for the inbox and
 * the "New message" picker.
 */
export async function listOfficeContacts(): Promise<OfficeContact[]> {
  const [accounts, landlords, staff] = await Promise.all([
    listUserAccounts(),
    listLandlords().catch(() => []),
    listStaff().catch(() => []),
  ]);
  const landlordById = new Map(landlords.map((l) => [l.id, l]));
  const staffById = new Map(staff.map((s) => [s.id, s]));

  const out: OfficeContact[] = [];
  for (const account of accounts) {
    if (account.account_status !== "approved") continue;
    const email = account.email?.trim() || null;
    if (account.role === "landlord") {
      const landlord = account.landlord_id != null ? landlordById.get(account.landlord_id) : undefined;
      const person = joinName(landlord?.first_name, landlord?.last_name);
      const company = landlord?.company_name?.trim() || null;
      out.push({
        userId: account.user_id,
        role: "landlord",
        name: person || company || email || "Landlord",
        detail: person && company ? company : email,
      });
    } else if (account.role === "maintenance") {
      const member = account.staff_id != null ? staffById.get(account.staff_id) : undefined;
      const person = joinName(member?.first_name, member?.last_name);
      out.push({
        userId: account.user_id,
        role: "maintenance",
        name: person || email || "Worker",
        detail: member?.job_title?.trim() || email,
      });
    } else if (account.role === "tenant") {
      out.push({ userId: account.user_id, role: "tenant", name: email || "Tenant", detail: null });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// ── Route helpers (/messages?thread=office[:<user_id>]) ──────────────

export const OFFICE_THREAD_PARAM = "office";

/** `office` for your own thread, `office:<user_id>` for an admin viewing one person's. */
export function officeThreadKey(threadUserId?: string | null): string {
  return threadUserId ? `${OFFICE_THREAD_PARAM}:${threadUserId}` : OFFICE_THREAD_PARAM;
}

/**
 * Read a `thread` query value. `{ own: true }` for `office`,
 * `{ own: false, userId }` for `office:<user_id>`, null for anything else.
 */
export function parseOfficeThreadKey(
  value: string | null | undefined,
): { own: true } | { own: false; userId: string } | null {
  if (!value) return null;
  if (value === OFFICE_THREAD_PARAM) return { own: true };
  if (value.startsWith(`${OFFICE_THREAD_PARAM}:`)) {
    const userId = value.slice(OFFICE_THREAD_PARAM.length + 1).trim();
    return userId ? { own: false, userId } : null;
  }
  return null;
}
