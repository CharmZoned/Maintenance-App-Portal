import type { MaintenanceComment, WorkOrder } from "@/types";
import { STATUS_LABEL } from "@/lib/request-status";

/** Inbox thread — request-linked uses live WO comments; direct is UI-only stub. */
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
    return `${STATUS_LABEL.closed} · ${wo.resolution_notes.trim()}`;
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
