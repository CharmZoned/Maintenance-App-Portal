import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMediaQuery } from "@/hooks/use-media-query";
import type { PortalNavItem } from "@/lib/portal-nav";
import { AdminNavDrawer } from "./admin-nav-drawer";
import { AdminSidebar } from "./admin-sidebar";
import {
  ShellChromeProvider,
  useShellChrome,
  type ShellChromeValue,
} from "./shell-chrome-context";

/** Tailwind `lg` — the rail shows from here up; below it navigation is the drawer. */
const RAIL_QUERY = "(min-width: 1024px)";

/**
 * Mounted admin workspaces. While there is at least one, `<body>` carries the
 * `lg-admin` scope too, so surfaces Radix portals out of the page (dialogs,
 * selects, menus, popovers) get the same palette — and the same navy primary
 * button — as the page they were opened from.
 */
let mountedWorkspaces = 0;

function useAdminBodyScope() {
  useEffect(() => {
    mountedWorkspaces += 1;
    document.body.classList.add("lg-admin");
    return () => {
      mountedWorkspaces -= 1;
      if (mountedWorkspaces === 0) document.body.classList.remove("lg-admin");
    };
  }, []);
}

/**
 * Admin workspace frame (Figma "001 - Admin Pages"): the navy 224px rail on
 * desktop, the slide-in navigation drawer below `lg`, and the content column.
 * Provides `onOpenNav` to pages through ShellChrome so their headers can show
 * the menu button on tablet and phone.
 *
 * The rail and drawer carry the `lg-admin` palette themselves, and pages get it
 * from the admin page frame (`AdminPageShell`, which `PageShell` hands over to
 * when `onOpenNav` is set). `<body>` carries it as well while the workspace is
 * mounted, for portalled surfaces.
 */
export function AdminWorkspace({
  items,
  active,
  userName,
  userMeta,
  onNavigate,
  onAccount,
  onSignOut,
  defaultDrawerOpen = false,
  homeHref = "/dashboard",
  children,
}: {
  items: PortalNavItem[];
  /** Active nav item id. */
  active: string;
  /** "Ada Admin" */
  userName: string;
  /** "Admin · Landlord Gopher" */
  userMeta: string;
  onNavigate: (href: string) => void;
  onAccount?: () => void;
  onSignOut?: () => void;
  /** Preview/testing only: render the phone drawer open on mount. */
  defaultDrawerOpen?: boolean;
  /** Where the brand links to. */
  homeHref?: string;
  children: ReactNode;
}) {
  const chrome = useShellChrome();
  const railVisible = useMediaQuery(RAIL_QUERY);
  const [drawerOpen, setDrawerOpen] = useState(defaultDrawerOpen);
  useAdminBodyScope();

  // The drawer only exists below `lg`: growing the window past it closes it.
  useEffect(() => {
    if (railVisible) setDrawerOpen(false);
  }, [railVisible]);

  // The control that opened the drawer (a page header's menu button), so focus
  // can go back to it on close.
  const openerRef = useRef<HTMLElement | null>(null);
  const openNav = useCallback(() => {
    openerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setDrawerOpen(true);
  }, []);
  const restoreFocus = useCallback(() => {
    const opener = openerRef.current;
    openerRef.current = null;
    if (opener?.isConnected) opener.focus();
  }, []);
  const account = onAccount ?? chrome?.onAccount;
  const signOut = onSignOut ?? chrome?.onSignOut;
  const section = items.find((item) => item.id === active)?.label;

  const pageChrome = useMemo<ShellChromeValue>(
    () => ({
      ...(chrome ?? { email: "", role: "", onSignOut: signOut ?? (() => {}), onAccount: account }),
      onOpenNav: openNav,
      section,
    }),
    [chrome, openNav, account, signOut, section],
  );

  const navigateFromDrawer = useCallback(
    (href: string) => {
      setDrawerOpen(false);
      onNavigate(href);
    },
    [onNavigate],
  );

  const rail = {
    items,
    active,
    homeHref,
    userName,
    userMeta,
    userEmail: chrome?.email || undefined,
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <AdminSidebar
        {...rail}
        onNavigate={onNavigate}
        onAccount={account}
        onSignOut={signOut}
        className="hidden w-56 shrink-0 lg:flex"
      />
      <AdminNavDrawer
        {...rail}
        open={drawerOpen && !railVisible}
        onOpenChange={setDrawerOpen}
        onCloseFocus={restoreFocus}
        onNavigate={navigateFromDrawer}
        onAccount={
          account
            ? () => {
                setDrawerOpen(false);
                account();
              }
            : undefined
        }
        onSignOut={signOut}
      />
      <ShellChromeProvider value={pageChrome}>{children}</ShellChromeProvider>
    </div>
  );
}
