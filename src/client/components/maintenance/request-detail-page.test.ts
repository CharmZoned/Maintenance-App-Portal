import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  RequestDetailView,
  costLabelFor,
  dayStamp,
  placeLabel,
  requestNumberLabel,
  type RequestDetailViewProps,
} from "@/components/maintenance/request-detail-page";
import {
  RequestErrorState,
  RequestLoadingState,
  RequestNotAvailableState,
} from "@/components/maintenance/request/request-states";
import { notAvailableActionFor } from "@/components/maintenance/request/role-visibility";
import type { StaffMember } from "@/lib/data";
import type { MaintenanceComment, MaintenancePhoto, MaintenanceStatusEvent, WorkOrder } from "@/types";

function order(partial: Partial<WorkOrder> = {}): WorkOrder {
  return {
    id: 10,
    title: "Kitchen faucet leaking",
    property_id: 1,
    unit_id: 1,
    tenant_id: 1,
    vendor_id: null,
    description: "Kitchen faucet drips constantly.",
    category: "Plumbing",
    priority: "high",
    status: "in_progress",
    permission_to_enter: true,
    assigned_staff_id: 4,
    request_number: "MR-001000",
    scheduled_at: "2026-11-17",
    completed_at: null,
    worker_price: 42,
    landlord_price: 55,
    notes: null,
    created_at: "2026-11-14T14:12:00.000Z",
    property_name: "Maple Court",
    unit_name: "1A",
    tenant_first_name: "Tina",
    tenant_last_name: "Renter",
    ...partial,
  };
}

const staff: StaffMember[] = [
  { id: 4, first_name: "Sam", last_name: "Fixit", email: "sam@example.test", job_title: null, gets_request_alerts: false },
];

const photos: MaintenancePhoto[] = [
  {
    id: 1,
    maintenance_request_id: 10,
    storage_path: "10/a.jpg",
    caption: null,
    created_at: "2026-11-14T14:20:00.000Z",
    uploaded_by_role: "tenant",
    url: "https://example.test/faucet.jpg",
  },
];

const comments: MaintenanceComment[] = [
  {
    id: 1,
    maintenance_request_id: 10,
    body: "The drip is getting worse.",
    visibility: "tenant_visible",
    author_role: "tenant",
    author_staff_id: null,
    author_tenant_id: 1,
    created_at: "2026-11-15T23:20:00.000Z",
  },
  {
    id: 2,
    maintenance_request_id: 10,
    body: "Office only: waiting on the owner.",
    visibility: "internal",
    author_role: "admin",
    author_staff_id: 1,
    author_tenant_id: null,
    created_at: "2026-11-15T23:30:00.000Z",
  },
];

const history: MaintenanceStatusEvent[] = [
  {
    id: 1,
    maintenance_request_id: 10,
    from_status: null,
    to_status: "Open",
    changed_by_role: "tenant",
    note: "Created",
    created_at: "2026-11-14T14:12:00.000Z",
  },
  {
    id: 2,
    maintenance_request_id: 10,
    from_status: "Open",
    to_status: "Scheduled",
    changed_by_role: "admin",
    note: null,
    created_at: "2026-11-16T13:30:00.000Z",
  },
  {
    id: 3,
    maintenance_request_id: 10,
    from_status: "Scheduled",
    to_status: "In Progress",
    changed_by_role: "maintenance",
    note: null,
    created_at: "2026-11-24T09:40:00.000Z",
  },
];

function render(props: Partial<RequestDetailViewProps> = {}): string {
  return renderToStaticMarkup(
    createElement(RequestDetailView, {
      role: "admin",
      order: order(),
      photos,
      comments,
      history,
      staff,
      onBack: () => undefined,
      onChangeStatus: () => undefined,
      onAssign: () => undefined,
      onAddPhotos: () => undefined,
      onSend: () => undefined,
      ...props,
    }),
  );
}

