/**
 * Office threads — the direct chat between one non-admin portal user and the
 * office (every admin). Tables: OfficeMessages + OfficeThreadReads, both under
 * RLS (see supabase/migrations/20261118190000_worker_job_pool.sql).
 *
 *   - A non-admin has exactly one thread, keyed by their own user id.
 *   - Every admin reads and answers every thread.
 *   - Each reader keeps their own "read up to" time per thread.
 *
 * The admin inbox summary lives in data.ts (`listOfficeThreads`), shared with
 * the admin dashboard so both always agree on what is unread.
 */
import { supabase } from "./supabase";
import {
  listLandlords,
  listStaff,
  listTenants,
  listUserAccounts,
  type OfficeThreadSummary,
} from "./data";
import type { OfficePerson } from "./messages";
import type { AppRole } from "../types.supabase";

/** Database check on OfficeMessages.body (`char_length(body) <= 5000`). */
export const OFFICE_MESSAGE_MAX_LENGTH = 5000;

export interface OfficeMessage {
  id: number;
  created_at: string;
  /** Whose thread this is (the non-admin side of the conversation). */
  thread_user_id: string;
  author_user_id: string | null;
  author_role: AppRole;
  body: string;
}

/** The signed-in user as the office-thread policies see them. */
export interface OfficeViewer {
  userId: string;
  /** Role of an approved account; inserts must carry exactly this as `author_role`. */
  role: AppRole;
}

const MESSAGE_COLUMNS = "id, created_at, thread_user_id, author_user_id, author_role, body";

function throwSb(error: { message: string } | null): never {
  throw new Error(error?.message || "Supabase request failed");
}

/** Length the way Postgres `char_length` counts it (code points, not UTF-16 units). */
export function officeMessageLength(body: string): number {
  return Array.from(body).length;
}

/** Why a draft cannot be sent, or null when it can. */
export function officeMessageProblem(body: string): string | null {
  const text = body.trim();
  if (!text) return "Write a message first.";
  const length = officeMessageLength(text);
  if (length > OFFICE_MESSAGE_MAX_LENGTH) {
    const max = OFFICE_MESSAGE_MAX_LENGTH.toLocaleString("en-US");
    return `Messages can be up to ${max} characters. This one is ${length.toLocaleString("en-US")}.`;
  }
  return null;
}

/** Who is signed in, with the role the database will accept as `author_role`. */
export async function getOfficeViewer(): Promise<OfficeViewer> {
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();
  if (sessionError) throwSb(sessionError);
  const userId = session?.user.id;
  if (!userId) throw new Error("Sign in to use messages.");

  const { data, error } = await supabase
    .from("user_roles")
    .select("role, account_status")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throwSb(error);
  if (!data?.role || data.account_status !== "approved") {
    throw new Error("Only approved accounts can message the office.");
  }
  return { userId, role: data.role };
}

/**
 * One thread's messages, oldest first. Reads the latest `limit` messages.
 * RLS: an admin can read any thread; anyone else only their own (another
 * person's thread simply comes back empty).
 */
export async function listOfficeMessages(threadUserId: string, limit = 500): Promise<OfficeMessage[]> {
  const { data, error } = await supabase
    .from("OfficeMessages")
    .select(MESSAGE_COLUMNS)
    .eq("thread_user_id", threadUserId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);
  if (error) throwSb(error);
  return (data ?? []).slice().reverse();
}

/**
 * Write into a thread. An admin may write into any non-admin's thread; anyone
 * else only into their own (`threadUserId` must be their own user id). The
 * insert policy also requires `author_role` to be the caller's real role, so
 * it is read from the caller's account rather than taken from the UI.
 */
export async function sendOfficeMessage(
  threadUserId: string,
  body: string,
  viewer?: OfficeViewer,
): Promise<OfficeMessage> {
  const text = body.trim();
  const problem = officeMessageProblem(text);
  if (problem) throw new Error(problem);

  const author = viewer ?? (await getOfficeViewer());
  if (author.role !== "admin" && threadUserId !== author.userId) {
    throw new Error("You can only write in your own conversation with the office.");
  }

  const { data, error } = await supabase
    .from("OfficeMessages")
    .insert({
      thread_user_id: threadUserId,
      author_user_id: author.userId,
      author_role: author.role,
      body: text,
    })
    .select(MESSAGE_COLUMNS)
    .single();
  if (error) throwSb(error);
  return data;
}

