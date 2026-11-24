import type { OfficeMessage, OfficeThreadSummary } from "@/lib/data";
import { displayNameFromEmail, roleLabel } from "@/lib/portal-nav";
import type { MaintenanceComment, WorkOrder } from "@/types";

/** Inbox thread — request-linked uses WO comments; direct uses OfficeMessages. */
export type MessageThreadKind = "request" | "direct";

export type MessageThread = {
  id: string;
  kind: MessageThreadKind;
  title: string;
  preview: string;
  updatedAt: string;
  unread: boolean;
  /** Present when kind === "request". */
  requestId?: number;
  /** Present when kind === "direct" — auth user id for OfficeMessages.thread_user_id. */
  threadUserId?: string;
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

export function workOrderThreadId(requestId: number): string {
  return `wo:${requestId}`;
}

export function parseWorkOrderThreadId(id: string): number | null {
  if (!id.startsWith("wo:")) return null;
  const n = Number(id.slice(3));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function officeThreadId(threadUserId: string): string {
  return `office:${threadUserId}`;
}

export function parseOfficeThreadId(id: string): string | null {
  if (!id.startsWith("office:")) return null;
  const uid = id.slice("office:".length).trim();
  return uid || null;
}

/**
 * Build inbox threads from work orders the caller can already see.
 * Unread is a client stub (no MaintenanceThreadReads write yet): open/non-closed
 * WOs from the last 14 days count as unread until the user opens them in-session.
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
      const id = workOrderThreadId(wo.id);
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

/**
 * Map OfficeMessages summaries into inbox rows.
 * Pass `titles` (thread_user_id → label) for admin inbox names; non-admins usually
 * see a single own-thread titled via `ensureOwnThread`.
 */
export function threadsFromOfficeSummaries(
  summaries: OfficeThreadSummary[],
  opts?: {
    titles?: Map<string, string>;
    /** When set, guarantee an inbox row for this user even with no messages yet. */
    ensureOwnThread?: { userId: string; title?: string };
  },
): MessageThread[] {
  const titles = opts?.titles;
  const threads: MessageThread[] = summaries.map((s) => ({
    id: officeThreadId(s.thread_user_id),
    kind: "direct" as const,
    title: titles?.get(s.thread_user_id) ?? "Office conversation",
    preview: s.last_message_body,
    updatedAt: s.last_message_at,
    unread: s.unread,
    threadUserId: s.thread_user_id,
  }));

  const ensure = opts?.ensureOwnThread;
  if (ensure && !threads.some((t) => t.threadUserId === ensure.userId)) {
    threads.push({
      id: officeThreadId(ensure.userId),
      kind: "direct",
      title: ensure.title ?? "Landlord Gopher office",
      preview: "Message the office — no messages yet.",
      updatedAt: new Date(0).toISOString(),
      unread: false,
      threadUserId: ensure.userId,
    });
  }

  return threads.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}

/** Merge request + direct threads, newest first. */
export function mergeMessageThreads(...groups: MessageThread[][]): MessageThread[] {
  return groups
    .flat()
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

/**
 * Resolve `/messages` deep links used by Requests and the dashboard.
 * - `?thread=wo:123` / `?thread=office:<uuid>` — select that inbox id when present
 * - `?request=<pk>` — prefer matching request thread, else synthesize `wo:<pk>`
 */
export type MessagesDeepLink =
  | { kind: "thread"; threadId: string }
  | { kind: "request"; requestId: number; threadId: string; known: boolean }
  | { kind: "not-found"; raw: string }
  | { kind: "none" };

export function resolveStaffMessagesDeepLink(
  search: string,
  threads: MessageThread[],
): MessagesDeepLink {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const thread = params.get("thread");
  if (thread) {
    if (threads.some((t) => t.id === thread)) {
      return { kind: "thread", threadId: thread };
    }
    // Allow selecting an office thread the inbox has not listed yet (new DM).
    const officeUser = parseOfficeThreadId(thread);
    if (officeUser) {
      return { kind: "thread", threadId: thread };
    }
    const woId = parseWorkOrderThreadId(thread);
    if (woId != null) {
      return { kind: "request", requestId: woId, threadId: thread, known: false };
    }
    return { kind: "not-found", raw: thread };
  }
  const request = params.get("request");
  if (request != null && request.trim() !== "") {
    const raw = request.trim();
    const asNum = Number(raw.replace(/^wo[-_]?/i, ""));
    if (Number.isFinite(asNum) && asNum > 0) {
      const id = workOrderThreadId(asNum);
      const known = threads.some((t) => t.id === id);
      return { kind: "request", requestId: asNum, threadId: id, known };
    }
    return { kind: "not-found", raw };
  }
  return { kind: "none" };
}

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
        href: `/messages?thread=${workOrderThreadId(wo.id)}`,
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

export function officeMessageSenderLabel(
  message: OfficeMessage,
  opts?: { currentUserId?: string | null; currentRole?: string | null },
): { label: string; outgoing: boolean } {
  const byUser =
    opts?.currentUserId != null &&
    message.author_user_id != null &&
    message.author_user_id === opts.currentUserId;
  const byRole =
    !byUser &&
    Boolean(opts?.currentRole && message.author_role === opts.currentRole);
  const outgoing = byUser || byRole;
  const pretty =
    message.author_role === "admin"
      ? "Landlord Gopher office"
      : message.author_role === "maintenance"
        ? "Maintenance"
        : message.author_role === "tenant"
          ? "Tenant"
          : message.author_role === "landlord"
            ? "Landlord"
            : "Portal user";
  return {
    label: outgoing ? `You · ${pretty}` : pretty,
    outgoing,
  };
}

/** Title for an office thread participant from an admin account list row. */
export function officeThreadTitleFromAccount(account: {
  email: string | null;
  role: string | null;
}): string {
  const name = displayNameFromEmail(account.email);
  const role = account.role ? roleLabel(account.role) : null;
  return role ? `${name} · ${role}` : name;
}
