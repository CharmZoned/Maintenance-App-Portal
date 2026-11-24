import { describe, expect, test } from "vitest";
import {
  compareNeedsAction,
  daysSince,
  priorityChipLevel,
  relativeAge,
  requestAge,
  requestAssignee,
  requestPlaceLine,
  sortForQueueTab,
  staffDisplayName,
  STALE_AFTER_DAYS,
} from "@/components/maintenance/maintenance-list";
import type { WorkOrder } from "@/types";

/** Local noon so day boundaries are stable in any timezone. */
const NOW = new Date(2026, 10, 24, 12, 0, 0); // Tue 24 Nov 2026

function localIso(y: number, m: number, d: number, h = 9, min = 30): string {
  return new Date(y, m, d, h, min, 0).toISOString();
}

type Row = Pick<WorkOrder, "id" | "priority" | "created_at">;
function row(id: number, priority: WorkOrder["priority"], created_at: string): Row {
  return { id, priority, created_at };
}

describe("daysSince", () => {
  test("counts local calendar days, not 24h blocks", () => {
    expect(daysSince(localIso(2026, 10, 24, 0, 5), NOW)).toBe(0);
    expect(daysSince(localIso(2026, 10, 23, 23, 55), NOW)).toBe(1);
    expect(daysSince(localIso(2026, 10, 21), NOW)).toBe(3);
  });

  test("accepts date-only strings", () => {
    expect(daysSince("2026-11-20", NOW)).toBe(4);
  });

  test("future dates count as today; missing or bad dates are null", () => {
    expect(daysSince(localIso(2026, 10, 26), NOW)).toBe(0);
    expect(daysSince(null, NOW)).toBeNull();
    expect(daysSince("not a date", NOW)).toBeNull();
  });
});

describe("relativeAge", () => {
  test.each([
    [0, "today"],
    [1, "yesterday"],
    [2, "2 days ago"],
    [13, "13 days ago"],
    [14, "2 weeks ago"],
    [59, "8 weeks ago"],
    [60, "2 months ago"],
    [329, "10 months ago"],
    [364, "11 months ago"],
    [365, "1 year ago"],
    [400, "1 year ago"],
    [730, "2 years ago"],
  ])("%i days → %s", (days, label) => {
    expect(relativeAge(days)).toBe(label);
  });
});

describe("requestAge", () => {
  test("open requests say when they were opened, with the absolute date as a title", () => {
    const age = requestAge(
      { status: "open", created_at: localIso(2026, 10, 21), completed_at: null },
      NOW,
    );
    expect(age).toEqual({
      label: "Opened 3 days ago",
      title: "Opened Sat 21 Nov 2026",
      stale: false,
    });
  });

  test("completed requests say when they were completed", () => {
    const age = requestAge(
      {
        status: "closed",
        created_at: localIso(2026, 9, 1),
        completed_at: localIso(2026, 10, 23),
      },
      NOW,
    );
    expect(age.label).toBe("Completed yesterday");
    expect(age.stale).toBe(false);
  });

  test("completed without a completion date falls back to opened", () => {
    const age = requestAge(
      { status: "closed", created_at: localIso(2026, 10, 24), completed_at: null },
      NOW,
    );
    expect(age.label).toBe("Opened today");
  });

  test(`requests still being worked turn stale after ${STALE_AFTER_DAYS} days; on hold never does`, () => {
    const old = localIso(2026, 10, 24 - STALE_AFTER_DAYS);
    const younger = localIso(2026, 10, 24 - STALE_AFTER_DAYS + 1);
    expect(requestAge({ status: "open", created_at: old, completed_at: null }, NOW).stale).toBe(true);
    expect(requestAge({ status: "in_progress", created_at: old, completed_at: null }, NOW).stale).toBe(true);
    expect(requestAge({ status: "open", created_at: younger, completed_at: null }, NOW).stale).toBe(false);
    expect(requestAge({ status: "on_hold", created_at: old, completed_at: null }, NOW).stale).toBe(false);
  });

  test("no usable date → empty label", () => {
    expect(requestAge({ status: "open", created_at: "", completed_at: null }, NOW)).toEqual({
      label: "",
      title: "",
      stale: false,
    });
  });
});

