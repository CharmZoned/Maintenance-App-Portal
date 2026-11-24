import { cn } from "@/lib/utils";
import { NotificationBell } from "@/components/chrome/notification-bell";
import { AccountMenu } from "@/components/chrome/account-menu";
import { useShellChrome } from "@/components/chrome/shell-chrome-context";
import { AdminPageShell } from "@/components/chrome/admin-page-shell";

/**
 * Page toolbar + scroll pane (Figma Page header / PageShell).
 *
 * 56px band aligned with the nav brand row. Title stacks above meta; chrome
 * actions (primary CTA, bell, account) sit on the right. The band stays outside
 * the scroll container.
 *
 * Inside the admin workspace (the only shell that sets `onOpenNav`) the page
 * renders in the admin frame instead — `AdminPageShell`, the same header and
 * paper pane as the Dashboard, with the title, meta and actions as the page
 * introduction. There `width` is ignored: admin pages run full width.
 */
export function PageShell({
  title,
  meta,
  actions,
  width = "max-w-7xl",
  children,
}: {
  title: React.ReactNode;
  /** Context line under the title — `Needs attention · portfolio overview`. */
  meta?: React.ReactNode;
  /** Page-specific actions (primary CTA belongs last / use brand variant). */
  actions?: React.ReactNode;
  width?: string;
  children: React.ReactNode;
}) {
  const chrome = useShellChrome();

  if (chrome?.onOpenNav) {
    return (
      <AdminPageShell title={title} meta={meta} actions={actions}>
        <div className="min-w-0 space-y-6">{children}</div>
      </AdminPageShell>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-toolbar shrink-0 items-center gap-3 border-b border-border px-6">
        <div className="min-w-0 flex-1 leading-none">
          <h1 className="truncate text-[1.375rem] font-semibold tracking-[-0.01em]">{title}</h1>
          {meta ? (
            <div className="mt-0.5 truncate text-sm leading-snug text-muted-foreground">{meta}</div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {actions}
          {chrome ? (
            <>
              <NotificationBell unread={chrome.unread} onClick={chrome.onNotifications} />
              <AccountMenu
                email={chrome.email}
                role={chrome.role}
                displayName={chrome.displayName}
                onAccount={chrome.onAccount}
                onSignOut={chrome.onSignOut}
              />
            </>
          ) : null}
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-auto">
        <div className={cn("mx-auto w-full space-y-6 p-6", width)}>{children}</div>
      </div>
    </div>
  );
}
