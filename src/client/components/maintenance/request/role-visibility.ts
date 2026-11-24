import type { RequestViewerRole } from "@/lib/request-timeline";

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
};

export function sectionsForRole(role: RequestViewerRole): RequestSectionVisibility {
  return VISIBILITY[role];
}

/**
 * Viewer role from the app flags (useApp()). The app exposes isAdmin / isTenant /
 * isLandlord and canEditWorkOrders; a signed-in non-admin editor is the worker.
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
  return "maintenance";
}

/** Back link per role ("‹ My jobs" for workers). Every list lives at /maintenance. */
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
