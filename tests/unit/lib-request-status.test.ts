import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  compareCreatedDesc,
  formatActivityStamp,
  isOpenRequest,
  landlordNextStep,
  priorityLabel,
  priorityLevel,
  requestNextStep,
  statusLabel,
  toRequestStatus,
  unitPropertyLabel,
} from "@/lib/request-status";
import { toRequestStatus as componentToRequestStatus } from "@/components/maintenance/request-status";
import { formatDate } from "@/lib/utils";
import { WORK_ORDER_STATUSES, type WorkOrder, type WorkOrderPriority } from "@/types";

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
    ).toBe("Work in progress");
    expect(
      requestNextStep(
        wo({ status: "closed", resolution_notes: "Sealed and tested" }),
      ),
    ).toBe("Sealed and tested");
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

const NOTHING = "Nothing needed from you.";
const day = (key: string) => formatDate(key, { weekday: "short", day: "numeric", month: "short" });

describe("statusLabel (D4)", () => {
  it("maps every DB status to the same word for every audience", () => {
    const expected = {
      open: "New",
      scheduled: "Assigned",
      in_progress: "In progress",
      on_hold: "On hold",
      closed: "Completed",
    } as const;
    for (const audience of ["tenant", "landlord", "staff"] as const) {
      for (const status of WORK_ORDER_STATUSES) {
        expect(statusLabel(status, audience)).toBe(expected[status]);
      }
    }
  });

  it("reads an open request with an assignee as Assigned when given the order", () => {
    expect(statusLabel({ status: "open", assigned_staff_id: 4 }, "landlord")).toBe("Assigned");
    expect(statusLabel({ status: "open", assigned_staff_id: null }, "tenant")).toBe("New");
  });

  it("keeps both toRequestStatus exports on the same source", () => {
    for (const status of WORK_ORDER_STATUSES) {
      for (const assigned_staff_id of [null, 7]) {
        const order = wo({ status, assigned_staff_id });
        expect(toRequestStatus(order)).toBe(statusLabel(order, "staff"));
        expect(componentToRequestStatus(order)).toBe(statusLabel(order, "staff"));
      }
    }
  });

  it("never returns a raw DB value", () => {
    for (const status of WORK_ORDER_STATUSES) {
      expect(["New", "Assigned", "In progress", "On hold", "Completed"]).toContain(
        statusLabel(status, "landlord"),
      );
    }
  });
});

describe("priorityLabel (D5)", () => {
  it("prints Normal / High / Emergency, never the DB value", () => {
    const cases: [WorkOrderPriority, string][] = [
      ["low", "Normal"],
      ["normal", "Normal"],
      ["high", "High"],
      ["urgent", "Emergency"],
    ];
    for (const [db, label] of cases) {
      expect(priorityLabel(db)).toBe(label);
      expect(priorityLabel(db)).not.toBe("Urgent");
    }
  });

  it("keeps priorityLevel as the chip view of priorityLabel", () => {
    expect(priorityLevel("low")).toBe(null);
    expect(priorityLevel("normal")).toBe(null);
    expect(priorityLevel("high")).toBe("High");
    expect(priorityLevel("urgent")).toBe("Emergency");
  });
});

