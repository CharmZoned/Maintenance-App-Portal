import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  RequestDetailView,
  assignableStaff,
  costLabelFor,
  dayStamp,
  landlordBilledLabel,
  officeHrefForRequest,
  placeLabel,
  requestNumberLabel,
  workerHoldsJob,
  type RequestDetailViewProps,
} from "@/components/maintenance/request-detail-page";
import { tenantFixState, tenantFixSummary } from "@/components/maintenance/request/tenant-fix-check";
import {
  RequestErrorState,
  RequestLoadingState,
  RequestNotAvailableState,
} from "@/components/maintenance/request/request-states";
import { backLinkFromSearch, notAvailableActionFor } from "@/components/maintenance/request/role-visibility";
import type { StaffMember } from "@/lib/data";
import { photosCounterLabel } from "@/components/maintenance/request/request-photos-card";
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
    // In progress: the landlord price is still an estimate, so no cost is shown.
    expect(html).not.toContain("$55.00");
    expect(html).not.toContain("$42.00");
    expect(html).toContain("Sam Fixit started work");
  });

  it("landlord: the request title is the page h1, with a way to message the office", () => {
    const html = render({ role: "landlord", onMessageOffice: () => undefined });
    expect(html).toMatch(/<h1[^>]*>Kitchen faucet leaking<\/h1>/);
    expect(html).toContain("Message the office about this request");
    expect(render({ role: "landlord" })).not.toContain("Message the office");
  });

  it("landlord: a New job shows no cost; a completed one shows what was Billed", () => {
    const fresh = render({ role: "landlord", order: order({ status: "open", assigned_staff_id: null, landlord_price: 190 }) });
    expect(fresh).not.toContain("$190.00");
    expect(fresh).not.toContain(">Cost<");
    const done = render({
      role: "landlord",
      order: order({ status: "closed", resolution_notes: "Fixed.", completed_at: "2026-11-24T10:00:00.000Z" }),
    });
    expect(done).toContain(">Billed<");
    expect(done).toContain("$55.00");
  });

  it("worker on a job they do not hold: no message box, no photo upload, no tenant name", () => {
    const html = render({
      role: "maintenance",
      order: order({ status: "open", assigned_staff_id: null }),
      viewerStaffId: 4,
    });
    expect(html).not.toContain("Accept job"); // self-claim off: no onAcceptJob
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain('type="file"');
    expect(html).not.toContain("Add photos");
    expect(html).not.toContain("Tina Renter");
    expect(html).toContain("This job isn’t assigned to you yet.");
  });

  it("worker holding the job, self-claim on: Release job", () => {
    const html = render({ role: "maintenance", order: order({ status: "scheduled" }), viewerStaffId: 4, onReleaseJob: () => undefined });
    expect(html).toContain("Release job");
    expect(render({ role: "maintenance", order: order({ status: "scheduled" }), viewerStaffId: 4 })).not.toContain(
      "Release job",
    );
  });

  it("tenant, completed: Is it fixed? with both answers; then the confirmed state", () => {
    const done = order({ status: "closed", resolution_notes: "Fixed.", completed_at: "2026-11-24T10:00:00.000Z" });
    const ask = render({ role: "tenant", order: done, onConfirmFixed: () => undefined, onStillProblem: () => undefined });
    expect(ask).toContain("Is it fixed?");
    expect(ask).toContain("Yes, it’s fixed");
    expect(ask).toContain("Still a problem");
    expect(ask).toContain("Sam Fixit marked this completed");

    const confirmed = render({
      role: "tenant",
      order: { ...done, tenant_fix_response: "confirmed", tenant_fix_responded_at: "2026-11-24T11:00:00.000Z" },
      onConfirmFixed: () => undefined,
      onStillProblem: () => undefined,
    });
    expect(confirmed).toContain("You confirmed it’s fixed");
    expect(confirmed).not.toContain("Is it fixed?");
  });

  it("staff see the tenant's answer in Details", () => {
    const done = order({
      status: "closed",
      resolution_notes: "Fixed.",
      completed_at: "2026-11-24T10:00:00.000Z",
      tenant_fix_response: "confirmed",
      tenant_fix_responded_at: "2026-11-24T11:00:00.000Z",
    });
    const html = render({ order: done });
    expect(html).toContain("Tenant check");
    expect(html).toContain("Tenant confirmed it’s fixed");
    expect(html).not.toContain("Is it fixed?");
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

  it("admin completed: the locked strip offers Reopen", () => {
    const html = render({
      order: order({ status: "closed", completed_at: "2026-11-24T10:00:00.000Z" }),
      onReopen: () => undefined,
    });
    expect(html).toContain("Reopen");
  });

  it("worker, pooled job: Accept job instead of a Start work that would fail", () => {
    const html = render({
      role: "maintenance",
      order: order({ status: "open", assigned_staff_id: null }),
      onAcceptJob: () => undefined,
    });
    expect(html).toContain("Accept job");
    expect(html).not.toContain("Start work");
    expect(html).not.toContain("Offered to workers");
  });

  it("names the person behind a status change, and the viewer as You", () => {
    const withUser = history.map((h) => (h.id === 3 ? { ...h, changed_by_user_id: "u-sam" } : h));
    const html = render({
      role: "maintenance",
      history: withUser,
      nameForUserId: (uid) => (uid === "u-sam" ? "You" : null),
    });
    expect(html).toContain("You started work");
  });

  it("photos fail on their own with Retry, the rest of the page still shows", () => {
    const html = render({ photos: [], photosError: "We couldn't load the photos.", onRetryPhotos: () => undefined });
    expect(html).toMatch(/load the photos/);
    expect(html).toContain("Timeline");
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

describe("request page: completion, offers and links", () => {
  it("landlord billed amount only once completed", () => {
    expect(landlordBilledLabel({ status: "in_progress", landlord_price: 55 })).toBeNull();
    expect(landlordBilledLabel({ status: "closed", landlord_price: null })).toBeNull();
    expect(landlordBilledLabel({ status: "closed", landlord_price: 55 })).toBe("$55.00");
  });

  it("office link carries property, unit, number and title", () => {
    const href = officeHrefForRequest(order());
    const about = new URLSearchParams(href.split("?")[1]).get("about");
    expect(href.startsWith("/messages?office=me")).toBe(true);
    expect(about).toBe("Maple Court · Unit 1A · MR-001000 · Kitchen faucet leaking");
  });

  it("a worker holds a job only when it is assigned to them", () => {
    expect(workerHoldsJob({ assigned_staff_id: null }, 4)).toBe(false);
    expect(workerHoldsJob({ assigned_staff_id: 5 }, 4)).toBe(false);
    expect(workerHoldsJob({ assigned_staff_id: 4 }, 4)).toBe(true);
    expect(workerHoldsJob({ assigned_staff_id: 4 }, null)).toBe(true);
  });

  it("tenant fix state and summary", () => {
    expect(tenantFixState({ status: "in_progress", tenant_fix_response: null })).toBeNull();
    expect(tenantFixState({ status: "closed", tenant_fix_response: null })).toBe("ask");
    expect(tenantFixState({ status: "closed", tenant_fix_response: "not_fixed" })).toBe("not_fixed");
    const day = () => "Tue 24 Nov";
    expect(tenantFixSummary({ status: "closed", tenant_fix_response: null, tenant_fix_responded_at: null }, day)).toBe(
      "Waiting for the tenant to confirm",
    );
    expect(
      tenantFixSummary({ status: "closed", tenant_fix_response: "confirmed", tenant_fix_responded_at: "x" }, day),
    ).toBe("Tenant confirmed it’s fixed, Tue 24 Nov");
  });

  it("back link follows a safe ?from= and keeps its filters", () => {
    const origin = "https://portal.test";
    const from = (path: string) => `?from=${encodeURIComponent(path)}`;
    expect(backLinkFromSearch("admin", from("/maintenance?status=New&view=board"), origin)).toEqual({
      label: "Maintenance",
      to: "/maintenance?status=New&view=board",
    });
    expect(backLinkFromSearch("admin", from("/calendar?week=2026-11-23"), origin)).toEqual({
      label: "Calendar",
      to: "/calendar?week=2026-11-23",
    });
    expect(backLinkFromSearch("maintenance", from("/maintenance"), origin)).toEqual({ label: "My jobs", to: "/maintenance" });
    // Unsafe or unknown: the role's own list.
    for (const bad of ["https://evil.test/maintenance", "//evil.test", "javascript:alert(1)", "/nope", "/maintenance/12"]) {
      expect(backLinkFromSearch("tenant", from(bad), origin)).toEqual({ label: "Requests", to: "/maintenance" });
    }
    expect(backLinkFromSearch("tenant", "", origin)).toEqual({ label: "Requests", to: "/maintenance" });
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

describe("review fixes: request page", () => {
  it("photo counter matches the thumbnails on screen", () => {
    // Tenant: own photo + the worker's photo (separate DB caps).
    expect(photosCounterLabel({ total: 2, max: 5, slotsLeft: 4, canAdd: true })).toBe("2 photos · 4 more can be added");
    // Worker seeing one tenant photo, none of their own.
    expect(photosCounterLabel({ total: 1, max: 5, slotsLeft: 5, canAdd: true })).toBe("1 photo · 5 more can be added");
    expect(photosCounterLabel({ total: 2, max: 5, slotsLeft: 3, canAdd: true })).toBe("2 of 5 · 3 more can be added");
    expect(photosCounterLabel({ total: 0, max: 5, slotsLeft: 5, canAdd: true })).toBe("0 of 5 · 5 more can be added");
    expect(photosCounterLabel({ total: 2, max: 5, slotsLeft: 0, canAdd: false })).toBe("2 of 5");
  });

  it("Assign to offers approved workers only", () => {
    const people = [
      { id: 1, first_name: "Ada", last_name: "Admin", email: "admin@test.local", job_title: "Operations manager", gets_request_alerts: true },
      { id: 2, first_name: "Sam", last_name: "Fixit", email: "worker@test.local", job_title: null, gets_request_alerts: false },
      { id: 3, first_name: "Pat", last_name: "New", email: "pending@test.local", job_title: null, gets_request_alerts: false },
      { id: 4, first_name: "Off", last_name: "Line", email: "nologin@test.local", job_title: null, gets_request_alerts: false },
    ];
    const accounts = [
      { staff_id: null, email: "admin@test.local", role: "admin" as const, account_status: "approved" as const },
      { staff_id: 2, email: "worker@test.local", role: "maintenance" as const, account_status: "approved" as const },
      { staff_id: 3, email: "pending@test.local", role: "maintenance" as const, account_status: "pending" as const },
    ];
    expect(assignableStaff(people, accounts, null).map((s) => s.id)).toEqual([2, 4]);
    expect(assignableStaff(people, accounts, 3).map((s) => s.id)).toEqual([2, 3, 4]);
    expect(assignableStaff(people, [], null)).toHaveLength(4);
  });

  it("dates use one day form", () => {
    const now = new Date(2026, 10, 24, 12);
    expect(dayStamp("2026-11-15", now)).toBe("Sun 15 Nov");
    expect(dayStamp("2026-11-24", now)).toBe("Today");
  });
});
