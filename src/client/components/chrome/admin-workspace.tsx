import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useMediaQuery } from "@/hooks/use-media-query";
import type { PortalNavItem } from "@/lib/portal-nav";
import { AdminNavDrawer } from "./admin-nav-drawer";
import { AdminSidebar } from "./admin-sidebar";
import {
  ShellChromeProvider,
  useShellChrome,
  type ShellChromeValue,
} from "./shell-chrome-context";

/** The admin palette scope class (see `.lg-admin` in styles.css). */
const ADMIN_SCOPE = "lg-admin";

/** Tailwind `lg` — the rail shows from here up; below it navigation is the drawer. */
const RAIL_QUERY = "(min-width: 1024px)";

/**
 * Admin workspace frame (Figma "001 - Admin Pages"): the navy 224px rail on
 * desktop, the slide-in navigation drawer below `lg`, and the content column.
 * Provides `onOpenNav` to pages through ShellChrome so their headers can show
 * the menu button on tablet and phone.
 *
 * While mounted it puts the `lg-admin` palette on the document root, so every
 * admin page — and everything portalled to `body` (dialogs, menus, popovers) —
 * shares the admin workspace colours. Other shells never mount this, so their
 * palette is untouched.
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

  // Layout effect, so the first admin frame is already in the admin palette.
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.add(ADMIN_SCOPE);
    return () => root.classList.remove(ADMIN_SCOPE);
  }, []);

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

  const pageChrome = useMemo<ShellChromeValue>(
    () => ({
      ...(chrome ?? { email: "", role: "", onSignOut: signOut ?? (() => {}), onAccount: account }),
      onOpenNav: openNav,
    }),
    [chrome, openNav, account, signOut],
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
