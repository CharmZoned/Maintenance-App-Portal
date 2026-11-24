import type { OfficeMessage, OfficeThreadSummary, StaffMember, UserAccountRow } from "@/lib/data";
import { hasRequestConversations, requestKey, type InboxConversation } from "@/lib/inbox";
import { displayNameFromEmail, roleLabel } from "@/lib/portal-nav";
import type { Landlord, MaintenanceComment, Tenant, WorkOrder } from "@/types";
import type { AppRole } from "@/types.supabase";
import { STATUS_LABEL } from "@/lib/request-status";

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
  /**
   * Nobody has written here yet: the row is a place to start a conversation
   * (the user's own office thread, an open request). It shows no time, sorts
   * after conversations with messages, and is never unread.
   */
  empty?: boolean;
  /** Stub flag for PR notes / UI banner. */
  stub?: boolean;
};

export type NotificationItemData = {
  id: string;
  sentence: string;
  /** Optional second line, e.g. the start of the message. */
  detail?: string;
  time: string;
  /** ISO time the event happened (for ordering); `time` is its label. */
  at?: string;
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
    return `${STATUS_LABEL.closed} · ${wo.resolution_notes.trim()}`;
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

const timeOf = (iso: string | null | undefined) => {
  const t = iso ? Date.parse(iso) : Number.NaN;
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
};

/**
 * Inbox order: conversations with messages first, newest message first; then
 * the empty ones (the user's own office thread before requests, newest
 * request first). Ties break on id so the order is stable.
 */
export function compareThreads(a: MessageThread, b: MessageThread): number {
  if (Boolean(a.empty) !== Boolean(b.empty)) return a.empty ? 1 : -1;
  if (a.empty && b.empty && a.kind !== b.kind) return a.kind === "direct" ? -1 : 1;
  return timeOf(b.updatedAt) - timeOf(a.updatedAt) || a.id.localeCompare(b.id);
}

/** Who wrote a message, as the reader of a non-admin inbox would say it. */
export function portalAuthorName(
  last: InboxConversation["last"],
  viewer: { role: AppRole; userId: string | null },
  wo?: WorkOrder,
): string {
  if (viewer.userId != null && last.authorUserId === viewer.userId) return "You";
  switch (last.authorRole) {
    case "admin":
      return "Landlord Gopher";
    case "maintenance":
      return viewer.role === "maintenance" ? "Another technician" : "Technician";
    case "tenant": {
      const first = wo && last.authorTenantId === wo.tenant_id ? wo.tenant_first_name?.trim() : "";
      return first || (viewer.role === "tenant" ? "Your household" : "Tenant");
    }
    case "landlord":
      return "Owner";
    default:
      return "Someone";
  }
}

const NO_MESSAGES_PREVIEW = "No messages yet";

/**
 * Request threads for work orders the caller can see. With `inbox`, each row
 * is dated and previewed by its last visible message and carries the saved
 * read state; a request nobody has written on is `empty` (no time, never
 * unread). Nothing is inferred from request dates or status.
 */
export function threadsFromWorkOrders(
  workOrders: readonly WorkOrder[],
  opts?: {
    inbox?: readonly InboxConversation[];
    viewer?: { role: AppRole; userId: string | null };
    /** Kept for callers that pass a clock; threads no longer depend on it. */
    now?: Date;
  },
): MessageThread[] {
  const byKey = new Map((opts?.inbox ?? []).map((c) => [c.key, c]));
  const viewer = opts?.viewer ?? { role: "admin" as AppRole, userId: null };
  return workOrders
    .map((wo): MessageThread => {
      const id = workOrderThreadId(wo.id);
      const conversation = byKey.get(id);
      if (!conversation) {
        return {
          id,
          kind: "request",
          title: workOrderThreadTitle(wo),
          preview: NO_MESSAGES_PREVIEW,
          updatedAt: wo.created_at,
          unread: false,
          empty: true,
          requestId: wo.id,
        };
      }
      return {
        id,
        kind: "request",
        title: workOrderThreadTitle(wo),
        preview: `${portalAuthorName(conversation.last, viewer, wo)}: ${conversation.last.body}`,
        updatedAt: conversation.last.at,
        unread: conversation.unread,
        requestId: wo.id,
      };
    })
    .sort(compareThreads);
}

/**
 * The Messages list for a tenant, landlord or technician: their own office
 * thread (always listed, so they can write to the office) and the request
 * threads they take part in, from the shared inbox rule (lib/inbox.ts) — so
 * the header count equals the nav badge, the bell and the landlord Home card.
 *
 * - Landlords get no request threads: request messaging with the owner is out
 *   of scope (SOW); their request links open the request page instead.
 * - A request with messages is always listed. One with none is listed only
 *   while it is open (somewhere to start talking); closed and silent ones are
 *   left out, so finished work does not crowd the inbox.
 * - A request conversation whose request is not in `workOrders` (past the
 *   list's cap) still gets a row, so every unread one can be opened.
 */
export function portalInboxThreads(input: {
  viewer: { role: AppRole; userId: string | null };
  workOrders: readonly WorkOrder[];
  inbox: readonly InboxConversation[];
  officeTitle?: string;
}): MessageThread[] {
  const { viewer } = input;
  const threads: MessageThread[] = [];

  const ownId = viewer.userId;
  if (ownId) {
    const own = input.inbox.find((c) => c.kind === "office" && c.threadUserId === ownId);
    threads.push(
      own
        ? {
            id: own.key,
            kind: "direct",
            threadUserId: ownId,
            title: input.officeTitle ?? OFFICE_TITLE,
            preview: `${portalAuthorName(own.last, viewer)}: ${own.last.body}`,
            updatedAt: own.last.at,
            unread: own.unread,
          }
        : {
            id: officeThreadId(ownId),
            kind: "direct",
            threadUserId: ownId,
            title: input.officeTitle ?? OFFICE_TITLE,
            preview: "No messages yet. Write to the office any time.",
            updatedAt: "",
            unread: false,
            empty: true,
          },
    );
  }

  if (hasRequestConversations(viewer.role)) {
    const listed = new Set<number>();
    for (const thread of threadsFromWorkOrders(input.workOrders, { inbox: input.inbox, viewer })) {
      const wo = input.workOrders.find((w) => w.id === thread.requestId);
      listed.add(thread.requestId!);
      if (thread.empty && wo?.status === "closed") continue;
      threads.push(thread);
    }
    for (const conversation of input.inbox) {
      if (conversation.kind !== "request" || listed.has(conversation.requestId)) continue;
      threads.push({
        id: conversation.key,
        kind: "request",
        requestId: conversation.requestId,
        title: `Request ${conversation.requestId}`,
        preview: `${portalAuthorName(conversation.last, viewer)}: ${conversation.last.body}`,
        updatedAt: conversation.last.at,
        unread: conversation.unread,
      });
    }
  }

  return threads.sort(compareThreads);
}

export const OFFICE_TITLE = "Landlord Gopher office";

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
      title: ensure.title ?? OFFICE_TITLE,
      preview: "No messages yet. Write to the office any time.",
      // No message, so no date: never the epoch.
      updatedAt: "",
      unread: false,
      empty: true,
      threadUserId: ensure.userId,
    });
  }

  return threads.sort(compareThreads);
}

