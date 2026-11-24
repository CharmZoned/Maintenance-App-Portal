import type { RequestViewerRole } from "@/lib/request-timeline";
import { parseRoute, type Route } from "@/hooks/use-router";
import { safeInternalPath } from "@/lib/safe-redirect";

export type { RequestViewerRole };

/**
 * Which parts of the ONE request page a role sees (brief N3, owner review
 * "one request page for every role, show/hide by role"). The page renders the
 * same layout for everyone and consults this instead of branching per role.
 */
export interface RequestSectionVisibility {
  /** Right-hand actions panel (admin: status/vendor/cost/edit/delete; worker: Start → Complete, hold). */
  actionsPanel: boolean;
  /** Internal notes and office-only events in the timeline. */
  internalNotes: boolean;
  /** "Internal only" switch on the composer (staff only). */
  internalToggle: boolean;
  /** Vendor value (admin only: Vendors is admin-only under RLS since 20261119090000). */
  vendor: boolean;
  /** Which price the viewer may see; null hides the Cost value. Mirrors the price-table RLS. */
  cost: "worker" | "landlord" | "both" | null;
  /** Cost / vendor are tappable to edit (admin). */
  costVendorEditable: boolean;
  /** Message box under the timeline. Landlord: off (request messaging out of scope per SOW). */
  composer: boolean;
  /** Add-photo tile in the photos card. */
  addPhotos: boolean;
  /** Edit details / Delete under the actions panel. */
  editAndDelete: boolean;
  /** Worker status buttons: Start work / Put on hold / Mark completed. */
  workerStatusActions: boolean;
  /** Admin "Change status" main control. */
  changeStatus: boolean;
}

const VISIBILITY: Record<RequestViewerRole, RequestSectionVisibility> = {
  admin: {
    actionsPanel: true,
    internalNotes: true,
    internalToggle: true,
    vendor: true,
    cost: "both",
    costVendorEditable: true,
    composer: true,
    addPhotos: true,
    editAndDelete: true,
    workerStatusActions: false,
    changeStatus: true,
  },
  maintenance: {
    actionsPanel: true,
    internalNotes: true,
    internalToggle: true,
    vendor: false,
    cost: "worker",
    costVendorEditable: false,
    composer: true,
    addPhotos: true,
    editAndDelete: false,
    workerStatusActions: true,
    changeStatus: false,
  },
  tenant: {
    actionsPanel: false,
    internalNotes: false,
    internalToggle: false,
    vendor: false,
    cost: null,
    costVendorEditable: false,
    composer: true,
    addPhotos: true,
    editAndDelete: false,
    workerStatusActions: false,
    changeStatus: false,
  },
  landlord: {
    actionsPanel: false,
    internalNotes: false,
    internalToggle: false,
    vendor: false,
    cost: "landlord",
    costVendorEditable: false,
    composer: false,
    addPhotos: false,
    editAndDelete: false,
    workerStatusActions: false,
    changeStatus: false,
  },
  // Unknown role: read-only. No actions, no message box, no photos, no prices.
  viewer: {
    actionsPanel: false,
    internalNotes: false,
    internalToggle: false,
    vendor: false,
    cost: null,
    costVendorEditable: false,
    composer: false,
    addPhotos: false,
    editAndDelete: false,
    workerStatusActions: false,
    changeStatus: false,
  },
};

export function sectionsForRole(role: RequestViewerRole): RequestSectionVisibility {
  return VISIBILITY[role];
}

/**
 * Viewer role from the app flags (useApp()). The app exposes isAdmin / isTenant /
 * isLandlord and canEditWorkOrders. Only a non-admin who may edit work orders
 * is the worker; anyone else (role not known, or no edit right) gets the
 * read-only `viewer` role rather than worker controls.
 */
export function viewerRoleFrom(app: {
  isAdmin: boolean;
  isTenant: boolean;
  isLandlord: boolean;
  canEditWorkOrders: boolean;
}): RequestViewerRole {
  if (app.isAdmin) return "admin";
  if (app.isTenant) return "tenant";
  if (app.isLandlord) return "landlord";
  if (app.canEditWorkOrders) return "maintenance";
  return "viewer";
}

/**
 * Back link per role ("‹ My jobs" for workers). Every role's list lives at
 * /maintenance (the worker shell renders My jobs there; there is no /my-jobs route).
 */
export function backLinkFor(role: RequestViewerRole): { label: string; to: string } {
  switch (role) {
    case "tenant":
      return { label: "Requests", to: "/maintenance" };
    case "maintenance":
      return { label: "My jobs", to: "/maintenance" };
    default:
      return { label: "Maintenance", to: "/maintenance" };
  }
}

const FROM_LABELS: Partial<Record<Route["name"], string>> = {
  dashboard: "Dashboard",
  home: "Home",
  calendar: "Calendar",
  messages: "Messages",
  properties: "Properties",
  property: "Property",
  tenant: "Tenant",
  people: "People",
};

/**
 * Back link that honours `?from=<encoded path>` (set by the maintenance list
 * and calendar so Back returns to the same view, filters included). Only a
 * safe internal path (safeInternalPath: same origin, a real portal route) that
 * is not another request page is used; anything else falls back to
 * backLinkFor(role).
 */
export function backLinkFromSearch(
  role: RequestViewerRole,
  search: string,
  origin: string,
): { label: string; to: string } {
  const fallback = backLinkFor(role);
  const raw = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get("from");
  const pathname = safeInternalPath(raw, origin);
  if (!raw || !pathname) return fallback;
  const route = parseRoute(pathname);
  if (route.name === "request") return fallback;
  // safeInternalPath keeps the path only; carry the list's own query (filters, view) back too.
  const query = new URL(raw, origin).search;
  const label = route.name === "maintenance" ? fallback.label : (FROM_LABELS[route.name] ?? "Back");
  return { label, to: `${pathname}${query}` };
}

/**
 * Primary button on the "This request isn't available" state (spec §3):
 * admin → Dashboard, worker → My jobs, tenant / landlord → Home.
 */
export function notAvailableActionFor(role: RequestViewerRole): { label: string; to: string } {
  switch (role) {
    case "admin":
      return { label: "Go to Dashboard", to: "/" };
    case "maintenance":
      return { label: "Go to My jobs", to: "/maintenance" };
    default:
      return { label: "Go to Home", to: "/home" };
  }
}
