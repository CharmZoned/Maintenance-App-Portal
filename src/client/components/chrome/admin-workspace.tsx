import type { ReactNode } from "react";
import type { PortalNavItem } from "@/lib/portal-nav";

/**
 * STUB — replaced by the chrome agent. Props are the contract.
 *
 * Admin workspace frame (Figma "001 - Admin Pages"): the navy 224px rail on
 * desktop, the slide-in navigation drawer below `lg`, and the content column.
 * Provides `onOpenNav` to pages through ShellChrome so their headers can show
 * the menu button on tablet and phone.
 */
export function AdminWorkspace({
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
  children: ReactNode;
}) {
  return <div className="flex h-full min-h-0 w-full">{children}</div>;
}
