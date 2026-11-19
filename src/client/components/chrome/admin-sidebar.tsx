import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AdminIcon, navProps } from "@/components/dashboard/dashboard-primitives";
import { cn } from "@/lib/utils";
import { PORTAL_BRAND, type PortalNavItem } from "@/lib/portal-nav";

/** Focus ring that stays visible on the navy rail (the global `--ring` is too dark there). */
const RAIL_FOCUS = "focus-visible:outline-sidebar-foreground";

export type AdminSidebarProps = {
  items: PortalNavItem[];
  /** Active nav item id. */
  active: string;
  /** Where the brand links to. */
  homeHref: string;
  /** "Ada Admin" */
  userName: string;
  /** "Admin · Landlord Gopher" */
  userMeta: string;
  /** Shown in the account menu under the name. */
  userEmail?: string;
  onNavigate: (href: string) => void;
  onAccount?: () => void;
  onSignOut?: () => void;
  className?: string;
  /** Width of the navigation column inside the rail (the drawer keeps it at 192px). */
  columnClassName?: string;
};

/**
 * Admin workspace rail (Figma "AD / Desktop sidebar", also the body of the
 * "Admin navigation drawer"): brand, the "Admin workspace" label, the section
 * links with their count badges, and the signed-in footer, which opens the
 * account menu (Account, Sign out). Carries the `lg-admin` scope itself.
 */
export function AdminSidebar({
  items,
  active,
  homeHref,
  userName,
  userMeta,
  userEmail,
  onNavigate,
  onAccount,
  onSignOut,
  className,
  columnClassName,
}: AdminSidebarProps) {
  return (
    <aside
      className={cn("lg-admin flex flex-col overflow-y-auto bg-sidebar px-4 py-6", className)}
    >
      {/* `.lg-admin` sets the page text colour on its own element, so the rail's
          white text is set one level down. */}
      <div
        className={cn(
          "flex min-h-full w-full flex-col justify-between gap-6 text-sidebar-foreground",
          columnClassName,
        )}
      >
        <div className="flex flex-col gap-6">
          <a
            {...navProps(homeHref, onNavigate)}
            className={cn("lg-section self-start rounded-sm text-sidebar-foreground", RAIL_FOCUS)}
          >
            {PORTAL_BRAND}
          </a>
          <p className="lg-label uppercase">Admin workspace</p>
          <nav aria-label="Primary">
            <ul className="flex flex-col gap-1">
              {items.map((item) => (
                <li key={item.id}>
                  <AdminNavLink item={item} active={item.id === active} onNavigate={onNavigate} />
                </li>
              ))}
            </ul>
          </nav>
        </div>
        <SignedInFooter
          userName={userName}
          userMeta={userMeta}
          userEmail={userEmail}
          onAccount={onAccount}
          onSignOut={onSignOut}
        />
      </div>
    </aside>
  );
}

/**
 * Figma "AD / Navigation item": a 48px row with a 20px icon, the section name
 * and an optional count. The count is announced with what it measures
 * ("Maintenance, 3 open"); the visible badge is hidden from assistive tech.
 */
function AdminNavLink({
  item,
  active,
  onNavigate,
}: {
  item: PortalNavItem;
  active: boolean;
  onNavigate: (href: string) => void;
}) {
  const showCount = typeof item.count === "number" && item.count > 0;
  return (
    <a
      {...navProps(item.href, onNavigate)}
      aria-current={active ? "page" : undefined}
      className={cn(
        "lg-body-medium flex min-h-12 items-center gap-3 rounded-sm px-3 py-1 text-sidebar-foreground transition-colors duration-150",
        RAIL_FOCUS,
        active ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/60",
      )}
    >
      {item.icon ? <AdminIcon name={item.icon} /> : <span className="size-5 shrink-0" aria-hidden />}
      <span data-nav-label className="min-w-0 flex-1 [overflow-wrap:anywhere]">
        {item.label}
      </span>
      {showCount ? (
        <>
          <span
            aria-hidden
            className={cn(
              "lg-label data min-w-6 shrink-0 rounded-sm px-1 py-1 text-center",
              // On the active row the row itself is the accent colour.
              active ? "bg-sidebar" : "bg-sidebar-accent",
            )}
          >
            {item.count}
          </span>
          <span className="sr-only">
            , {item.count}
            {item.countLabel ? ` ${item.countLabel}` : ""}
          </span>
        </>
      ) : null}
    </a>
  );
}

/**
 * Figma "Signed in": name over "Admin · Landlord Gopher". The dashboard header
 * has only the bell, so this is also the account menu trigger.
 */
function SignedInFooter({
  userName,
  userMeta,
  userEmail,
  onAccount,
  onSignOut,
}: {
  userName: string;
  userMeta: string;
  userEmail?: string;
  onAccount?: () => void;
  onSignOut?: () => void;
}) {
  const identity = (
    <>
      <span className="lg-body-medium block [overflow-wrap:anywhere]">{userName}</span>
      <span className="lg-caption block [overflow-wrap:anywhere]">{userMeta}</span>
    </>
  );

  if (!onAccount && !onSignOut) {
    return <p className="flex flex-col gap-1">{identity}</p>;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Signed in as ${userName}, ${userMeta}. Account options`}
          // The negative margin keeps the text on the rail's 16px edge while the
          // hover surface and the focus ring get room around it.
          className={cn(
            "-mx-3 -my-2 flex min-h-11 flex-col gap-1 rounded-sm px-3 py-2 text-left text-sidebar-foreground transition-colors duration-150 hover:bg-sidebar-accent/60 data-[state=open]:bg-sidebar-accent",
            RAIL_FOCUS,
          )}
        >
          {identity}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        className="lg-admin w-[var(--radix-dropdown-menu-trigger-width)] min-w-[13.5rem] p-0 py-2"
      >
        <div className="flex flex-col gap-0.5 px-3 py-2">
          <div className="lg-body-medium text-foreground">{userName}</div>
          <div className="lg-caption text-muted-foreground">{userMeta}</div>
          {userEmail ? (
            <div className="lg-caption truncate text-muted-foreground">{userEmail}</div>
          ) : null}
        </div>
        <DropdownMenuSeparator className="my-0 bg-border" />
        {onAccount ? (
          <DropdownMenuItem
            className="min-h-11 rounded-none px-3 text-sm"
            onSelect={() => onAccount()}
          >
            Account
          </DropdownMenuItem>
        ) : null}
        {onSignOut ? (
          <DropdownMenuItem
            className="min-h-11 rounded-none px-3 text-sm text-destructive focus:text-destructive"
            onSelect={() => onSignOut()}
          >
            Sign out
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
