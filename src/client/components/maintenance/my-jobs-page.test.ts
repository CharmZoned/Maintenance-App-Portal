import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  groupJobs,
  jobContextLine,
  jobNextStep,
  jobPath,
  sortJobs,
} from "@/components/maintenance/my-jobs-page";
import {
  RequestActionsPanel,
  workerCanHold,
  workerPrimaryAction,
  type RequestActionsPanelProps,
} from "@/components/maintenance/request/request-actions-panel";
import { sectionsForRole } from "@/components/maintenance/request/role-visibility";
import type { WorkOrder } from "@/types";

function job(partial: Partial<WorkOrder> = {}): WorkOrder {
  return {
    id: 10,
    title: "Kitchen faucet leaking",
    property_id: 1,
    unit_id: 1,
    tenant_id: 1,
    vendor_id: null,
    description: null,
    category: "Plumbing",
    priority: "normal",
    status: "scheduled",
    permission_to_enter: true,
    assigned_staff_id: 4,
    request_number: "MR-001000",
    scheduled_at: "2099-11-17",
    completed_at: null,
    worker_price: 42,
    landlord_price: null,
    notes: null,
    created_at: "2026-11-14T14:12:00.000Z",
    property_name: "Maple Court",
    unit_name: "1A",
    tenant_first_name: "Tina",
    tenant_last_name: "Renter",
    ...partial,
  };
}

describe("My jobs routes to the one request page", () => {
  it("opens /maintenance/:id with the numeric id", () => {
    expect(jobPath(job({ id: 1006, request_number: "MR-001006" }))).toBe("/maintenance/1006");
  });

  it("writes the worker context line", () => {
    expect(jobContextLine(job())).toBe("Maple Court · Unit 1A · Tina Renter · OK to enter if absent");
    expect(jobContextLine(job({ unit_name: null, permission_to_enter: false, tenant_first_name: null, tenant_last_name: null }))).toBe(
      "Maple Court · Common area",
    );
  });

  it("never repeats the status as the next step", () => {
    expect(jobNextStep(job({ scheduled_at: null }))).toBe("Not scheduled yet");
    expect(jobNextStep(job({ status: "on_hold", hold_reason: "Waiting for part" }))).toContain("Waiting for part");
  });

  it("sorts by scheduled date within sections, unscheduled last", () => {
    const a = job({ id: 1, scheduled_at: "2099-11-20" });
    const b = job({ id: 2, scheduled_at: "2099-11-18" });
    const c = job({ id: 3, scheduled_at: null });
    expect(sortJobs([a, b, c], { key: "scheduled", dir: "asc" }).map((o) => o.id)).toEqual([2, 1, 3]);
    expect(sortJobs([a, b, c], { key: "scheduled", dir: "desc" }).map((o) => o.id)).toEqual([1, 2, 3]);
    const urgent = job({ id: 4, priority: "urgent" });
    expect(sortJobs([a, urgent], { key: "priority", dir: "asc" })[0].id).toBe(4);
  });

  it("groups into sections in display order", () => {
    const now = new Date(2026, 10, 24, 12);
    const groups = groupJobs(
      [
        job({ id: 1, status: "in_progress" }),
        job({ id: 2, status: "scheduled", scheduled_at: "2099-01-01" }),
        job({ id: 3, status: "on_hold" }),
        job({ id: 4, status: "closed", completed_at: "2026-11-23T10:00:00.000Z" }),
      ],
      { key: "scheduled", dir: "asc" },
      now,
    );
    expect(groups.map((g) => g.label)).toEqual(["Today", "Upcoming", "On hold", "Recently completed"]);
  });
});

function panel(props: Partial<RequestActionsPanelProps> & Pick<RequestActionsPanelProps, "role">): string {
  return renderToStaticMarkup(
    createElement(RequestActionsPanel, {
      visibility: sectionsForRole(props.role),
      status: "Assigned",
      dbStatus: "scheduled",
      onChangeStatus: () => undefined,
      ...props,
    }),
  );
}

describe("actions panel", () => {
  it("worker: one advancing button per status, hold only while working", () => {
    expect(workerPrimaryAction("New")).toBeNull();
    expect(workerCanHold("Assigned")).toBe(true);
    expect(workerCanHold("On hold")).toBe(false);

    const assigned = panel({ role: "maintenance", costLabel: "$42.00" });
    expect(assigned).toContain("Start work");
    expect(assigned).toContain("Put on hold");
    expect(assigned).toContain("$42.00");
    expect(assigned).not.toContain("Edit details");
    expect(assigned).not.toContain("Change status");

    const working = panel({ role: "maintenance", status: "In progress", dbStatus: "in_progress" });
    expect(working).toContain("Mark completed");
    expect(working).toContain("Not recorded");

    const held = panel({ role: "maintenance", status: "On hold", dbStatus: "on_hold" });
    expect(held).toContain("Resume work");
    expect(held).not.toContain("Put on hold");

    const pooled = panel({ role: "maintenance", status: "New", dbStatus: "open" });
    expect(pooled).not.toContain("Start work");
    expect(pooled).toContain("isn&#x27;t assigned to you yet");

    const done = panel({ role: "maintenance", status: "Completed", dbStatus: "closed" });
    expect(done).not.toContain("Start work");
    expect(done).not.toContain("Mark completed");
    expect(done).not.toContain("Put on hold");
  });

  it("admin New: Assign and schedule first, Change status under it, tappable values, edit and delete", () => {
    const html = panel({
      role: "admin",
      status: "New",
      dbStatus: "open",
      onAssign: () => undefined,
      onEditVendor: () => undefined,
      onEditCost: () => undefined,
      onEdit: () => undefined,
      onDelete: () => undefined,
    });
    expect(html.indexOf("Assign and schedule")).toBeGreaterThan(-1);
    expect(html.indexOf("Change status")).toBeGreaterThan(html.indexOf("Assign and schedule"));
    expect(html).toContain("None");
    expect(html).toContain("Add vendor");
    expect(html).toContain("Not recorded");
    expect(html).toContain("Add cost");
    expect(html).toContain("Edit details");
    expect(html).toContain("Delete");
    // Only one "Change status" control: no select, no extra status buttons.
    expect(html).not.toContain("<select");
    expect(html).not.toContain("Start work");
  });

  it("admin with values: Change and Edit links", () => {
    const html = panel({
      role: "admin",
      status: "In progress",
      dbStatus: "in_progress",
      vendorLabel: "Acme Plumbing",
      costLabel: "Worker $42.00 · Landlord $55.00",
      onEditVendor: () => undefined,
      onEditCost: () => undefined,
    });
    expect(html).not.toContain("Assign and schedule");
    expect(html).toContain("Change status");
    expect(html).toContain("Acme Plumbing");
    expect(html).toContain(">Change<");
    expect(html).toContain("Worker $42.00 · Landlord $55.00");
    expect(html).toContain(">Edit<");
  });

  it("tenant and landlord: no panel", () => {
    expect(panel({ role: "tenant" })).toBe("");
    expect(panel({ role: "landlord" })).toBe("");
  });
});
