import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  PRIORITY_LABEL,
  priorityLabel,
  requestStatusFromDb,
  statusOptions,
  toRequestStatus,
} from "@/lib/request-status";
import { buildTimeline } from "@/lib/request-timeline";
import { ADMIN_STATUSES, PRIORITIES, staffStatusOptions } from "@/components/maintenance/work-order-status";
import type { MaintenanceComment, MaintenanceStatusEvent, WorkOrder } from "@/types";
import {
  RequestActionsPanel,
  RequestHeader,
  headerNextStep,
  RequestNotAvailableState,
  RequestPhotosCard,
  RequestTimeline,
  sectionsForRole,
  statusMenuItems,
  viewerRoleFrom,
  workerPrimaryAction,
} from "./index";

function wo(partial: Partial<WorkOrder> = {}): WorkOrder {
  return {
    id: 6,
    request_number: "MR-001006",
    property_id: 1,
    unit_id: 1,
    tenant_id: 11,
    vendor_id: null,
    title: "Kitchen faucet dripping",
    description: "Drips about once a second.",
    category: "Plumbing",
    priority: "urgent",
    status: "in_progress",
    permission_to_enter: true,
    assigned_staff_id: 4,
    scheduled_at: null,
    completed_at: null,
    worker_price: null,
    landlord_price: null,
    notes: null,
    created_at: "2026-11-22T10:00:00Z",
    ...partial,
  };
}

const history: MaintenanceStatusEvent[] = [
  { id: 1, maintenance_request_id: 6, from_status: null, to_status: "Open", changed_by_role: "tenant", note: "Created", created_at: "2026-11-22T10:00:00Z" },
  { id: 2, maintenance_request_id: 6, from_status: "Open", to_status: "Open", changed_by_role: "admin", note: "Offered to workers", created_at: "2026-11-23T09:00:00Z" },
  { id: 3, maintenance_request_id: 6, from_status: "Open", to_status: "Scheduled", changed_by_role: "maintenance", note: "Accepted by worker", created_at: "2026-11-23T10:00:00Z" },
  { id: 4, maintenance_request_id: 6, from_status: "Scheduled", to_status: "In Progress", changed_by_role: "maintenance", note: null, created_at: "2026-11-24T08:00:00Z" },
];

const comments: MaintenanceComment[] = [
  { id: 7, maintenance_request_id: 6, body: "Part on back-order.", visibility: "internal", author_role: "maintenance", author_staff_id: 4, author_tenant_id: null, created_at: "2026-11-23T12:00:00Z" },
  { id: 8, maintenance_request_id: 6, body: "Thanks!", visibility: "tenant_visible", author_role: "tenant", author_staff_id: null, author_tenant_id: 11, created_at: "2026-11-23T13:00:00Z" },
];

const people = {
  staffById: new Map([[4, { first_name: "Sam", last_name: "Fixit" }]]),
  tenantName: "Tina Renter",
};

describe("shared status / priority mapping", () => {
  it("uses only the five design labels, from one place", () => {
    expect(statusOptions().map((o) => o.label)).toEqual(["New", "Assigned", "In progress", "On hold", "Completed"]);
    expect(ADMIN_STATUSES.map((o) => o.label)).toEqual(["New", "Assigned", "In progress", "On hold", "Completed"]);
    expect(staffStatusOptions(true).map((o) => o.label)).toEqual(["New", "In progress", "On hold", "Completed"]);
    expect(requestStatusFromDb("In Progress")).toBe("In progress");
    expect(requestStatusFromDb("Closed")).toBe("Completed");
    expect(toRequestStatus({ status: "open", assigned_staff_id: 3 })).toBe("Assigned");
  });

  it("calls DB 'urgent' Emergency everywhere, never Urgent", () => {
    expect(PRIORITY_LABEL.urgent).toBe("Emergency");
    expect(priorityLabel("urgent")).toBe("Emergency");
    expect(PRIORITIES.map((p) => p.label)).not.toContain("Urgent");
  });
});

