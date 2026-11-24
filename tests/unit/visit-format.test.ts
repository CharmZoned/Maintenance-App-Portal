import { describe, expect, it } from "vitest";
import {
  formatVisit,
  formatVisitTime,
  formatVisitWindow,
  hasScheduledVisit,
  requestNextStep,
  visitChoiceFrom,
  visitFromChoice,
  visitInfo,
} from "@/lib/request-status";
import type { WorkOrder } from "@/types";

/** Local wall-clock instant as ISO (tests run in any timezone). */
function at(y: number, m: number, d: number, h = 0, min = 0): string {
  return new Date(y, m - 1, d, h, min).toISOString();
}

// Tue 24 Nov 2026, 3:30 pm local.
const NOW = new Date(2026, 10, 24, 15, 30);

const assigned = { status: "scheduled" as const, assigned_staff_id: 7 };

describe("formatVisit (UX-17)", () => {
  it("shows a day plus the arrival window", () => {
    expect(formatVisit({ ...assigned, scheduled_at: at(2026, 11, 25, 8), scheduled_end_at: at(2026, 11, 25, 12) }, { now: NOW })).toBe(
      "Wed 25 Nov · 8–12",
    );
    expect(formatVisit({ ...assigned, scheduled_at: at(2026, 11, 25, 12), scheduled_end_at: at(2026, 11, 25, 17) }, { now: NOW })).toBe(
      "Wed 25 Nov · 12–5",
    );
    expect(formatVisit({ ...assigned, scheduled_at: at(2026, 11, 25, 17), scheduled_end_at: at(2026, 11, 25, 20) }, { now: NOW })).toBe(
      "Wed 25 Nov · 5–8",
    );
  });

  it("says Today for a visit today, and marks it missed once the window ends", () => {
    expect(formatVisit({ ...assigned, scheduled_at: at(2026, 11, 24, 17), scheduled_end_at: at(2026, 11, 24, 20) }, { now: NOW })).toBe(
      "Today · 5–8",
    );
    expect(formatVisit({ ...assigned, scheduled_at: at(2026, 11, 24, 8), scheduled_end_at: at(2026, 11, 24, 12) }, { now: NOW })).toBe(
      "Today · 8–12 (missed)",
    );
    // Inside the window: not missed yet.
    expect(formatVisit({ ...assigned, scheduled_at: at(2026, 11, 24, 12), scheduled_end_at: at(2026, 11, 24, 17) }, { now: NOW })).toBe(
      "Today · 12–5",
    );
  });

  it("marks an earlier day missed instead of hiding it under Today", () => {
    expect(formatVisit({ ...assigned, scheduled_at: at(2026, 11, 23, 8), scheduled_end_at: at(2026, 11, 23, 12) }, { now: NOW })).toBe(
      "Mon 23 Nov · 8–12 (missed)",
    );
  });

  it("never marks a visit missed once work has started, paused or finished", () => {
    for (const status of ["in_progress", "on_hold", "closed"] as const) {
      expect(
        formatVisit({ status, assigned_staff_id: 7, scheduled_at: at(2026, 11, 23, 8), scheduled_end_at: at(2026, 11, 23, 12) }, { now: NOW }),
      ).toBe("Mon 23 Nov · 8–12");
    }
  });

  it("spells out am / pm outside the working day", () => {
    expect(formatVisitWindow(new Date(2026, 10, 25, 6), new Date(2026, 10, 25, 9))).toBe("6–9 am");
    expect(formatVisitWindow(new Date(2026, 10, 25, 18), new Date(2026, 10, 25, 21))).toBe("6–9 pm");
    expect(formatVisitWindow(new Date(2026, 10, 25, 7), new Date(2026, 10, 25, 13))).toBe("7 am–1 pm");
    expect(formatVisitWindow(new Date(2026, 10, 25, 9, 30), new Date(2026, 10, 25, 11))).toBe("9:30–11");
  });

  it("reads old rows: noon-UTC date-only shows the day, a bare start shows its time", () => {
    expect(formatVisit({ ...assigned, scheduled_at: "2026-11-25T12:00:00.000Z" }, { now: NOW })).toBe("Wed 25 Nov");
    expect(formatVisit({ ...assigned, scheduled_at: "2026-11-25" }, { now: NOW })).toBe("Wed 25 Nov");
    expect(formatVisit({ ...assigned, scheduled_at: at(2026, 11, 25, 14) }, { now: NOW })).toBe("Wed 25 Nov · 2 pm");
    // Without a window, a visit is missed only once its day is over.
    expect(formatVisit({ ...assigned, scheduled_at: at(2026, 11, 24, 9) }, { now: NOW })).toBe("Today · 9 am");
    expect(formatVisit({ ...assigned, scheduled_at: "2026-11-23" }, { now: NOW })).toBe("Mon 23 Nov (missed)");
  });

  it("adds the year outside this year and returns '' with no visit", () => {
    expect(formatVisit({ ...assigned, scheduled_at: at(2027, 1, 6, 8), scheduled_end_at: at(2027, 1, 6, 12) }, { now: NOW })).toBe(
      "Wed 6 Jan 2027 · 8–12",
    );
    expect(formatVisit({ scheduled_at: null }, { now: NOW })).toBe("");
  });

  it("gives the time alone for calendars and the local day key", () => {
    const v = { ...assigned, scheduled_at: at(2026, 11, 25, 12), scheduled_end_at: at(2026, 11, 25, 17) };
    expect(formatVisitTime(v)).toBe("12–5");
    expect(visitInfo(v, NOW)?.dayKey).toBe("2026-11-25");
    expect(formatVisitTime({ scheduled_at: "2026-11-25T12:00:00Z" })).toBeNull();
  });

  it("a New request (nobody assigned, maybe offered to the pool) has no scheduled visit", () => {
    expect(hasScheduledVisit({ status: "open", assigned_staff_id: null, scheduled_at: at(2026, 11, 25, 8) })).toBe(false);
    expect(hasScheduledVisit({ status: "open", assigned_staff_id: 3, scheduled_at: at(2026, 11, 25, 8) })).toBe(true);
    expect(hasScheduledVisit({ status: "scheduled", assigned_staff_id: 3, scheduled_at: null })).toBe(false);
  });

  it("is the words beside an Assigned chip", () => {
    const order = {
      id: 1,
      property_id: 1,
      unit_id: 1,
      tenant_id: 1,
      vendor_id: null,
      title: "Leak",
      description: null,
      category: "Plumbing",
      priority: "normal",
      status: "scheduled",
      permission_to_enter: false,
      assigned_staff_id: 2,
      scheduled_at: at(2026, 11, 25, 8),
      scheduled_end_at: at(2026, 11, 25, 12),
      completed_at: null,
      worker_price: null,
      landlord_price: null,
      notes: null,
      created_at: at(2026, 11, 20),
    } satisfies WorkOrder;
    expect(requestNextStep(order, { assigneeName: "Sam Fixit", now: NOW })).toBe("Wed 25 Nov · 8–12 · Sam Fixit");
  });
});

