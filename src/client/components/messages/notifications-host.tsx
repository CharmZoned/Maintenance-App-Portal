import { useCallback, useEffect, useState } from "react";
import { useApp } from "@/context";
import { NotificationsPanel } from "./notifications-panel";
import {
  notificationsFromWorkOrders,
  type NotificationItemData,
} from "@/lib/messages";

/**
 * Loads stub notification rows from visible work orders and renders
 * desktop panel + mobile sheet when `open`.
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
  const app = useApp();
  const [items, setItems] = useState<NotificationItemData[]>([]);

  const refresh = useCallback(async () => {
    try {
      const wos = await app.listWorkOrders();
      setItems(notificationsFromWorkOrders(wos));
    } catch {
      setItems([]);
    }
  }, [app]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    onUnreadChange?.(items.some((i) => i.unread));
  }, [items, onUnreadChange]);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  function markAllRead() {
    setItems((prev) => prev.map((i) => ({ ...i, unread: false })));
  }

  return (
    <>
      <NotificationsPanel
        open={open}
        items={items}
        variant="panel"
        onClose={() => onOpenChange(false)}
        onMarkAllRead={markAllRead}
        onSelect={(item) => {
          if (item.href) onNavigate(item.href);
        }}
      />
      <NotificationsPanel
        open={open}
        items={items}
        variant="sheet"
        onClose={() => onOpenChange(false)}
        onMarkAllRead={markAllRead}
        onSelect={(item) => {
          if (item.href) onNavigate(item.href);
        }}
      />
    </>
  );
}
