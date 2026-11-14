import { describe, expect, test } from "vitest";
import {
  formatRelativeWhen,
  formatScheduleWhen,
  jobSectionFor,
  parseWhenDate,
} from "@/components/maintenance/request-status";

/** Local noon so same-day / past / future checks are stable. */
const NOW = new Date(2026, 10, 14, 12, 0, 0); // Sat Nov 14, 2026

function localIso(y: number, m: number, d: number, h = 9, min = 30): string {
  return new Date(y, m, d, h, min, 0).toISOString();
}

describe("parseWhenDate", () => {
  test("treats date-only as local midnight", () => {
    const d = parseWhenDate("2026-11-14");
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(10);
    expect(d!.getDate()).toBe(14);
    expect(d!.getHours()).toBe(0);
  });
});

describe("jobSectionFor", () => {
  test("past-day scheduled open work stays under Today", () => {
    expect(
      jobSectionFor(
        { status: "scheduled", scheduled_at: localIso(2026, 10, 13) },
        NOW,
      ),
    ).toBe("Today");
  });

  test("same-day scheduled work is Today", () => {
    expect(
      jobSectionFor(
        { status: "scheduled", scheduled_at: localIso(2026, 10, 14, 15) },
        NOW,
      ),
    ).toBe("Today");
  });

  test("future calendar day is Upcoming", () => {
    expect(
      jobSectionFor(
        { status: "scheduled", scheduled_at: localIso(2026, 10, 16) },
        NOW,
      ),
    ).toBe("Upcoming");
  });

  test("in_progress stays Today even when scheduled later", () => {
    expect(
      jobSectionFor(
        { status: "in_progress", scheduled_at: localIso(2026, 10, 20) },
        NOW,
      ),
    ).toBe("Today");
  });

  test("on_hold and closed use their own sections", () => {
    expect(jobSectionFor({ status: "on_hold", scheduled_at: null }, NOW)).toBe("On hold");
    expect(jobSectionFor({ status: "closed", scheduled_at: null }, NOW)).toBe(
      "Recently completed",
    );
  });
});

describe("formatScheduleWhen", () => {
  test("past day under Today is Overdue, not Yesterday", () => {
    expect(formatScheduleWhen(localIso(2026, 10, 13), NOW)).toBe("Overdue");
    expect(formatRelativeWhen(localIso(2026, 10, 13), NOW)).toBe("Yesterday");
  });

  test("same day starts with Today", () => {
    expect(formatScheduleWhen(localIso(2026, 10, 14, 15, 0), NOW)).toMatch(/^Today /);
  });

  test("future day keeps a calendar label", () => {
    const label = formatScheduleWhen(localIso(2026, 10, 16, 10, 0), NOW);
    expect(label).not.toBe("Overdue");
    expect(label).not.toMatch(/^Today /);
    expect(label.length).toBeGreaterThan(0);
  });

  it("treats noon-UTC date sentinel like date-only (no clock)", () => {
    expect(formatActivityStamp("2026-11-14T12:00:00.000Z")).toBe("Today");
    expect(formatActivityStamp("2026-11-13T12:00:00.000Z")).toBe("Yesterday");
    expect(formatActivityStamp("2026-11-17T12:00:00Z")).toMatch(/17/);
    // Real timed stamp still includes a clock on today.
    expect(formatActivityStamp("2026-11-14T20:30:00.000Z")).toMatch(/^Today /);
  });
});
