import { Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { NotificationBell } from "@/components/chrome/notification-bell";
import { AccountMenu } from "@/components/chrome/account-menu";
import { useShellChrome } from "@/components/chrome/shell-chrome-context";

/**
 * Page toolbar + scroll pane (Figma Page header / PageShell).
 *
 * 56px band aligned with the nav brand row. Title stacks above meta; chrome
 * actions (primary CTA, bell, account) sit on the right. The band stays outside
 * the scroll container.
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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-toolbar shrink-0 items-center gap-3 border-b border-border px-6">
        {chrome?.onOpenNav ? (
          // Admin workspace only: below `lg` the rail is a drawer, opened from here.
          <button
            type="button"
            onClick={chrome.onOpenNav}
            aria-label="Open navigation menu"
            aria-haspopup="dialog"
            className="-ml-2 flex size-9 shrink-0 items-center justify-center rounded-sm text-foreground hover:bg-muted lg:hidden"
          >
            <Menu className="size-4" strokeWidth={1.75} aria-hidden />
          </button>
        ) : null}
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