describe("visit picker values", () => {
  it("round-trips a preset window through local time", () => {
    const stored = visitFromChoice({ date: "2026-11-25", window: "afternoon", startTime: "", endTime: "" });
    expect(stored).toEqual({ scheduled_at: at(2026, 11, 25, 12), scheduled_end_at: at(2026, 11, 25, 17) });
    if ("error" in stored) throw new Error("unexpected");
    expect(visitChoiceFrom({ ...assigned, ...stored }, NOW)).toEqual({
      date: "2026-11-25",
      window: "afternoon",
      startTime: "12:00",
      endTime: "17:00",
    });
  });

  it("keeps a custom window and rejects one that ends before it starts", () => {
    expect(visitFromChoice({ date: "2026-11-25", window: "custom", startTime: "09:30", endTime: "11:00" })).toEqual({
      scheduled_at: at(2026, 11, 25, 9, 30),
      scheduled_end_at: at(2026, 11, 25, 11),
    });
    expect(visitFromChoice({ date: "2026-11-25", window: "custom", startTime: "11:00", endTime: "09:00" })).toEqual({
      error: "The window must end after it starts.",
    });
    expect(visitChoiceFrom({ scheduled_at: at(2026, 11, 25, 9, 30), scheduled_end_at: at(2026, 11, 25, 11) }, NOW).window).toBe(
      "custom",
    );
  });

  it("starts on Morning today, or Morning on the stored day for a date-only visit", () => {
    expect(visitChoiceFrom({ scheduled_at: null }, NOW)).toEqual({
      date: "2026-11-24",
      window: "morning",
      startTime: "08:00",
      endTime: "12:00",
    });
    expect(visitChoiceFrom({ scheduled_at: "2026-11-27T12:00:00.000Z" }, NOW).date).toBe("2026-11-27");
  });
});