describe("one request page for every role", () => {
  it("admin: title with number beside it, status in the summary line, actions panel", () => {
    const html = render();
    expect(html).toContain("Kitchen faucet leaking");
    expect(html).toContain("#MR-001000");
    expect(html).not.toContain("Request #");
    expect(html).toContain("In progress");
    expect(html).toContain("High");
    expect(html).toContain("Unit 1A · Maple Court · Reported by Tina Renter");
    expect(html).toContain("Sam Fixit · Maintenance");
    expect(html).not.toContain("Assigned (staff)");
    expect(html).toContain("Actions");
    expect(html).toContain("Office only: waiting on the owner.");
    expect(html).toContain("Internal only");
    expect(html).not.toContain("Visible to tenant");
    expect(html).not.toContain("Landlord conversation");
    expect(html).toContain("Worker $42.00 · Landlord $55.00");
  });

  it("tenant: same page, worker's name, no actions or internal notes, replies on the page", () => {
    const html = render({ role: "tenant", viewerTenantId: 1 });
    expect(html).toContain("Kitchen faucet leaking");
    expect(html).toContain("Requests");
    expect(html).toContain("Sam Fixit · Maintenance");
    expect(html).not.toContain("Assigned (staff)");
    expect(html).not.toContain("Office only: waiting on the owner.");
    expect(html).toContain("The drip is getting worse.");
    expect(html).toContain("Send");
    expect(html).not.toContain("Internal only");
    expect(html).not.toContain("Open request conversation");
    expect(html).not.toContain(">Updates<");
    expect(html).not.toContain(">Actions<");
    expect(html).not.toContain("$42.00");
    expect(html).not.toContain("$55.00");
  });

  it("tenant timeline is in time order: In progress comes after the report and the message", () => {
    const html = render({ role: "tenant", viewerTenantId: 1 });
    const reported = html.indexOf("You reported this");
    const message = html.indexOf("The drip is getting worse.");
    const started = html.indexOf("Sam Fixit started work");
    expect(reported).toBeGreaterThan(-1);
    expect(message).toBeGreaterThan(reported);
    expect(started).toBeGreaterThan(message);
  });

  it("landlord: Emergency everywhere, status events only, no composer or actions", () => {
    const html = render({ role: "landlord", order: order({ priority: "urgent" }) });
    expect(html).toContain("Emergency");
    expect(html).not.toContain("Urgent");
    expect(html).not.toContain("The drip is getting worse.");
    expect(html).not.toContain("Office only: waiting on the owner.");
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain(">Send<");
    expect(html).not.toContain(">Actions<");
    expect(html).not.toContain('type="file"');
    expect(html).toContain("$55.00");
    expect(html).not.toContain("$42.00");
    expect(html).toContain("Sam Fixit started work");
  });

  it("worker: Start work / Put on hold, no edit or delete, worker price only", () => {
    const html = render({ role: "maintenance", order: order({ status: "scheduled" }), viewerStaffId: 4 });
    expect(html).toContain("Start work");
    expect(html).toContain("Put on hold");
    expect(html).toContain("My jobs");
    expect(html).not.toContain("Edit details");
    expect(html).not.toContain("$55.00");
    expect(html).toContain("$42.00");
    expect(html).toContain("Internal only");
  });

  it("completed: shows what fixed it and closes messages", () => {
    const html = render({
      order: order({ status: "closed", resolution_notes: "Replaced the faucet cartridge.", completed_at: "2026-11-24T10:00:00.000Z" }),
    });
    expect(html).toContain("Completed");
    expect(html).toContain("What fixed it");
    expect(html).toContain("Replaced the faucet cartridge.");
    expect(html).toContain("This request is completed. Messages are closed.");
  });

  it("unassigned: Not assigned yet, never a placeholder name", () => {
    const html = render({ role: "tenant", order: order({ status: "open", assigned_staff_id: null, scheduled_at: null }) });
    expect(html).toContain("New");
    expect(html).toContain("Not assigned yet");
    expect(html).toContain("Not scheduled yet");
  });
});

describe("request page helpers", () => {
  it("labels the number, place and cost", () => {
    expect(requestNumberLabel({ id: 7, request_number: "MR-001006" })).toBe("#MR-001006");
    expect(requestNumberLabel({ id: 7, request_number: null })).toBe("#7");
    expect(placeLabel({ unit_name: "1A", property_name: "Maple Court" })).toBe("Unit 1A · Maple Court");
    expect(placeLabel({ unit_name: null, property_name: "Maple Court" })).toBe("Common area · Maple Court");
    expect(placeLabel({ unit_name: null, property_name: null })).toBe("");
    expect(costLabelFor({ worker_price: 42, landlord_price: null }, "both")).toBe("Worker $42.00");
    expect(costLabelFor({ worker_price: 42, landlord_price: 55 }, "landlord")).toBe("$55.00");
    expect(costLabelFor({ worker_price: null, landlord_price: null }, "both")).toBeNull();
    expect(costLabelFor({ worker_price: 42, landlord_price: 55 }, null)).toBeNull();
  });

  it("writes days as Today / Yesterday / a date, keeping date-only days", () => {
    const now = new Date(2026, 10, 24, 15, 0);
    expect(dayStamp("2026-11-24", now)).toBe("Today");
    expect(dayStamp("2026-11-23T12:00:00.000Z", now)).toBe("Yesterday");
    expect(dayStamp("2026-11-17", now)).not.toBe("");
    expect(dayStamp(null, now)).toBe("");
  });
});

describe("request page states", () => {
  it("loading is a skeleton, never text", () => {
    const html = renderToStaticMarkup(createElement(RequestLoadingState, { withActionsPanel: true }));
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain("Loading…");
  });

  it("error offers Retry with the designed copy", () => {
    const html = renderToStaticMarkup(
      createElement(RequestErrorState, { onRetry: () => undefined, backLabel: "Maintenance", onBack: () => undefined }),
    );
    expect(html).toContain("We couldn&#x27;t load this request. Check your connection and try again.");
    expect(html).toContain("Retry");
    expect(html).toContain("Maintenance");
  });

  it("not available names the role's way out", () => {
    const action = notAvailableActionFor("maintenance");
    const html = renderToStaticMarkup(
      createElement(RequestNotAvailableState, {
        backLabel: "My jobs",
        onBack: () => undefined,
        actionLabel: action.label,
        onAction: () => undefined,
      }),
    );
    expect(html).toContain("This request isn’t available. It may have been deleted, or you may not have access to it.");
    expect(html).toContain("Go to My jobs");
    expect(notAvailableActionFor("admin").label).toBe("Go to Dashboard");
    expect(notAvailableActionFor("tenant").label).toBe("Go to Home");
    expect(notAvailableActionFor("landlord").label).toBe("Go to Home");
  });
});