describe("compareNeedsAction / sortForQueueTab", () => {
  const list: Row[] = [
    row(1, "normal", localIso(2026, 10, 23)),
    row(2, "low", localIso(2026, 10, 1)),
    row(3, "high", localIso(2026, 10, 24)),
    row(4, "urgent", localIso(2026, 10, 24)),
    row(5, "normal", localIso(2026, 10, 20)),
    row(6, "high", localIso(2026, 10, 22)),
  ];

  test("emergency, then high, normal, low; oldest first within a priority", () => {
    expect(sortForQueueTab(list, "needs").map((r) => r.id)).toEqual([4, 6, 3, 5, 1, 2]);
  });

  test("every priority that sorts away from normal shows a chip explaining why", () => {
    const sorted = sortForQueueTab(list, "needs");
    expect(sorted.map((r) => priorityChipLevel(r.priority))).toEqual([
      "Emergency",
      "High",
      "High",
      null,
      null,
      "Low",
    ]);
  });

  test("ties on priority and time fall back to id", () => {
    const at = localIso(2026, 10, 20);
    expect(compareNeedsAction(row(9, "normal", at), row(7, "normal", at))).toBeGreaterThan(0);
  });

  test("other tabs keep the loaded order and never mutate the input", () => {
    const before = list.map((r) => r.id);
    for (const tab of ["active", "completed", "all"] as const) {
      expect(sortForQueueTab(list, tab).map((r) => r.id)).toEqual(before);
    }
    sortForQueueTab(list, "needs");
    expect(list.map((r) => r.id)).toEqual(before);
  });
});

describe("requestAssignee", () => {
  const staff = new Map([[4, { first_name: "Sam", last_name: "Fixit" }]]);

  test("assigned team member by name", () => {
    expect(requestAssignee({ assigned_staff_id: 4, vendor_name: null }, staff)).toEqual({
      label: "Sam Fixit",
      unassigned: false,
    });
  });

  test("team member the staff list has not loaded", () => {
    expect(requestAssignee({ assigned_staff_id: 99 }, staff)).toEqual({
      label: "Team member",
      unassigned: false,
    });
  });

  test("vendor when no team member", () => {
    expect(requestAssignee({ assigned_staff_id: null, vendor_name: " Ace Plumbing " }, staff)).toEqual({
      label: "Ace Plumbing",
      unassigned: false,
    });
  });

  test("nobody → Unassigned", () => {
    expect(requestAssignee({ assigned_staff_id: null, vendor_name: null }, staff)).toEqual({
      label: "Unassigned",
      unassigned: true,
    });
  });
});

describe("staffDisplayName / requestPlaceLine", () => {
  test("first name first", () => {
    expect(staffDisplayName({ first_name: "Riley", last_name: "Wrench" })).toBe("Riley Wrench");
    expect(staffDisplayName({ first_name: "", last_name: "" })).toBe("Team member");
  });

  test("place, unit and tenant joined with middots", () => {
    expect(
      requestPlaceLine({
        property_name: "Maple Court",
        unit_name: "2B",
        tenant_first_name: "Tom",
        tenant_last_name: "Lodger",
      }),
    ).toBe("Maple Court · Unit 2B · Tom Lodger");
    expect(requestPlaceLine({ property_name: "Birch House", unit_name: "Main" })).toBe(
      "Birch House · Unit Main",
    );
    expect(requestPlaceLine({})).toBe("—");
  });
});

describe("priorityChipLevel", () => {
  test.each([
    ["urgent", "Emergency"],
    ["high", "High"],
    ["normal", null],
    ["low", "Low"],
    ["unexpected", null],
  ] as const)("%s → %s", (priority, level) => {
    expect(priorityChipLevel(priority)).toBe(level);
  });
});
