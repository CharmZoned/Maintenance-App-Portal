import { describe, expect, test } from "vitest";
import type {
  DashboardCalendarEvent,
  DashboardEventKind,
} from "@/components/dashboard/admin-dashboard-model";
import {
  EVENT_KINDS,
  activeFilterKinds,
  countEventsInMonth,
  dayButtonLabel,
  dayForKey,
  eventCountLabel,
  firstDayOfMonth,
  groupEventsByDay,
  isDayInMonth,
  monthOfDay,
  monthWeeks,
  shiftMonth,
  toggleKindFilter,
} from "@/components/dashboard/calendar-month";

function event(id: string, kind: DashboardEventKind, day: string): DashboardCalendarEvent {
  return { id, kind, day, title: id, record: "", details: [], actionLabel: "Open", href: "/" };
}

const NOVEMBER = { year: 2026, monthIndex: 10 };

describe("calendar-month · months", () => {
  test("month of a day, and stepping across a year boundary", () => {
    expect(monthOfDay("2026-11-16")).toEqual(NOVEMBER);
    expect(shiftMonth(NOVEMBER, 1)).toEqual({ year: 2026, monthIndex: 11 });
    expect(shiftMonth(NOVEMBER, 2)).toEqual({ year: 2027, monthIndex: 0 });
    expect(shiftMonth({ year: 2026, monthIndex: 0 }, -1)).toEqual({ year: 2025, monthIndex: 11 });
    expect(firstDayOfMonth(NOVEMBER)).toBe("2026-11-01");
  });

  test("isDayInMonth", () => {
    expect(isDayInMonth("2026-11-30", NOVEMBER)).toBe(true);
    expect(isDayInMonth("2026-12-01", NOVEMBER)).toBe(false);
    expect(isDayInMonth("2025-11-16", NOVEMBER)).toBe(false);
  });

  test("November 2026 starts on a Sunday: six Monday-first weeks", () => {
    const weeks = monthWeeks(NOVEMBER);
    expect(weeks).toHaveLength(6);
    expect(weeks.every((week) => week.length === 7)).toBe(true);
    expect(weeks[0]).toEqual([null, null, null, null, null, null, "2026-11-01"]);
    expect(weeks[1][0]).toBe("2026-11-02");
    expect(weeks[3][0]).toBe("2026-11-16");
    expect(weeks[5]).toEqual(["2026-11-30", null, null, null, null, null, null]);
  });

  test("a 28-day February that starts on a Monday needs four weeks", () => {
    const weeks = monthWeeks({ year: 2027, monthIndex: 1 });
    expect(weeks).toHaveLength(4);
    expect(weeks[0][0]).toBe("2027-02-01");
    expect(weeks[3][6]).toBe("2027-02-28");
  });

  test("leap February has 29 days", () => {
    const days = monthWeeks({ year: 2028, monthIndex: 1 }).flat().filter(Boolean);
    expect(days).toHaveLength(29);
    expect(days[28]).toBe("2028-02-29");
  });
});

describe("calendar-month · filters", () => {
  test("no hidden kinds means no chip is pressed", () => {
    expect(activeFilterKinds([])).toEqual([]);
    expect(activeFilterKinds(["visit", "rent_due", "lease_start", "lease_end", "move_in"])).toEqual([
      "follow_up",
    ]);
  });

  test("pressing the first chip shows only that kind", () => {
    const hidden = toggleKindFilter([], "follow_up");
    expect(hidden).toEqual(["visit", "rent_due", "lease_start", "lease_end", "move_in"]);
    expect(activeFilterKinds(hidden)).toEqual(["follow_up"]);
  });

  test("pressing a second chip adds its kind; releasing one removes it", () => {
    const one = toggleKindFilter([], "follow_up");
    const two = toggleKindFilter(one, "visit");
    expect(activeFilterKinds(two)).toEqual(["visit", "follow_up"]);
    expect(activeFilterKinds(toggleKindFilter(two, "follow_up"))).toEqual(["visit"]);
  });

  test("releasing the last pressed chip clears the filter", () => {
    expect(toggleKindFilter(toggleKindFilter([], "rent_due"), "rent_due")).toEqual([]);
  });

  test("pressing every chip is the same as no filter", () => {
    const hidden = EVENT_KINDS.reduce<DashboardEventKind[]>(
      (acc, kind) => toggleKindFilter(acc, kind),
      [],
    );
    expect(hidden).toEqual([]);
  });

  test("everything hidden (preview only): pressing a chip shows that kind", () => {
    expect(activeFilterKinds([...EVENT_KINDS])).toEqual([]);
    expect(activeFilterKinds(toggleKindFilter([...EVENT_KINDS], "move_in"))).toEqual(["move_in"]);
  });
});