/** Merge request + direct threads, newest first (empty threads last). */
export function mergeMessageThreads(...groups: MessageThread[][]): MessageThread[] {
  return groups.flat().sort(compareThreads);
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

/**
 * Link that opens the signed-in user's own office conversation with a draft
 * that already names what it is about, e.g. a property, unit or request.
 * Use it for every "message the office about this" action so staff never have
 * to ask which property a message concerns (audit UX-10, UX-16).
 *
 *   navigate(officeMessageHref({ about: ["Maple Court", "Unit 1A"] }))
 *   → /messages?office=me&about=Maple%20Court%20%C2%B7%20Unit%201A
 */
export function officeMessageHref(context?: { about?: Array<string | null | undefined> }): string {
  const about = (context?.about ?? [])
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(" · ");
  const params = new URLSearchParams({ office: "me" });
  if (about) params.set("about", about.slice(0, OFFICE_ABOUT_MAX));
  return `/messages?${params.toString()}`;
}

export const OFFICE_ABOUT_MAX = 160;

/** Prefilled composer text for an `officeMessageHref` link, or null when there is none. */
export function officeDraftFromSearch(search: string): string | null {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  if (params.get("office") !== "me") return null;
  const about = params.get("about")?.trim().slice(0, OFFICE_ABOUT_MAX);
  return about ? `About: ${about}\n\n` : null;
}

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
  // `?office=me` (officeMessageHref): the signed-in user's own office thread.
  // Admins have no thread of their own; for them it is a no-op.
  if (params.get("office") === "me" && !params.get("thread")) {
    if (!opts?.isAdmin && opts?.currentUserId) {
      return { kind: "thread", threadId: officeThreadId(opts.currentUserId) };
    }
    return { kind: "none" };
  }
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

/**
 * What a `/messages` URL asks a tenant, landlord or technician inbox to do.
 *   - open        — select `threadId`; `draft` is the office-message helper's
 *                   prefilled text (`officeMessageHref`), applied once
 *   - redirect    — landlord request links go to the request page (no request
 *                   threads for owners)
 *   - unavailable — the link names a conversation this user cannot open (not
 *                   theirs, not visible, or malformed): say so, never fake one
 *   - none        — no conversation named
 */
export type PortalMessagesLink =
  | { kind: "open"; threadId: string; draft: string | null }
  | { kind: "redirect"; to: string }
  | { kind: "unavailable" }
  | { kind: "none" };

export function resolvePortalMessagesLink(
  search: string,
  threads: readonly MessageThread[],
  viewer: { role: AppRole; userId: string | null },
): PortalMessagesLink {
  const link = resolveStaffMessagesDeepLink(search, threads as MessageThread[], {
    currentUserId: viewer.userId,
    isAdmin: viewer.role === "admin",
  });
  switch (link.kind) {
    case "thread": {
      const officeUser = parseOfficeThreadId(link.threadId);
      // Office threads: only the viewer's own (resolveStaffMessagesDeepLink checked it).
      if (officeUser) return { kind: "open", threadId: link.threadId, draft: officeDraftFromSearch(search) };
      if (!hasRequestConversations(viewer.role)) {
        const requestId = parseWorkOrderThreadId(link.threadId);
        return requestId != null ? { kind: "redirect", to: `/maintenance/${requestId}` } : { kind: "unavailable" };
      }
      return { kind: "open", threadId: link.threadId, draft: null };
    }
    case "request":
      if (!hasRequestConversations(viewer.role)) return { kind: "redirect", to: `/maintenance/${link.requestId}` };
      // Listed = the user can see the request. Anything else is not theirs to open.
      return threads.some((t) => t.id === link.threadId)
        ? { kind: "open", threadId: link.threadId, draft: null }
        : { kind: "unavailable" };
    case "not-found":
      return { kind: "unavailable" };
    default:
      return { kind: "none" };
  }
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
