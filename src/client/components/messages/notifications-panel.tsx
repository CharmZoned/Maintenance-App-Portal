import { useEffect, useRef } from "react";
import { EmptyState } from "@/components/patterns";
import { NotificationItem } from "./notification-item";
import type { NotificationItemData } from "@/lib/messages";

type Props = {
  open: boolean;
  items: NotificationItemData[];
  onClose: () => void;
  onMarkAllRead: () => void;
  onSelect?: (item: NotificationItemData) => void;
  /** Desktop panel vs mobile full-sheet (Figma N5 Panel / Sheet). */
  variant?: "panel" | "sheet";
};

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Bell flyout — Figma Admin N5 Panel and Tenant N5 Sheet.
 * Notifications are stubbed until R6 / message-center API exists.
 */
export function NotificationsPanel({
  open,
  items,
  onClose,
  onMarkAllRead,
  onSelect,
  variant = "panel",
}: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const wasOpenRef = useRef(false);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  // Focus Close only on false→true; restore focus on close. Escape via stable ref.
  useEffect(() => {
    const justOpened = open && !wasOpenRef.current;
    const justClosed = !open && wasOpenRef.current;
    wasOpenRef.current = open;

    if (justOpened) {
      previouslyFocusedRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      // Defer so the dialog node is mounted.
      requestAnimationFrame(() => closeRef.current?.focus());
    }
    if (justClosed) {
      previouslyFocusedRef.current?.focus?.();
      previouslyFocusedRef.current = null;
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const root = panelRef.current;
      if (!root) return;
      const nodes = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent != null || el === document.activeElement,
      );
      if (nodes.length === 0) return;
      const first = nodes[0]!;
      const last = nodes[nodes.length - 1]!;
      if (e.shiftKey) {
        if (document.activeElement === first || !root.contains(document.activeElement)) {
          e.preventDefault();
          last.focus();
        }
      } else if (document.activeElement === last || !root.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;

  const unread = items.some((i) => i.unread);

  function selectItem(item: NotificationItemData) {
    onSelect?.(item);
    onClose();
  }

  const list = (
    <div className="min-h-0 flex-1 overflow-auto">
      {items.length === 0 ? (
        <EmptyState message="You're all caught up. Alerts for request updates will land here." />
      ) : (
        items.map((item) => (
          <NotificationItem
            key={item.id}
            item={item}
            onClick={onSelect ? () => selectItem(item) : undefined}
          />
        ))
      )}
    </div>
  );

  const stubNote = items.some((i) => i.stub) ? (
    <p className="shrink-0 border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
      Stub · live push/email notifications are not wired yet.
    </p>
  ) : null;

  if (variant === "sheet") {
    return (
      <div
        ref={panelRef}
        className="fixed inset-0 z-50 flex flex-col bg-background"
        role="dialog"
        aria-modal="true"
        aria-label="Notifications"
      >
        <div className="flex justify-center pt-2.5 pb-1">
          <span className="h-1 w-9 rounded-full bg-border" aria-hidden />
        </div>
        <div className="flex h-14 shrink-0 items-center justify-between px-4">
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="text-sm font-medium text-foreground hover:underline"
          >
            Close
          </button>
          <h2 className="text-base font-semibold">Notifications</h2>
          {unread ? (
            <button
              type="button"
              onClick={onMarkAllRead}
              className="text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              Mark all read
            </button>
          ) : (
            <span className="w-20" />
          )}
        </div>
        {list}
        {stubNote}
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-40 bg-transparent"
        aria-label="Dismiss notifications"
        tabIndex={-1}
        onClick={onClose}
      />
      <div
        ref={panelRef}
        className="absolute right-6 top-14 z-50 flex h-[560px] w-[360px] flex-col overflow-hidden rounded-md border border-border bg-card shadow-raised"
        role="dialog"
        aria-modal="true"
        aria-label="Notifications"
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
          <h2 className="text-[15px] font-medium">Notifications</h2>
          <div className="flex items-center gap-3">
            {unread ? (
              <button
                type="button"
                onClick={onMarkAllRead}
                className="text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                Mark all read
              </button>
            ) : null}
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              className="text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              Close
            </button>
          </div>
        </div>
        {list}
        {stubNote}
      </div>
    </>
  );
}
