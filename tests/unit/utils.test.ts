import { describe, expect, test } from "vitest";
import { addMonths, daysBetween, formatMoney, toIsoDate } from "@/lib/utils";

describe("date and money helpers", () => {
  test("addMonths rolls over year boundaries in both directions", () => {
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-06", 0)).toBe("2026-06");
  });

  test("daysBetween counts whole days, negative when reversed", () => {
    expect(daysBetween("2026-11-01", "2026-11-30")).toBe(29);
    expect(daysBetween("2026-11-30", "2026-11-01")).toBe(-29);
  });

  test("toIsoDate pads month and day", () => {
    expect(toIsoDate(new Date(2026, 0, 5))).toBe("2026-01-05");
  });

  test("formatMoney shows a dash for missing amounts", () => {
    expect(formatMoney(null)).toBe("—");
    expect(formatMoney(undefined)).toBe("—");
    expect(formatMoney(1450)).toContain("1,450");
  });
});
