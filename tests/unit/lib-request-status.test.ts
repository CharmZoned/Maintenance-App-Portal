import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  compareCreatedDesc,
  formatActivityStamp,
  isOpenRequest,
  priorityLevel,
  requestNextStep,
  toRequestStatus,
  unitPropertyLabel,
} from "@/lib/request-status";
import type { WorkOrder } from "@/types";

function wo(partial: Partial<WorkOrder>): WorkOrder {
  return {
    id: 1,
    property_id: 1,
    unit_id: 1,
    tenant_id: 1,
    vendor_id: null,
    title: "Leak",
    description: null,
    category: "Plumbing",
    priority: "normal",
    status: "open",
    permission_to_enter: false,
    assigned_staff_id: null,
    scheduled_at: null,
    completed_at: null,
    worker_price: null,
    landlord_price: null,
    notes: null,
    created_at: "2026-11-14T12:00:00Z",
    ...partial,
  };
}

describe("request-status helpers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 14, 15, 30, 0)); // local Nov 14 2026
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("maps DB status + assignee to Figma RequestStatus", () => {
    expect(toRequestStatus(wo({ status: "open", assigned_staff_id: null }))).toBe("New");
    expect(toRequestStatus(wo({ status: "open", assigned_staff_id: 3 }))).toBe("Assigned");
    expect(toRequestStatus(wo({ status: "scheduled", assigned_staff_id: 3 }))).toBe("Assigned");
    expect(toRequestStatus(wo({ status: "in_progress" }))).toBe("In progress");
    expect(toRequestStatus(wo({ status: "on_hold" }))).toBe("On hold");
    expect(toRequestStatus(wo({ status: "closed" }))).toBe("Completed");
  });

  it("treats non-closed as open", () => {
    expect(isOpenRequest(wo({ status: "open" }))).toBe(true);
    expect(isOpenRequest(wo({ status: "closed" }))).toBe(false);
  });

  it("maps priority chips", () => {
    expect(priorityLevel("urgent")).toBe("Emergency");
    expect(priorityLevel("high")).toBe("High");
    expect(priorityLevel("normal")).toBe(null);
  });

  it("formats unit · property labels", () => {
    expect(unitPropertyLabel("4B", "Oak Street")).toBe("Unit 4B · Oak Street");
    expect(unitPropertyLabel(null, "Oak Street")).toBe("Oak Street");
    expect(unitPropertyLabel(null, null)).toBe("Your home");
  });

  it("does not surface draft resolution notes while in progress", () => {
    expect(
      requestNextStep(
        wo({ status: "in_progress", resolution_notes: "Will seal tomorrow" }),
      ),
    ).toBeUndefined();
    expect(
      requestNextStep(
        wo({ status: "closed", resolution_notes: "Sealed and tested" }),
      ),
    ).toBe("Sealed and tested");
  });

  it("words the next step per status (spec §1)", () => {
    expect(requestNextStep(wo({ status: "open" }))).toBe("Not assigned yet");
    expect(requestNextStep(wo({ status: "scheduled", assigned_staff_id: 2 }))).toBe("Not scheduled yet");
    expect(
      requestNextStep(wo({ status: "scheduled", assigned_staff_id: 2, scheduled_at: "2026-11-14" }), {
        assigneeName: "Sam Fixit",
      }),
    ).toBe("Today · Sam Fixit");
    expect(
      requestNextStep(wo({ status: "scheduled", assigned_staff_id: 2, scheduled_at: "2026-11-14" }), {
        assigneeName: "Sam Fixit",
        omitAssignee: true,
      }),
    ).toBe("Today");
    expect(
      requestNextStep(wo({ status: "in_progress", assigned_staff_id: 2 }), {
        assigneeName: "Sam Fixit",
        startedAt: "2026-11-14T09:40:00",
      }),
    ).toBe("Started today · Sam Fixit");
    expect(requestNextStep(wo({ status: "in_progress" }), { assigneeName: "Sam Fixit" })).toBe("Sam Fixit");
    expect(requestNextStep(wo({ status: "on_hold", hold_reason: "waiting for part" }))).toBe("Waiting for part");
    expect(
      requestNextStep(wo({ status: "closed", completed_at: "2026-11-14T10:00:00", resolution_notes: "Fixed it" })),
    ).toBe("Today · Fixed it");
  });

  it("formats date-only schedules without a midnight clock", () => {
    expect(formatActivityStamp("2026-11-14")).toBe("Today");
    expect(formatActivityStamp("2026-11-13")).toBe("Yesterday");
    expect(formatActivityStamp("2026-11-17")).toMatch(/17/);
  });

  it("treats noon-UTC date sentinel like date-only (no clock)", () => {
    expect(formatActivityStamp("2026-11-14T12:00:00.000Z")).toBe("Today");
    expect(formatActivityStamp("2026-11-14T12:00:00+00:00")).toBe("Today");
    expect(formatActivityStamp("2026-11-14T12:00:00.000000+00:00")).toBe("Today");
    expect(formatActivityStamp("2026-11-13T12:00:00.000Z")).toBe("Yesterday");
    const future = formatActivityStamp("2026-11-20T12:00:00+00:00");
    expect(future).toMatch(/20/);
    expect(future).toMatch(/Nov|11/);
    expect(future).toMatch(/Mon|Tue|Wed|Thu|Fri|Sat|Sun/);
    expect(future).not.toMatch(/\d{1,2}:\d{2}/);
    expect(future).not.toMatch(/AM|PM/i);
    // Real timed stamp still includes a clock on today.
    expect(formatActivityStamp("2026-11-14T20:30:00.000Z")).toMatch(/^Today /);
  });

  it("sorts newest first and ties on id", () => {
    const a = { created_at: "2026-11-14T10:00:00Z", id: 1 };
    const b = { created_at: "2026-11-14T12:00:00Z", id: 2 };
    expect(compareCreatedDesc(a, b)).toBe(1);
    expect(compareCreatedDesc(b, a)).toBe(-1);
    expect(compareCreatedDesc({ created_at: "x", id: 2 }, { created_at: "x", id: 1 })).toBe(-1);
  });
});
