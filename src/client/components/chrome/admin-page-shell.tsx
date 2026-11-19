import type { ReactNode } from "react";
import { Menu } from "lucide-react";
import { PORTAL_BRAND } from "@/lib/portal-nav";
import { NotificationBell } from "./notification-bell";
import { useShellChrome } from "./shell-chrome-context";

/**
 * Admin page frame (Figma "Admin header" + content pane): the 72px header —
 * "Admin workspace / {section}" on desktop; the menu button and brand below
 * `lg`, where the rail is replaced by the drawer; notifications on the right —
 * over a scrolling pane on the paper background. Carries the `lg-admin` scope.
 *
 * The pane pads its content 24px (16px at the sides on phones); children
 * should not add page padding of their own.
 */
export function AdminPageShell({
  section,
  children,
}: {
  /** Current section for the breadcrumb, e.g. "Dashboard". */
  section: string;
  children: ReactNode;
}) {
  const chrome = useShellChrome();

  return (
    <div className="lg-admin flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      <header className="flex h-[4.5rem] shrink-0 items-center gap-3 bg-card px-4 lg:px-6">
        {chrome?.onOpenNav ? (
          <button
            type="button"
            onClick={chrome.onOpenNav}
            aria-label="Open navigation menu"
            aria-haspopup="dialog"
            className="flex size-11 shrink-0 items-center justify-center rounded-sm border border-border text-foreground transition-colors duration-150 hover:bg-muted lg:hidden"
          >
            <Menu aria-hidden size={20} strokeWidth={2} absoluteStrokeWidth />
          </button>
        ) : null}
        <p className="lg-body-medium min-w-0 flex-1 truncate text-foreground lg:hidden">
          {PORTAL_BRAND}
        </p>
        <p className="lg-body hidden min-w-0 flex-1 truncate text-foreground lg:block">
          Admin workspace / {section}
        </p>
        {chrome ? (
          <NotificationBell
            size="touch"
            unread={chrome.unread}
            onClick={chrome.onNotifications}
          />
        ) : null}
      </header>
      <div className="min-h-0 flex-1 overflow-auto px-4 py-6 sm:px-6">{children}</div>
    </div>
  );
}
