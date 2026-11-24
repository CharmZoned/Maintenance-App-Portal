import type { MaintenanceComment, WorkOrder } from "@/types";
import type { AppRole } from "../types.supabase";

/**
 * Inbox thread — request-linked uses live WO comments; office is the direct
 * thread between one portal user and the office (OfficeMessages); direct is a
 * UI-only stub.
 */
export type MessageThreadKind = "request" | "direct" | "office";

export type MessageThread = {
  id: string;
  kind: MessageThreadKind;
  title: string;
  preview: string;
  updatedAt: string;
  unread: boolean;
  /** Present when kind === "request". */
  requestId?: number;
  /** Present when kind === "office": the portal user whose thread with the office this is. */
  officeUserId?: string;
  /** Stub flag for PR notes / UI banner. */
  stub?: boolean;
};

export type NotificationItemData = {
  id: string;
  sentence: string;
  time: string;
  unread: boolean;
  /** Deep-link when available. */
  href?: string;
  stub?: boolean;
};

export function formatMessageTime(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate();

  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (sameDay) return `Today ${time}`;
  if (isYesterday) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

export function workOrderThreadTitle(wo: WorkOrder): string {
  const num = wo.request_number?.trim() || `WO-${wo.id}`;
  return `${num} · ${wo.title}`;
}

export function workOrderPreview(wo: WorkOrder): string {
  if (wo.status === "closed" && wo.resolution_notes?.trim()) {
    return `Closed · ${wo.resolution_notes.trim()}`;
  }
  if (wo.description?.trim()) return wo.description.trim();
  return wo.title;
}

/**
 * Build inbox threads from work orders the caller can already see.
 * Unread is a client stub (no read-state API): open/non-closed WOs from the
 * last 14 days count as unread until the user opens them in-session.
 */
export function threadsFromWorkOrders(
  workOrders: WorkOrder[],
  opts?: { openedIds?: Set<string>; now?: Date },
): MessageThread[] {
  const now = opts?.now ?? new Date();
  const opened = opts?.openedIds ?? new Set<string>();
  const twoWeeksMs = 14 * 24 * 60 * 60 * 1000;

  return workOrders
    .map((wo) => {
      const id = `wo:${wo.id}`;
      const updated = wo.scheduled_at || wo.created_at;
      const age = now.getTime() - new Date(updated).getTime();
      const unreadStub =
        !opened.has(id) && wo.status !== "closed" && age >= 0 && age < twoWeeksMs;
      return {
        id,
        kind: "request" as const,
        title: workOrderThreadTitle(wo),
        preview: workOrderPreview(wo),
        updatedAt: updated,
        unread: unreadStub,
        requestId: wo.id,
      };
    })
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

/** Direct / property threads — no message-center API yet. */
export const STUB_DIRECT_THREADS: MessageThread[] = [];

export function notificationsFromWorkOrders(
  workOrders: WorkOrder[],
  opts?: { now?: Date },
): NotificationItemData[] {
  const now = opts?.now ?? new Date();
  return workOrders
    .filter((wo) => wo.status !== "closed")
    .slice(0, 8)
    .map((wo) => {
      const who =
        wo.tenant_first_name || wo.tenant_last_name
          ? `${wo.tenant_first_name ?? ""} ${wo.tenant_last_name ?? ""}`.trim()
          : "A tenant";
      const sentence =
        wo.status === "in_progress"
          ? `Work started on ${workOrderThreadTitle(wo)}.`
          : wo.status === "scheduled"
            ? `${workOrderThreadTitle(wo)} was scheduled.`
            : `${who} has an open request · ${wo.title}.`;
      return {
        id: `notif-wo-${wo.id}`,
        sentence,
        time: formatMessageTime(wo.created_at, now),
        unread: true,
        href: `/messages?thread=wo:${wo.id}`,
        stub: true,
      };
    });
}

export function commentSenderLabel(
  comment: MaintenanceComment,
  opts?: { currentRole?: string | null },
): { label: string; outgoing: boolean } {
  const role = comment.author_role ?? "staff";
  const outgoing = Boolean(opts?.currentRole && role === opts.currentRole);
  const pretty =
    role === "admin"
      ? "Admin"
      : role === "maintenance"
        ? "Maintenance"
        : role === "tenant"
          ? "Tenant"
          : role === "landlord"
            ? "Landlord"
            : "Staff";
  return {
    label: outgoing ? `You · ${pretty}` : pretty,
    outgoing,
  };
}

// ── Office threads (OfficeMessages) ─────────────────────────────────

const OFFICE_THREAD_PREFIX = "office:";

/** Inbox id of the office thread that belongs to `userId` — `office:<userId>`. */
export function officeThreadId(userId: string): string {
  return `${OFFICE_THREAD_PREFIX}${userId}`;
}

/** The user id inside an `office:<userId>` thread id; null for any other id. */
export function officeUserIdFromThreadId(id: string | null | undefined): string | null {
  if (!id || !id.startsWith(OFFICE_THREAD_PREFIX)) return null;
  return id.slice(OFFICE_THREAD_PREFIX.length).trim() || null;
}

/** Deep link that opens one person's office thread: `/messages?thread=office:<userId>`. */
export function officeThreadHref(userId: string): string {
  return `/messages?thread=${officeThreadId(userId)}`;
}

/** Who a thread belongs to, as far as the viewer is allowed to know. */
export type OfficePerson = {
  name?: string | null;
  role?: AppRole | null;
  /** A tenant's current unit label, when known. */
  unit?: string | null;
  email?: string | null;
};

/** The office calls its maintenance workers "Team" (same word as the dashboard). */
export function officeRoleTitle(role: AppRole | null | undefined): string | null {
  switch (role) {
    case "admin":
      return "Admin";
    case "maintenance":
      return "Team";
    case "tenant":
      return "Tenant";
    case "landlord":
      return "Landlord";
    default:
      return null;
  }
}

/** "Sam Fixit · Team", "Raj Patel · Tenant · 1B"; falls back to the email, then "Portal user". */
export function officePersonLabel(person: OfficePerson | null | undefined): string {
  const name = person?.name?.trim() || person?.email?.trim() || "Portal user";
  const unit = person?.role === "tenant" ? person.unit?.trim() : null;
  return [name, officeRoleTitle(person?.role), unit].filter(Boolean).join(" · ");
}

/** The fields of a thread summary the inbox needs (see `OfficeThreadSummary` in data.ts). */
export type OfficeThreadSummaryLike = {
  thread_user_id: string;
  last_message_at: string;
  last_message_body: string;
  last_author_role: AppRole;
  last_author_user_id: string | null;
  unread: boolean;
};

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function officePreview(
  summary: OfficeThreadSummaryLike,
  viewer: { userId: string | null; isAdmin: boolean },
): string {
  const body = oneLine(summary.last_message_body);
  if (viewer.userId && summary.last_author_user_id === viewer.userId) return `You: ${body}`;
  // Another admin answered: the person on the other side only ever sees "the office".
  if (viewer.isAdmin && summary.last_author_role === "admin") return `Office: ${body}`;
  return body;
}

/**
 * Admin inbox rows: one per person who has a thread with the office.
 * `unread` comes straight from the summary (the admin's own read row).
 */
export function threadsFromOfficeSummaries(
  summaries: OfficeThreadSummaryLike[],
  opts?: { people?: ReadonlyMap<string, OfficePerson>; viewerUserId?: string | null },
): MessageThread[] {
  const viewer = { userId: opts?.viewerUserId ?? null, isAdmin: true };
  return summaries.map((summary) => ({
    id: officeThreadId(summary.thread_user_id),
    kind: "office" as const,
    title: officePersonLabel(opts?.people?.get(summary.thread_user_id)),
    preview: officePreview(summary, viewer),
    updatedAt: summary.last_message_at,
    unread: summary.unread,
    officeUserId: summary.thread_user_id,
  }));
}

/** Shown in place of a preview for an office thread nobody has written in yet. */
export const OFFICE_THREAD_EMPTY_PREVIEW = "No messages yet.";

/** An office thread with no messages yet (admin opens a person's thread by link). */
export function emptyOfficeThread(userId: string, person?: OfficePerson | null): MessageThread {
  return {
    id: officeThreadId(userId),
    kind: "office",
    title: officePersonLabel(person),
    preview: OFFICE_THREAD_EMPTY_PREVIEW,
    updatedAt: "",
    unread: false,
    officeUserId: userId,
  };
}

/**
 * A non-admin's single "Office" thread. It always exists (so the person can
 * write first); `summary` is null until someone has written in it.
 */
export function ownOfficeThread(
  userId: string,
  summary: OfficeThreadSummaryLike | null | undefined,
): MessageThread {
  return {
    id: officeThreadId(userId),
    kind: "office",
    title: "Office",
    preview: summary
      ? officePreview(summary, { userId, isAdmin: false })
      : "Write to the office. Replies show up here.",
    updatedAt: summary?.last_message_at ?? "",
    unread: summary?.unread ?? false,
    officeUserId: userId,
  };
}

function threadTime(thread: MessageThread): number {
  const ms = Date.parse(thread.updatedAt);
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}

/**
 * One inbox list, newest activity first. Threads in `pinned` stay on top in
 * the order given (a worker's own Office thread; a thread with no messages
 * yet that was opened by link).
 */
export function sortThreads(threads: MessageThread[], pinned: MessageThread[] = []): MessageThread[] {
  const pinnedIds = new Set(pinned.map((t) => t.id));
  const rest = threads
    .filter((t) => !pinnedIds.has(t.id))
    .sort((a, b) => threadTime(b) - threadTime(a) || a.id.localeCompare(b.id));
  return [...pinned, ...rest];
}

/** Who wrote an office message, from the viewer's side of the conversation. */
export function officeSenderLabel(
  message: { author_user_id: string | null; author_role: AppRole },
  opts: {
    viewerUserId: string | null;
    viewerIsAdmin: boolean;
    /** Admin view: the label of the person the thread belongs to. */
    threadPersonLabel?: string | null;
  },
): { label: string; outgoing: boolean } {
  const mine = Boolean(opts.viewerUserId && message.author_user_id === opts.viewerUserId);
  const fromOffice = message.author_role === "admin";
  if (opts.viewerIsAdmin) {
    // The office speaks with one voice: every admin's message sits on the office side.
    if (fromOffice) return { label: mine ? "You · Office" : "Office", outgoing: true };
    return { label: opts.threadPersonLabel?.trim() || "Portal user", outgoing: false };
  }
  if (fromOffice) return { label: "Office", outgoing: false };
  return { label: "You", outgoing: true };
}