/**
 * Record that the caller has read a thread (their own OfficeThreadReads row).
 *
 * `readThrough` is the `created_at` of the newest message the caller has seen;
 * pass it whenever it is known. Using the message's own (server) time instead
 * of this device's clock means a wrong clock can neither leave the thread
 * unread nor hide a message that arrives a moment later. Without it, the
 * newest message in the thread is looked up; an empty thread uses "now".
 */
export async function markOfficeThreadRead(threadUserId: string, readThrough?: string): Promise<string> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const userId = session?.user.id;
  if (!userId) throw new Error("Sign in to use messages.");

  let lastReadAt = readThrough;
  if (!lastReadAt) {
    const { data: latest, error: latestError } = await supabase
      .from("OfficeMessages")
      .select("created_at")
      .eq("thread_user_id", threadUserId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestError) throwSb(latestError);
    lastReadAt = latest?.created_at ?? new Date().toISOString();
  }

  const { data, error } = await supabase
    .from("OfficeThreadReads")
    .upsert(
      { user_id: userId, thread_user_id: threadUserId, last_read_at: lastReadAt },
      { onConflict: "user_id,thread_user_id" },
    )
    .select("last_read_at");
  if (error) throwSb(error);
  // RLS can refuse an update without raising: zero rows back means nothing was saved.
  if (!data || data.length === 0) throw new Error("Couldn’t mark this conversation as read.");
  return data[0].last_read_at;
}

/**
 * A non-admin's own thread with the office, summarised by its latest message;
 * null when nobody has written in it yet. `unread` is from that person's side:
 * a message from the office newer than their own read row.
 */
export async function getOwnOfficeThread(
  userId: string,
  messageLimit = 200,
): Promise<OfficeThreadSummary | null> {
  const [messages, read] = await Promise.all([
    supabase
      .from("OfficeMessages")
      .select(MESSAGE_COLUMNS)
      .eq("thread_user_id", userId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(messageLimit),
    supabase
      .from("OfficeThreadReads")
      .select("last_read_at")
      .eq("user_id", userId)
      .eq("thread_user_id", userId)
      .maybeSingle(),
  ]);
  if (messages.error) throwSb(messages.error);
  if (read.error) throwSb(read.error);

  const rows = messages.data ?? [];
  const latest = rows[0];
  if (!latest) return null;
  const readAt = read.data ? Date.parse(read.data.last_read_at) : null;
  return {
    thread_user_id: userId,
    last_message_at: latest.created_at,
    last_message_body: latest.body,
    last_author_role: latest.author_role,
    last_author_user_id: latest.author_user_id,
    unread: rows.some(
      (m) => m.author_user_id !== userId && (readAt == null || Date.parse(m.created_at) > readAt),
    ),
  };
}

function fullName(first: string | null | undefined, last: string | null | undefined): string {
  return [first?.trim(), last?.trim()].filter(Boolean).join(" ");
}

/**
 * Admin only: who is behind each portal account, keyed by user id, so a thread
 * can be titled "Sam Fixit · Team" or "Raj Patel · Tenant · 1B". Admin
 * accounts are left out (they have no thread of their own).
 *
 * The account list is required; the name lists are best effort — a person
 * whose record cannot be read is still listed, by email.
 */
export async function listOfficePeople(): Promise<Map<string, OfficePerson>> {
  const [accounts, tenants, landlords, staff] = await Promise.all([
    listUserAccounts(),
    listTenants().catch(() => []),
    listLandlords().catch(() => []),
    listStaff().catch(() => []),
  ]);
  const tenantById = new Map(tenants.map((t) => [t.id, t]));
  const landlordById = new Map(landlords.map((l) => [l.id, l]));
  const staffById = new Map(staff.map((s) => [s.id, s]));

  const people = new Map<string, OfficePerson>();
  for (const account of accounts) {
    if (!account.role || account.role === "admin") continue;
    const person: OfficePerson = { role: account.role, email: account.email };
    if (account.role === "tenant" && account.tenant_id != null) {
      const tenant = tenantById.get(account.tenant_id);
      person.name = fullName(tenant?.first_name, tenant?.last_name) || null;
      person.unit = tenant?.active_unit_name ?? null;
    } else if (account.role === "landlord" && account.landlord_id != null) {
      const landlord = landlordById.get(account.landlord_id);
      person.name =
        fullName(landlord?.first_name, landlord?.last_name) || landlord?.company_name?.trim() || null;
    } else if (account.role === "maintenance" && account.staff_id != null) {
      const member = staffById.get(account.staff_id);
      person.name = fullName(member?.first_name, member?.last_name) || null;
    }
    people.set(account.user_id, person);
  }
  return people;
}