describe("buildTimeline", () => {
  it("orders oldest first and stamps each status at its own time", () => {
    const entries = buildTimeline(wo(), history, comments, people, "admin");
    expect(entries.map((e) => e.key)).toEqual([
      "reported",
      "status-2",
      "status-3",
      "message-7",
      "message-8",
      "status-4",
    ]);
    const started = entries.find((e) => e.key === "status-4")!;
    expect(started.at).toBe("2026-11-24T08:00:00Z");
    expect(started.text).toBe("Sam Fixit started work");
    expect(started.status).toBe("In progress");
    expect(entries[0].status).toBe("New");
  });

  it("writes events in plain language with names and role tags", () => {
    const entries = buildTimeline(wo(), history, comments, people, "admin");
    expect(entries.map((e) => e.text).join("\n")).not.toMatch(/Offered to workers|→/);
    expect(entries.find((e) => e.key === "status-3")!.text).toBe("Sam Fixit accepted the job");
    expect(entries.find((e) => e.key === "message-7")!.actor).toMatchObject({ name: "Sam Fixit", role: "Maintenance", initials: "SF" });
  });

  it("drops internal entries for tenant and landlord", () => {
    for (const role of ["tenant", "landlord"] as const) {
      const entries = buildTimeline(wo(), history, comments, { ...people, viewerTenantId: 11 }, role);
      expect(entries.some((e) => e.internal)).toBe(false);
      expect(entries.map((e) => e.key)).not.toContain("status-2");
      expect(entries.map((e) => e.key)).not.toContain("message-7");
    }
    const mine = buildTimeline(wo(), history, comments, { ...people, viewerTenantId: 11 }, "tenant");
    expect(mine[0].text).toBe("You reported this");
  });
});

describe("role visibility", () => {
  it("shows sections by role", () => {
    expect(sectionsForRole("admin")).toMatchObject({ actionsPanel: true, internalNotes: true, cost: "both", composer: true });
    expect(sectionsForRole("maintenance")).toMatchObject({ actionsPanel: true, workerStatusActions: true, cost: "worker", vendor: false });
    expect(sectionsForRole("tenant")).toMatchObject({ actionsPanel: false, internalNotes: false, composer: true, cost: null });
    expect(sectionsForRole("landlord")).toMatchObject({ actionsPanel: false, composer: false, cost: "landlord" });
    expect(viewerRoleFrom({ isAdmin: false, isTenant: false, isLandlord: false, canEditWorkOrders: true })).toBe("maintenance");
  });

  it("only treats a non-admin editor as the worker; anyone else is read-only", () => {
    const flags = { isAdmin: false, isTenant: false, isLandlord: false, canEditWorkOrders: false };
    expect(viewerRoleFrom(flags)).toBe("viewer");
    expect(viewerRoleFrom({ ...flags, isAdmin: true })).toBe("admin");
    expect(viewerRoleFrom({ ...flags, isAdmin: true, canEditWorkOrders: true })).toBe("admin");
    expect(viewerRoleFrom({ ...flags, isTenant: true })).toBe("tenant");
    expect(viewerRoleFrom({ ...flags, isLandlord: true })).toBe("landlord");
    const readOnly = sectionsForRole("viewer");
    expect(readOnly).toMatchObject({ cost: null, vendor: false, internalNotes: false });
    for (const key of [
      "actionsPanel",
      "internalToggle",
      "costVendorEditable",
      "composer",
      "addPhotos",
      "editAndDelete",
      "workerStatusActions",
      "changeStatus",
    ] as const) {
      expect(readOnly[key], key).toBe(false);
    }
    // No messages and no internal entries for the read-only viewer.
    const entries = buildTimeline(
      wo(),
      [],
      [
        {
          id: 1,
          maintenance_request_id: 6,
          body: "Tenant note",
          visibility: "tenant_visible",
          author_role: "tenant",
          author_staff_id: null,
          author_tenant_id: 11,
          created_at: "2026-11-14T10:00:00Z",
        },
      ],
      {},
      "viewer",
    );
    expect(entries.some((e) => e.kind === "message")).toBe(false);
  });

  it("ticks the stored status in Change status, not the display label", () => {
    // An `open` row with an assignee displays "Assigned" but is not `scheduled`.
    const order = wo({ status: "open", assigned_staff_id: 4 });
    expect(toRequestStatus(order)).toBe("Assigned");
    const items = statusMenuItems(order.status);
    const current = items.filter((i) => i.isCurrent).map((i) => i.value);
    expect(current).toEqual(["open"]);
    const scheduled = items.find((i) => i.value === "scheduled");
    expect(scheduled).toMatchObject({ label: "Assigned", isCurrent: false });
    expect(items.map((i) => i.label)).toEqual(["New", "Assigned", "In progress", "On hold", "Completed"]);
    expect(items.filter((i) => i.needsInput).map((i) => i.value)).toEqual(["on_hold", "closed"]);
    expect(statusMenuItems("scheduled").find((i) => i.isCurrent)?.value).toBe("scheduled");
  });

  it("advances the worker with one primary button", () => {
    expect(workerPrimaryAction("Assigned")).toBe("start");
    expect(workerPrimaryAction("In progress")).toBe("complete");
    expect(workerPrimaryAction("On hold")).toBe("resume");
    expect(workerPrimaryAction("Completed")).toBeNull();
  });
});

