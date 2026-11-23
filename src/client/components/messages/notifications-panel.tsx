import { useEffect, useRef } from "react";
import { LandlordScopeHeading } from "@/components/landlord";
import { EmptyState, ErrorRetry } from "@/components/patterns";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
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
  /**
   * Landlord LN frames (`2037:507`–`2037:510`) vs the shared N5 flyout.
   * Other roles keep the N5 chrome.
   */
  chrome?: "default" | "landlord";
  /** Last refresh failed. Empty + failed must not read as "all caught up". */
  loadFailed?: boolean;
  onRetry?: () => void;
};

const DAY_ORDER = ["Today", "Yesterday", "Earlier"] as const;

function notificationDay(time: string): (typeof DAY_ORDER)[number] {
  if (time.startsWith("Today")) return "Today";
  if (time.startsWith("Yesterday")) return "Yesterday";
  return "Earlier";
}

function groupNotifications(items: NotificationItemData[]) {
  const buckets = new Map<string, NotificationItemData[]>();
  for (const item of items) {
    const day = notificationDay(item.time);
    const rows = buckets.get(day) ?? [];
    rows.push(item);
    buckets.set(day, rows);
  }
  return DAY_ORDER.flatMap((day) => {
    const rows = buckets.get(day);
    return rows ? [{ day, items: rows }] : [];
  });
}

function updatesLabel(day: string, count: number) {
  return `${day} · ${count} ${count === 1 ? "update" : "updates"}`;
}

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
  chrome = "default",
  loadFailed = false,
  onRetry,
}: Props) {
  const unread = items.some((i) => i.unread);
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const wasOpenRef = useRef(false);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const wasUnreadRef = useRef(unread);

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

  // Mark all as read unmounts its button. Move focus to Close so it does not
  // fall through to document.body while the dialog stays open.
  useEffect(() => {
    if (!open || chrome !== "landlord") {
      wasUnreadRef.current = unread;
      return;
    }
    const moveToClose = wasUnreadRef.current && !unread;
    wasUnreadRef.current = unread;
    if (!moveToClose) return;
    const frame = requestAnimationFrame(() => closeRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open, chrome, unread]);

  if (!open) return null;

  function selectItem(item: NotificationItemData) {
    onSelect?.(item);
    onClose();
  }

  if (chrome === "landlord") {
    const groups = groupNotifications(items);
    const showLoadError = loadFailed && items.length === 0;
    return (
      <>
        {variant === "panel" ? (
          <button
            type="button"
            className="fixed inset-0 z-40 bg-transparent"
            aria-label="Dismiss notifications"
            tabIndex={-1}
            onClick={onClose}
          />
        ) : null}
        <div
          ref={panelRef}
          className={cn(
            "lg-admin z-50 flex flex-col bg-popover text-foreground",
            variant === "sheet"
              ? "fixed inset-0"
              : "absolute inset-y-0 right-0 w-[480px] max-w-full border-l border-border",
          )}
          role="dialog"
          aria-modal="true"
          aria-label="Notifications"
        >
          <div className="relative shrink-0 px-6 pt-7">
            <LandlordScopeHeading label="Landlord portal" />
            <div className="mt-4 pr-12">
              <h2 className="lg-heading text-foreground">Notifications</h2>
            </div>
            <Button
              ref={closeRef}
              type="button"
              variant="ghost"
              size="touch-icon"
              onClick={onClose}
              aria-label="Close"
              className="absolute right-6 top-12 text-muted-foreground"
            >
              ×
            </Button>
            {unread ? (
              <Button
                type="button"
                variant="ghost"
                size="touch"
                onClick={onMarkAllRead}
                className="mt-[18px] w-[180px] border-2 border-ring text-muted-foreground"
              >
                Mark all as read
              </Button>
            ) : null}
          </div>
          {showLoadError ? (
            <div className="min-h-0 flex-1 px-6 pt-6">
              <ErrorRetry onRetry={onRetry} />
            </div>
          ) : items.length === 0 ? (
            <>
              <div className="flex min-h-0 flex-1 flex-col px-6">
                <div className="flex flex-[1.15] items-center justify-center px-6 py-10">
                  <p className="text-center text-sm leading-normal text-muted-foreground">
                    You're all caught up.
                  </p>
                </div>
                <p className="lg-body text-muted-foreground">New updates will appear here.</p>
                <div className="flex-[1.45]" />
              </div>
              <div className="shrink-0 px-6 pb-8">
                <Button
                  type="button"
                  variant="secondary"
                  size="touch"
                  onClick={onClose}
                  className="w-full border-2 border-ring"
                >
                  Close
                </Button>
              </div>
            </>
          ) : (
            <div className="min-h-0 flex-1 overflow-auto px-6 pb-6">
              {groups.map((group) => (
                <section key={group.day} className="mt-6">
                  <LandlordScopeHeading
                    label={updatesLabel(group.day, group.items.length)}
                    className="mb-[18px]"
                  />
                  <ul className="list-none">
                    {group.items.map((item) => (
                      <li key={item.id}>
                        <NotificationItem
                          variant="landlord"
                          item={item}
                          onClick={onSelect ? () => selectItem(item) : undefined}
                        />
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>
      </>
    );
  }

  const list = (
    <div className="min-h-0 flex-1 overflow-auto">
      {items.length === 0 ? (
        loadFailed ? (
          <ErrorRetry onRetry={onRetry} />
        ) : (
          <EmptyState message="You're all caught up. Alerts for request updates will land here." />
        )
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
