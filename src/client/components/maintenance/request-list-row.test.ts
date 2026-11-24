import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RequestListTable, listNextStep } from "@/components/maintenance/request-list-row";
import {
  nextSort,
  presetToSort,
  readStoredSort,
  sortRecommended,
  sortRequests,
  sortToPreset,
} from "@/components/maintenance/request-list-sort";
import type { WorkOrder } from "@/types";

function wo(partial: Partial<WorkOrder> = {}): WorkOrder {
  return {
    id: 1,
    request_number: "MR-001000",
    title: "Kitchen faucet leaking",
    property_id: 1,
    unit_id: 1,
    tenant_id: 1,
    vendor_id: null,
    description: null,
    category: "Plumbing",
    priority: "normal",
    status: "open",
    permission_to_enter: true,
    assigned_staff_id: null,
    scheduled_at: null,
    completed_at: null,
    worker_price: null,
    landlord_price: null,
    notes: null,
    created_at: "2026-11-14T09:00:00Z",
    property_name: "Maple Court",
    unit_name: "1A",
    tenant_first_name: "Tina",
    tenant_last_name: "Renter",
    ...partial,
  };
}

describe("request list sorting", () => {
  const a = wo({ id: 1, created_at: "2026-11-10T09:00:00Z", priority: "normal", title: "B" });
  const b = wo({ id: 2, created_at: "2026-11-12T09:00:00Z", priority: "urgent", title: "A" });
  const c = wo({ id: 3, created_at: "2026-11-11T09:00:00Z", priority: "high", status: "in_progress", assigned_staff_id: 5 });

  it("sorts newest / oldest / priority / status", () => {
    expect(sortRequests([a, b, c], { field: "created", dir: "desc" }).map((o) => o.id)).toEqual([2, 3, 1]);
    expect(sortRequests([a, b, c], { field: "created", dir: "asc" }).map((o) => o.id)).toEqual([1, 3, 2]);
    expect(sortRequests([a, b, c], { field: "priority", dir: "desc" }).map((o) => o.id)).toEqual([2, 3, 1]);
    expect(sortRequests([a, b, c], { field: "status", dir: "asc" }).map((o) => o.id)).toEqual([2, 1, 3]);
  });

  it("puts Emergency first, then oldest, for Needs action", () => {
    expect(sortRecommended([a, b, c], "emergency-then-oldest").map((o) => o.id)).toEqual([2, 1, 3]);
  });

  it("puts In progress first for Active", () => {
    expect(sortRecommended([a, b, c], "in-progress-then-scheduled")[0]!.id).toBe(3);
  });

  it("flips direction on the same header and maps presets", () => {
    expect(nextSort(null, "created")).toEqual({ field: "created", dir: "desc" });
    expect(nextSort({ field: "created", dir: "desc" }, "created")).toEqual({ field: "created", dir: "asc" });
    expect(sortToPreset(presetToSort("oldest"))).toBe("oldest");
    expect(sortToPreset(null)).toBe("recommended");
  });

  it("survives missing browser storage", () => {
    expect(readStoredSort("nope")).toBeNull();
  });
});

describe("request list row", () => {
  it("leaves the name out of the desktop next step and says what is missing", () => {
    const assigned = wo({ status: "scheduled", assigned_staff_id: 5 });
    expect(listNextStep(assigned, "Sam Fixit", false)).toBe("Not scheduled yet");
    expect(listNextStep(assigned, "Sam Fixit", true)).toBe("Sam Fixit");
  });

  it("renders one link per layout to the request page, with assignee, date and Emergency", () => {
    const html = renderToStaticMarkup(
      createElement(RequestListTable, {
        items: [
          {
            order: wo({ id: 42, priority: "urgent", status: "scheduled", assigned_staff_id: 5 }),
            context: "Maple Court · Unit 1A · Tina Renter",
            assigneeName: "Sam Fixit",
          },
        ],
        onOpen: () => undefined,
        sort: null,
        onSortChange: () => undefined,
        ariaLabel: "Maintenance requests",
      }),
    );
    expect(html.match(/href="\/maintenance\/42"/g)?.length).toBe(2);
    expect(html).toContain("Sam Fixit");
    expect(html).toContain("SF");
    expect(html).toContain("Emergency");
    expect(html).not.toContain("Urgent");
    expect(html).toContain("Assigned");
    expect(html).toContain("Opened");
    expect(html).not.toContain("Assigned (staff)");
  });

  it("shows Not assigned when nobody is on the job", () => {
    const html = renderToStaticMarkup(
      createElement(RequestListTable, {
        items: [{ order: wo(), context: "Maple Court", assigneeName: null }],
        onOpen: () => undefined,
        sort: null,
        onSortChange: () => undefined,
        ariaLabel: "x",
      }),
    );
    expect(html).toContain("Not assigned");
    expect(html).toContain("New");
  });
});
