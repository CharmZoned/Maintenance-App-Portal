import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@/context";
import { NotificationsPanel } from "./notifications-panel";
import { announceInboxChanged, INBOX_CHANGED_EVENT } from "@/lib/inbox";
import type { NotificationItemData } from "@/lib/messages";
import {
  currentNotificationViewer,
  loadNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationsSnapshot,
} from "@/lib/notifications";

/** How long a successful fetch is considered fresh enough to skip reload-on-open. */
const FRESH_MS = 30_000;

/**
 * The bell: loads the signed-in user's notifications (lib/notifications.ts)
 * and renders the desktop panel or the phone sheet when `open`.
 *
 * Read state is saved — opening a row or "Mark all read" writes it — so it
 * survives a reload. Message rows share the inbox's read state: reading a
 * conversation in Messages clears its bell row, and the other way round. The
 * bell reloads when the inbox announces a change, on open when stale, and
 * when the window regains focus.
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
  const { isLandlord, properties, setError } = useApp();
  const [snapshot, setSnapshot] = useState<NotificationsSnapshot>({ items: [], inbox: [] });
  const [loadFailed, setLoadFailed] = useState(false);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const lastFetchedAt = useRef(0);
  const inFlight = useRef(false);
  const again = useRef(false);
  const [variant, setVariant] = useState<"panel" | "sheet">(() =>
    typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches ? "panel" : "sheet",
  );

  const propertyNames = useMemo(() => new Map(properties.map((p) => [p.id, p.name])), [properties]);
  const propertyNamesRef = useRef(propertyNames);
  propertyNamesRef.current = propertyNames;

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    function sync() {
      setVariant(mq.matches ? "panel" : "sheet");
    }
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const refresh = useCallback(async () => {
    // One load at a time; a request made meanwhile runs once more after it.
    if (inFlight.current) {
      again.current = true;
      return;
    }
    inFlight.current = true;
    try {
      do {
        again.current = false;
        const viewer = await currentNotificationViewer();
        if (!viewer) return;
        const next = await loadNotifications(viewer, { propertyNames: propertyNamesRef.current });
        setSnapshot(next);
        setLoadFailed(false);
        lastFetchedAt.current = Date.now();
      } while (again.current);
    } catch {
      // Keep the last good rows. An empty failure must not look caught-up.
      setLoadFailed(true);
    } finally {
      inFlight.current = false;
    }
  }, []);

  // Load on mount, and again when owners' property names arrive (they name places in the copy).
  const namesKey = useMemo(() => [...propertyNames].map(([id, name]) => `${id}:${name}`).join("|"), [propertyNames]);
  useEffect(() => {
    void refresh();
  }, [refresh, namesKey]);

  useEffect(() => {
    const onChange = () => void refresh();
    const onFocus = () => {
      if (Date.now() - lastFetchedAt.current >= FRESH_MS) void refresh();
    };
    window.addEventListener(INBOX_CHANGED_EVENT, onChange);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener(INBOX_CHANGED_EVENT, onChange);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  const items = snapshot.items;
  useEffect(() => {
    onUnreadChange?.(items.some((i) => i.unread));
  }, [items, onUnreadChange]);

  useEffect(() => {
    if (!open) return;
    if (Date.now() - lastFetchedAt.current < FRESH_MS) return;
    void refresh();
  }, [open, refresh]);

  const showRead = (ids: Set<string> | null) =>
    setSnapshot((prev) => ({
      ...prev,
      items: prev.items.map((i) => (ids == null || ids.has(i.id) ? { ...i, unread: false } : i)),
    }));

  async function markAllRead() {
    const current = snapshotRef.current;
    showRead(null);
    try {
      const viewer = await currentNotificationViewer();
      if (!viewer) return;
      await markAllNotificationsRead(current, viewer);
    } catch (err) {
      setError(`Couldn’t mark notifications read: ${(err as Error).message}`);
    } finally {
      // Messages, the nav badge and this bell reload from what was saved.
      announceInboxChanged();
    }
  }

  function selectItem(item: NotificationItemData) {
    const current = snapshotRef.current;
    if (item.unread) {
      showRead(new Set([item.id]));
      void (async () => {
        try {
          const viewer = await currentNotificationViewer();
          if (viewer) await markNotificationRead(item, current, viewer);
        } catch {
          // The row comes back unread on the next load; nothing else to do.
        } finally {
          announceInboxChanged();
        }
      })();
    }
    if (item.href) onNavigate(item.href);
  }

  const handleClose = useCallback(() => onOpenChange(false), [onOpenChange]);

  return (
    <NotificationsPanel
      open={open}
      items={items}
      variant={variant}
      onClose={handleClose}
      onMarkAllRead={() => void markAllRead()}
      onSelect={selectItem}
      chrome={isLandlord ? "landlord" : "default"}
      loadFailed={loadFailed}
      onRetry={() => void refresh()}
    />
  );
}
