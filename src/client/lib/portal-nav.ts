import type { PortalAudience } from "./safe-redirect";

/**
 * Icon for a nav row, by name (the admin rail draws them with Lucide; the names
 * are a subset of the dashboard's `AdminIconName`).
 */
export type PortalNavIcon =
  | "home"
  | "wrench"
  | "building"
  | "dollar"
  | "user"
  | "message"
  | "file"
  | "globe"
  | "settings";

/** One primary-nav row for the Landlord Gopher chrome. */
export type PortalNavItem = {
  id: string;
  label: string;
  href: string;
  /** Live count badge. Omit or 0 = hidden. Never a placeholder number. */
  count?: number;
  /** What the count measures, read after the number: "open" → "Maintenance, 3 open". */
  countLabel?: string;
  /** Leading icon — used by the admin workspace rail and drawer. */
  icon?: PortalNavIcon;
};

export const PORTAL_BRAND = "Landlord Gopher";

/**
 * Role shells. Tenant / landlord / maintenance follow Figma `01 Chrome`
 * (Phase 0); staff follows the admin workspace rail (Figma "001 - Admin Pages").
 * Leases, calendar, landlords, tenants, users and applications stay reachable
 * by direct URL for staff — they are not listed here.
 *
 * `isAdmin` only matters for the staff shell: destinations that are restricted
 * to admins (Settings) are left out when it is false. It defaults to true.
 */
export function navItemsForAudience(
  audience: PortalAudience,
  opts?: { isAdmin?: boolean },
): PortalNavItem[] {
  switch (audience) {
    case "tenant":
      return [
        { id: "home", label: "Home", href: "/home" },
        { id: "maintenance", label: "Requests", href: "/maintenance" },
        { id: "messages", label: "Messages", href: "/messages" },
        { id: "documents", label: "Documents", href: "/documents" },
      ];
    case "landlord":
      return [
        { id: "home", label: "Home", href: "/home" },
        { id: "properties", label: "Properties", href: "/properties" },
        { id: "maintenance", label: "Maintenance", href: "/maintenance" },
        { id: "messages", label: "Messages", href: "/messages" },
        { id: "documents", label: "Documents", href: "/documents" },
      ];
    case "maintenance":
      return [
        { id: "maintenance", label: "My jobs", href: "/maintenance" },
        // Their visits by day (UX-17). Same /calendar page, work items only.
        { id: "calendar", label: "Calendar", href: "/calendar" },
        { id: "messages", label: "Messages", href: "/messages" },
      ];
    case "staff":
    default: {
      const isAdmin = opts?.isAdmin ?? true;
      const items: Array<PortalNavItem & { adminOnly?: boolean }> = [
        { id: "dashboard", label: "Dashboard", href: "/dashboard", icon: "home" },
        {
          id: "maintenance",
          label: "Maintenance",
          href: "/maintenance",
          icon: "wrench",
          countLabel: "need action",
        },
        { id: "properties", label: "Properties", href: "/properties", icon: "building" },
        { id: "rent", label: "Rent", href: "/rent", icon: "dollar" },
        {
          id: "people",
          label: "People",
          href: "/people",
          icon: "user",
          countLabel: "awaiting approval",
        },
        {
          id: "messages",
          label: "Messages",
          href: "/messages",
          icon: "message",
          countLabel: "unread",
        },
        { id: "documents", label: "Documents", href: "/documents", icon: "file" },
        { id: "listings", label: "Website listings", href: "/listings", icon: "globe" },
        { id: "settings", label: "Settings", href: "/settings", icon: "settings", adminOnly: true },
      ];
      return items
        .filter((item) => isAdmin || !item.adminOnly)
        .map(({ adminOnly: _adminOnly, ...item }) => item);
    }
  }
}

/**
 * Copy of `items` with live counts applied by item id. A missing, zero or
 * non-finite count leaves the item without a badge.
 */
export function withNavCounts(
  items: PortalNavItem[],
  counts: Partial<Record<string, number | null | undefined>>,
): PortalNavItem[] {
  return items.map((item) => {
    const count = counts[item.id];
    return typeof count === "number" && Number.isFinite(count) && count > 0
      ? { ...item, count }
      : item;
  });
}

export function roleLabel(role: string): string {
  switch (role) {
    case "admin":
      return "Admin";
    case "landlord":
      return "Landlord";
    case "tenant":
      return "Tenant";
    case "maintenance":
      return "Maintenance";
    default:
      return role;
  }
}

/** Display name for the account trigger — prefer a real name later; email local-part for now. */
export function displayNameFromEmail(email: string | null | undefined): string {
  if (!email) return "Account";
  const local = email.split("@")[0] ?? email;
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[parts.length - 1][0] ?? ""}`.toUpperCase();
}
