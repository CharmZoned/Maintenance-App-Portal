import type { ReactNode } from "react";
import { Menu } from "lucide-react";
import { PORTAL_BRAND } from "@/lib/portal-nav";
import { AccountMenu } from "./account-menu";
import { NotificationBell } from "./notification-bell";
import { useShellChrome } from "./shell-chrome-context";

/**
 * The one admin page frame (Figma "Admin header" + "Page introduction" +
 * content pane). Every page in the admin workspace renders inside it — the
 * Dashboard directly, every other page through `PageShell`, which hands over
 * to this frame when the admin workspace is around it.
 *
 * - Header, 72px white: the menu button and brand below `lg` (where the rail
 *   is replaced by the drawer), "Admin workspace / {section}" from `lg` up;
 *   the bell and the account menu on the right.
 * - Pane, on the paper background: when `title` is given, the page
 *   introduction — `<h1>` (24/32) over the meta line, page actions on the
 *   right — then the page content. Pages with an introduction of their own
 *   (the Dashboard's greeting) leave `title` out.
 *
 * Carries the `lg-admin` scope, so `Button` `default` / `brand` render in the
 * admin navy. The pane pads its content 24px (16px at the sides on phones)
 * and runs full width; children should not add page padding of their own.
 */
export function AdminPageShell({
  section,
  title,
  meta,
  actions,
  children,
}: {
  /** Breadcrumb section, e.g. "Dashboard". Defaults to the active rail item. */
  section?: string;
  /** Page title (`<h1>`). Leave out when the page renders its own introduction. */
  title?: ReactNode;
  /** Context line under the title — `4 need action`. */
  meta?: ReactNode;
  /** Page actions, right of the title; the primary action goes last. */
  actions?: ReactNode;
  children: ReactNode;
}) {
  const chrome = useShellChrome();
  const crumb = section ?? chrome?.section ?? (typeof title === "string" ? title : undefined);

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
          {crumb ? `Admin workspace / ${crumb}` : "Admin workspace"}
        </p>
        {chrome ? (
          <div className="flex shrink-0 items-center gap-2">
            <NotificationBell
              size="touch"
              unread={chrome.unread}
              onClick={chrome.onNotifications}
            />
            <AccountMenu
              email={chrome.email}
              role={chrome.role}
              displayName={chrome.displayName}
              onAccount={chrome.onAccount}
              onSignOut={chrome.onSignOut}
              className="h-11 pl-2.5 pr-3"
            />
          </div>
        ) : null}
      </header>
      {/* The pane publishes its geometry for content that bleeds to its edges
          or fills the rest of the screen (the Messages inbox):
          --page-gutter       side padding (16px on phones, 24px from `sm`);
          --page-content-top  roughly where page content starts below the
                              viewport top: header, padding and a one-line
                              introduction (two lines on phones). */}
      <div className="min-h-0 flex-1 overflow-auto px-[var(--page-gutter)] py-6 [--page-content-top:13.625rem] [--page-gutter:1rem] sm:[--page-content-top:10.125rem] sm:[--page-gutter:1.5rem]">
        {title !== undefined ? (
          <div className="flex min-w-0 flex-col gap-6">
            <AdminPageIntro title={title} meta={meta} actions={actions} />
            {children}
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

/**
 * Page introduction: the title as the page's `<h1>` over the meta line, with
 * the page actions on the same row from `sm` up (under it on phones). Same
 * type, rhythm and button size as the Dashboard greeting (dashboard-intro.tsx).
 */
function AdminPageIntro({
  title,
  meta,
  actions,
}: {
  title: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
      <div className="flex min-w-0 flex-1 flex-col">
        <h1 className="lg-heading break-words text-foreground">{title}</h1>
        {meta ? (
          <div className="lg-caption break-words text-muted-foreground">{meta}</div>
        ) : null}
      </div>
      {actions ? (
        // Buttons placed straight in the actions slot take the Dashboard's
        // 44px action size, whatever `size` the page gave them; grouped
        // controls (a period stepper) keep their own.
        <div className="flex shrink-0 flex-wrap items-center gap-3 [&>a]:h-11 [&>a]:px-4 [&>button]:h-11 [&>button]:px-4">
          {actions}
        </div>
      ) : null}
    </div>
  );
}