describe("landlordNextStep", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 14, 15, 30, 0));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("New: the office will assign someone", () => {
    expect(landlordNextStep(wo({ status: "open" }))).toEqual({
      who: "office",
      text: `Landlord Gopher will assign someone. ${NOTHING}`,
    });
  });

  it("Assigned without a visit date: the office is booking one", () => {
    for (const order of [
      wo({ status: "open", assigned_staff_id: 3 }),
      wo({ status: "scheduled", assigned_staff_id: 3 }),
    ]) {
      expect(landlordNextStep(order)).toEqual({
        who: "office",
        text: `Landlord Gopher is booking a visit. ${NOTHING}`,
      });
    }
  });

  it("Assigned with a visit date: the worker has it", () => {
    for (const scheduled_at of ["2026-11-17", "2026-11-17T12:00:00.000Z", "2026-11-17T12:00:00+00:00"]) {
      expect(landlordNextStep(wo({ status: "scheduled", assigned_staff_id: 3, scheduled_at }))).toEqual({
        who: "worker",
        text: `Visit booked for ${day("2026-11-17")}. ${NOTHING}`,
      });
    }
  });

  it("In progress: the worker is on it", () => {
    expect(landlordNextStep(wo({ status: "in_progress", resolution_notes: "draft" }))).toEqual({
      who: "worker",
      text: `The work is under way. ${NOTHING}`,
    });
  });

  it("Completed: nobody", () => {
    expect(landlordNextStep(wo({ status: "closed", hold_reason: "old reason" }))).toEqual({
      who: "none",
      text: `This job is done. ${NOTHING}`,
    });
  });

  describe("On hold", () => {
    const follow = "2026-11-17";

    it("no reason, no follow-up", () => {
      expect(landlordNextStep(wo({ status: "on_hold" }))).toEqual({
        who: "office",
        text: `Landlord Gopher has paused this job. ${NOTHING}`,
      });
      expect(landlordNextStep(wo({ status: "on_hold", hold_reason: "   " }))).toEqual({
        who: "office",
        text: `Landlord Gopher has paused this job. ${NOTHING}`,
      });
    });

    it("no reason, with follow-up", () => {
      expect(landlordNextStep(wo({ status: "on_hold", next_follow_up_date: follow }))).toEqual({
        who: "office",
        text: `Landlord Gopher has paused this job. Next check-in ${day(follow)}. ${NOTHING}`,
      });
    });

    it("waiting reason, no follow-up (plan example)", () => {
      expect(landlordNextStep(wo({ status: "on_hold", hold_reason: "Waiting on a part" }))).toEqual({
        who: "office",
        text: `Landlord Gopher is waiting on a part. ${NOTHING}`,
      });
    });

    it("waiting reason, with follow-up (date-only and noon-UTC)", () => {
      for (const next_follow_up_date of [follow, "2026-11-17T12:00:00.000Z"]) {
        expect(
          landlordNextStep(wo({ status: "on_hold", hold_reason: "waiting for part…", next_follow_up_date })),
        ).toEqual({
          who: "office",
          text: `Landlord Gopher is waiting for part. Next check-in ${day(follow)}. ${NOTHING}`,
        });
      }
    });

    it("other reason wording", () => {
      expect(landlordNextStep(wo({ status: "on_hold", hold_reason: "Part on order." }))).toEqual({
        who: "office",
        text: `On hold: Part on order. ${NOTHING}`,
      });
      expect(
        landlordNextStep(
          wo({ status: "on_hold", hold_reason: "Tenant access  needed", next_follow_up_date: follow }),
        ),
      ).toEqual({
        who: "office",
        text: `On hold: Tenant access needed. Next check-in ${day(follow)}. ${NOTHING}`,
      });
    });

    it("waiting on the landlord asks them to answer", () => {
      expect(
        landlordNextStep(wo({ status: "on_hold", hold_reason: "Waiting on owner approval of the quote" })),
      ).toEqual({
        who: "landlord",
        text: "Landlord Gopher is waiting on owner approval of the quote. Message Landlord Gopher to answer.",
      });
      expect(
        landlordNextStep(
          wo({ status: "on_hold", hold_reason: "Landlord go-ahead needed", next_follow_up_date: follow }),
        ),
      ).toEqual({
        who: "landlord",
        text: `On hold: Landlord go-ahead needed. Next check-in ${day(follow)}. Message Landlord Gopher to answer.`,
      });
    });

    it("ignores a malformed follow-up date", () => {
      expect(
        landlordNextStep(wo({ status: "on_hold", hold_reason: "Waiting on a part", next_follow_up_date: "soon" })),
      ).toEqual({ who: "office", text: `Landlord Gopher is waiting on a part. ${NOTHING}` });
    });
  });

  it("covers every status x hold combination with a sentence and a valid who", () => {
    const holds = [
      { hold_reason: null, next_follow_up_date: null },
      { hold_reason: "Waiting on a part", next_follow_up_date: null },
      { hold_reason: null, next_follow_up_date: "2026-11-17" },
      { hold_reason: "Waiting on landlord approval", next_follow_up_date: "2026-11-17" },
    ];
    for (const status of WORK_ORDER_STATUSES) {
      for (const assigned_staff_id of [null, 2]) {
        for (const hold of holds) {
          const step = landlordNextStep(wo({ status, assigned_staff_id, ...hold }));
          expect(["office", "worker", "landlord", "none"]).toContain(step.who);
          expect(step.text).toMatch(/\.$/);
          expect(step.text).not.toMatch(/on_hold|in_progress|urgent|undefined|null/);
          if (status !== "on_hold") {
            // Hold fields only speak while the request is on hold.
            expect(step.text).not.toContain("part");
            expect(step.text).not.toContain("check-in");
            expect(step.who).not.toBe("landlord");
          }
        }
      }
    }
  });
});
