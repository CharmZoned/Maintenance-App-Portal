import type { OfficeMessage, OfficeThreadSummary, StaffMember, UserAccountRow } from "@/lib/data";
import { requestKey, type InboxConversation } from "@/lib/inbox";
import { displayNameFromEmail, roleLabel } from "@/lib/portal-nav";
import type { Landlord, MaintenanceComment, Tenant, WorkOrder } from "@/types";

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
  /** Direct office thread: whose thread it is (OfficeMessages.thread_user_id). */
  threadUserId?: string;
  /**
   * Admin inbox: who the conversation is with ("Tina Renter · Unit 1A"). When
   * set, rows lead with it and show `title` as the secondary line.
   */
  counterpart?: string;
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
  opts?: {
    /** When set, unknown `office:<uuid>` deep links are allowed only for this user or admins. */
    currentUserId?: string | null;
    isAdmin?: boolean;
  },
): MessagesDeepLink {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const thread = params.get("thread");
  if (thread) {
    if (threads.some((t) => t.id === thread)) {
      return { kind: "thread", threadId: thread };
    }
    // Soft-open an office thread the inbox has not listed yet (admin new DM, or own empty thread).
    const officeUser = parseOfficeThreadId(thread);
    if (officeUser) {
      const allowed =
        Boolean(opts?.isAdmin) ||
        (opts?.currentUserId != null && officeUser === opts.currentUserId);
      if (allowed) return { kind: "thread", threadId: thread };
      return { kind: "not-found", raw: thread };
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

// ── Admin inbox (who the office is talking to) ─────────────────────

const fullName = (first?: string | null, last?: string | null) =>
  [first?.trim(), last?.trim()].filter(Boolean).join(" ");

const joinParts = (parts: (string | null | undefined)[]) =>
  parts
    .map((p) => p?.trim())
    .filter(Boolean)
    .join(" · ");

function unitLabel(unit: string | null | undefined): string | null {
  const label = unit?.trim();
  if (!label) return null;
  return /^unit\b/i.test(label) ? label : `Unit ${label}`;
}

/** Lookups for naming the people the office talks to. Any list may be empty. */
export interface InboxDirectory {
  accounts: readonly UserAccountRow[];
  staff: readonly StaffMember[];
  tenants: readonly Tenant[];
  landlords: readonly Landlord[];
}

/**
 * "Tina Renter · Unit 1A", "Sam Fixit · Team", "Lena Owner · Landlord" — the
 * person behind a portal account, or null when they cannot be named.
 */
export function personLabelForUser(userId: string, people: InboxDirectory): string | null {
  const account = people.accounts.find((a) => a.user_id === userId);
  if (!account) return null;
  const email = account.email?.trim() || null;
  switch (account.role) {
    case "tenant": {
      const tenant = people.tenants.find((t) => t.id === account.tenant_id);
      const name = tenant ? fullName(tenant.first_name, tenant.last_name) : "";
      if (name) return joinParts([name, unitLabel(tenant?.active_unit_name) ?? "Tenant"]);
      return email ? `${email} · Tenant` : null;
    }
    case "maintenance": {
      const member = people.staff.find((m) => m.id === account.staff_id);
      const name = member ? fullName(member.first_name, member.last_name) : "";
      return `${name || email || "Team member"} · Team`;
    }
    case "landlord": {
      const landlord = people.landlords.find((l) => l.id === account.landlord_id);
      const name = landlord
        ? fullName(landlord.first_name, landlord.last_name) || landlord.company_name?.trim() || ""
        : "";
      return `${name || email || "Landlord"} · Landlord`;
    }
    default:
      return email;
  }
}

/**
 * Who the office is talking to on a request: the tenant who reported it (with
 * their unit), else the team member on it, else the place itself.
 */
export function requestCounterpart(wo: WorkOrder, people: Pick<InboxDirectory, "staff">): string {
  const unit = unitLabel(wo.unit_name);
  const tenant = fullName(wo.tenant_first_name, wo.tenant_last_name);
  if (tenant) return joinParts([tenant, unit]);
  const member = people.staff.find((m) => m.id === wo.assigned_staff_id);
  const memberName = member ? fullName(member.first_name, member.last_name) : "";
  if (memberName) return `${memberName} · Team`;
  return joinParts(["Office request", wo.property_name, unit]);
}

/**
 * Who wrote a request comment, as a short name for the preview line: "Office"
 * for any admin, else the person's first name, else their role.
 */
function requestAuthorShortName(
  last: InboxConversation["last"],
  wo: WorkOrder,
  people: InboxDirectory,
): string {
  switch (last.authorRole) {
    case "admin":
      return "Office";
    case "tenant": {
      const tenant = people.tenants.find((t) => t.id === last.authorTenantId);
      const first =
        tenant?.first_name?.trim() || (last.authorTenantId === wo.tenant_id ? wo.tenant_first_name?.trim() : "");
      return first || "Tenant";
    }
    case "maintenance": {
      const staffId =
        last.authorStaffId ?? people.accounts.find((a) => a.user_id === last.authorUserId)?.staff_id ?? null;
      return people.staff.find((m) => m.id === staffId)?.first_name?.trim() || "Team";
    }
    case "landlord":
      return "Landlord";
    default:
      return "Someone";
  }
}

/**
 * The admin's Messages list: every direct office thread plus every request,
 * newest activity first. Unread comes from the shared inbox rule
 * (lib/inbox.ts), so the header count equals the dashboard KPI and the rail
 * badge. A request with no messages yet is listed (the office can start the
 * conversation) but is never unread.
 */
export function adminInboxThreads(input: {
  workOrders: readonly WorkOrder[];
  inbox: readonly InboxConversation[];
  people: InboxDirectory;
}): MessageThread[] {
  const byKey = new Map(input.inbox.map((c) => [c.key, c]));
  const threads: MessageThread[] = [];

  for (const conversation of input.inbox) {
    if (conversation.kind !== "office") continue;
    threads.push({
      id: conversation.key,
      kind: "direct",
      threadUserId: conversation.threadUserId,
      counterpart: personLabelForUser(conversation.threadUserId, input.people) ?? "Portal user",
      title: "Direct message",
      // Their own words need no name; an office reply says so.
      preview:
        conversation.last.authorRole === "admin" ? `Office: ${conversation.last.body}` : conversation.last.body,
      updatedAt: conversation.last.at,
      unread: conversation.unread,
    });
  }

  for (const wo of input.workOrders) {
    const conversation = byKey.get(requestKey(wo.id));
    threads.push({
      id: requestKey(wo.id),
      kind: "request",
      requestId: wo.id,
      counterpart: requestCounterpart(wo, input.people),
      title: workOrderThreadTitle(wo),
      // Several people can write on a request, so the preview names the author.
      preview: conversation
        ? `${requestAuthorShortName(conversation.last, wo, input.people)}: ${conversation.last.body}`
        : workOrderPreview(wo),
      updatedAt: conversation ? conversation.last.at : wo.created_at,
      unread: conversation?.unread ?? false,
    });
  }

  // A request conversation whose request is not in the loaded list (e.g. an old
  // request past the list's row cap) still counts as unread in the shared
  // inbox, so it gets a row too: otherwise the header, rail badge and dashboard
  // KPI would disagree and the admin could not open it to clear the badge.
  const listed = new Set(input.workOrders.map((wo) => wo.id));
  for (const conversation of input.inbox) {
    if (conversation.kind !== "request" || listed.has(conversation.requestId)) continue;
    const role = conversation.last.authorRole;
    threads.push({
      id: conversation.key,
      kind: "request",
      requestId: conversation.requestId,
      counterpart: "Office request",
      title: `Request ${conversation.requestId}`,
      preview: role === "admin" ? `Office: ${conversation.last.body}` : conversation.last.body,
      updatedAt: conversation.last.at,
      unread: conversation.unread,
    });
  }

  return threads.sort(
    (a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime() || a.id.localeCompare(b.id),
  );
}

export function officeMessageSenderLabel(
  message: OfficeMessage,
  opts?: { currentUserId?: string | null; currentRole?: string | null },
): { label: string; outgoing: boolean } {
  // Prefer author_user_id so two admins in one thread are not both "You".
  // Fall back to role only when authorship was cleared (ON DELETE SET NULL).
  const byUser =
    opts?.currentUserId != null &&
    message.author_user_id != null &&
    message.author_user_id === opts.currentUserId;
  const byRoleFallback =
    message.author_user_id == null &&
    Boolean(opts?.currentRole && message.author_role === opts.currentRole);
  const outgoing = byUser || byRoleFallback;
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