describe("calendar-month · events", () => {
  const events = [
    event("rent", "rent_due", "2026-11-01"),
    event("assign", "follow_up", "2026-11-16"),
    event("visit", "visit", "2026-11-16"),
    event("december", "follow_up", "2026-12-02"),
  ];

  test("groups by day in input order", () => {
    const byDay = groupEventsByDay(events);
    expect(byDay.get("2026-11-16")?.map((e) => e.id)).toEqual(["assign", "visit"]);
    expect(byDay.get("2026-11-17")).toBeUndefined();
  });

  test("leaves out hidden kinds", () => {
    const byDay = groupEventsByDay(events, ["follow_up"]);
    expect(byDay.get("2026-11-16")?.map((e) => e.id)).toEqual(["visit"]);
    expect(byDay.has("2026-12-02")).toBe(false);
  });

  test("counts only the month asked for", () => {
    expect(countEventsInMonth(groupEventsByDay(events), NOVEMBER)).toBe(3);
    expect(countEventsInMonth(groupEventsByDay(events, ["follow_up"]), NOVEMBER)).toBe(2);
    expect(countEventsInMonth(groupEventsByDay(events), { year: 2027, monthIndex: 0 })).toBe(0);
  });

  test("labels", () => {
    expect(eventCountLabel(0)).toBe("No events");
    expect(eventCountLabel(1)).toBe("1 event");
    expect(eventCountLabel(3)).toBe("3 events");
    expect(dayButtonLabel("2026-11-17", 1)).toBe("Tuesday 17 November 2026, 1 event");
    expect(dayButtonLabel("2026-11-18", 0)).toBe("Wednesday 18 November 2026, no events");
  });
});

describe("calendar-month · keyboard", () => {
  test("arrows step a day or a week, across months", () => {
    expect(dayForKey("2026-11-17", "ArrowLeft")).toBe("2026-11-16");
    expect(dayForKey("2026-11-30", "ArrowRight")).toBe("2026-12-01");
    expect(dayForKey("2026-11-03", "ArrowUp")).toBe("2026-10-27");
    expect(dayForKey("2026-11-17", "ArrowDown")).toBe("2026-11-24");
  });

  test("Home and End go to the Monday and Sunday of the week", () => {
    expect(dayForKey("2026-11-18", "Home")).toBe("2026-11-16");
    expect(dayForKey("2026-11-18", "End")).toBe("2026-11-22");
    expect(dayForKey("2026-11-22", "Home")).toBe("2026-11-16");
    expect(dayForKey("2026-11-16", "End")).toBe("2026-11-22");
  });

  test("Page Up and Page Down step a month, clamped to its last day", () => {
    expect(dayForKey("2026-11-17", "PageDown")).toBe("2026-12-17");
    expect(dayForKey("2027-01-31", "PageDown")).toBe("2027-02-28");
    expect(dayForKey("2026-12-31", "PageUp")).toBe("2026-11-30");
  });

  test("other keys are ignored", () => {
    expect(dayForKey("2026-11-17", "Enter")).toBeNull();
    expect(dayForKey("2026-11-17", "a")).toBeNull();
  });
});