describe("header next step fallback", () => {
  it("is status-aware when requestNextStep has nothing", () => {
    expect(headerNextStep("In progress", "Started today · Sam Fixit", "Sam Fixit")).toBe("Started today · Sam Fixit");
    expect(headerNextStep("New", undefined, null)).toBe("Not assigned yet");
    expect(headerNextStep("Assigned", undefined, "Sam Fixit")).toBe("Assigned to Sam Fixit");
    expect(headerNextStep("Assigned", "  ", null)).toBe("Not scheduled yet");
    expect(headerNextStep("In progress", undefined, "Sam Fixit")).toBe("Assigned to Sam Fixit");
    expect(headerNextStep("In progress", undefined, null)).toBeNull();
    for (const status of ["On hold", "Completed"] as const) {
      expect(headerNextStep(status, undefined, null), status).toBeNull();
      expect(headerNextStep(status, undefined, "Sam Fixit"), status).toBeNull();
    }
  });

  it("renders no step for On hold without a reason instead of Not assigned yet", () => {
    const html = renderToStaticMarkup(
      createElement(RequestHeader, {
        title: "Kitchen faucet dripping",
        requestNumber: "MR-001006",
        status: "On hold",
        priority: null,
        location: "Unit 1A · Maple Court",
        reportedBy: "Tina Renter",
        reportedWhen: "Sat 14 Nov",
        assigneeName: null,
        backLabel: "Maintenance",
        onBack: () => undefined,
      }),
    );
    expect(html).toContain("On hold");
    expect(html).not.toContain("Not assigned yet");
    expect(html).not.toContain("Assigned to");
  });
});

describe("stub components render", () => {
  it("header shows title with number beside it and status in the summary line", () => {
    const html = renderToStaticMarkup(
      createElement(RequestHeader, {
        title: "Kitchen faucet dripping",
        requestNumber: "MR-001006",
        status: "In progress",
        priority: "Emergency",
        location: "Unit 1A · Maple Court",
        reportedBy: "Tina Renter",
        reportedWhen: "22 Nov",
        assigneeName: "Sam Fixit",
        backLabel: "Maintenance",
        onBack: () => undefined,
      }),
    );
    expect(html).toContain("Kitchen faucet dripping");
    expect(html).toContain("#MR-001006");
    expect(html).not.toContain("Request #");
    expect(html).toContain("Emergency");
    expect(html).toContain("Assigned to Sam Fixit");
  });

  it("photos card shows n of max and an add tile", () => {
    const html = renderToStaticMarkup(
      createElement(RequestPhotosCard, {
        photos: [
          { id: 1, maintenance_request_id: 6, storage_path: "6/a.png", caption: null, created_at: "", uploaded_by_role: "tenant", url: "https://x/a.png" },
          { id: 2, maintenance_request_id: 6, storage_path: "6/b.png", caption: null, created_at: "", uploaded_by_role: "tenant", url: null },
        ],
        max: 5,
        slotsLeft: 3,
        canAdd: true,
        onAdd: () => undefined,
      }),
    );
    expect(html).toContain("2 of 5");
    expect(html).toContain("Add");
  });

  it("timeline, actions panel and not-available state render", () => {
    const entries = buildTimeline(wo(), history, comments, people, "admin");
    const timeline = renderToStaticMarkup(
      createElement(RequestTimeline, {
        entries,
        formatWhen: (iso: string) => iso.slice(0, 10),
        composer: { showInternalToggle: true, onSend: () => undefined },
      }),
    );
    expect(timeline).toContain("Internal — not visible to tenant or landlord");
    expect(timeline).toContain("Internal only");
    expect(timeline).not.toContain("Visible to tenant");

    const worker = renderToStaticMarkup(
      createElement(RequestActionsPanel, {
        role: "maintenance",
        visibility: sectionsForRole("maintenance"),
        status: "Assigned",
        dbStatus: "scheduled",
      }),
    );
    expect(worker).toContain("Start work");
    expect(worker).toContain("Put on hold");

    const tenant = renderToStaticMarkup(
      createElement(RequestActionsPanel, {
        role: "tenant",
        visibility: sectionsForRole("tenant"),
        status: "Assigned",
        dbStatus: "scheduled",
      }),
    );
    expect(tenant).toBe("");

    const missing = renderToStaticMarkup(
      createElement(RequestNotAvailableState, { backLabel: "My jobs", onBack: () => undefined }),
    );
    expect(missing).toContain("This request isn’t available");
  });
});
