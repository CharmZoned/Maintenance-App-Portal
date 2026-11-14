import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "@/context";
import { NotificationsPanel } from "./notifications-panel";
import {
  notificationsFromWorkOrders,
  type NotificationItemData,
} from "@/lib/messages";

/** How long a successful fetch is considered fresh enough to skip reload-on-open. */
const FRESH_MS = 30_000;

/**
 * Loads stub notification rows from visible work orders and renders
 * desktop panel + mobile sheet when `open`.
 *
 * Mark-all-read is session-local: a set of read ids is re-applied after every
 * refresh so a rebuild from work orders does not undo it.
 */
export function NotificationsHost({
  open,
  onOpenChange,
  onUnreadChange,
  onNavigate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUnreadChange?: (unread: boolean) => void;
  onNavigate: (to: string) => void;
}) {
  const { listWorkOrders } = useApp();
  const [items, setItems] = useState<NotificationItemData[]>([]);
  const [readIds, setReadIds] = useState<Set<string>>(() => new Set());
  const readIdsRef = useRef(readIds);
  readIdsRef.current = readIds;
  const lastFetchedAt = useRef(0);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const wos = await listWorkOrders();
      const next = notificationsFromWorkOrders(wos).map((row) =>
        readIdsRef.current.has(row.id) ? { ...row, unread: false } : row,
      );
      setItems(next);
      lastFetchedAt.current = Date.now();
    } catch {
      setItems([]);
    } finally {
      inFlight.current = false;
    }
  }, [listWorkOrders]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    onUnreadChange?.(items.some((i) => i.unread));
  }, [items, onUnreadChange]);

  useEffect(() => {
    if (!open) return;
    const fresh = Date.now() - lastFetchedAt.current < FRESH_MS;
    if (fresh) return;
    void refresh();
  }, [open, refresh]);

  function markAllRead() {
    setReadIds((prev) => {
      const next = new Set(prev);
      for (const item of items) next.add(item.id);
      return next;
    });
    setItems((prev) => prev.map((i) => ({ ...i, unread: false })));
  }

  function selectItem(item: NotificationItemData) {
    setReadIds((prev) => new Set(prev).add(item.id));
    setItems((prev) =>
      prev.map((row) => (row.id === item.id ? { ...row, unread: false } : row)),
    );
    if (item.href) onNavigate(item.href);
  }

  return (
    <>
      <NotificationsPanel
        open={open}
        items={items}
        variant="panel"
        onClose={() => onOpenChange(false)}
        onMarkAllRead={markAllRead}
        onSelect={selectItem}
      />
      <NotificationsPanel
        open={open}
        items={items}
        variant="sheet"
        onClose={() => onOpenChange(false)}
        onMarkAllRead={markAllRead}
        onSelect={selectItem}
      />
    </>
  );
}
