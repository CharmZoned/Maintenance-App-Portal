import type { PortalAudience } from "./safe-redirect";

/** One primary-nav row for the Phase 0 Landlord Gopher chrome. */
export type PortalNavItem = {
  id: string;
  label: string;
  href: string;
  /** Live count badge (brand pill). Omit or 0 = hidden. */
  count?: number;
};

export const PORTAL_BRAND = "Landlord Gopher";

/**
 * Role shells from Figma `01 Chrome` (Phase 0).
 * Retired nav (leases, rent, calendar, landlords, tenants, users, applications,
 * settings) stays reachable by direct URL for staff — not listed here.
 */
export function navItemsForAudience(audience: PortalAudience): PortalNavItem[] {
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
        { id: "messages", label: "Messages", href: "/messages" },
      ];
    case "staff":
    default:
      return [
        { id: "dashboard", label: "Dashboard", href: "/dashboard" },
        { id: "maintenance", label: "Maintenance", href: "/maintenance" },
        { id: "properties", label: "Properties", href: "/properties" },
        { id: "people", label: "People", href: "/people" },
        { id: "messages", label: "Messages", href: "/messages" },
        { id: "documents", label: "Documents", href: "/documents" },
      ];
  }
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
