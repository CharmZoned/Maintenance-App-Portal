import { describe, expect, it } from "vitest";
import { maintenanceCategoryToDb, workOrderPriorityToDb, workOrderStatusToDb } from "./mappers";
import { MAINTENANCE_CATEGORIES } from "../types";

describe("workOrderStatusToDb", () => {
  it.each([
    ["open", "Open"],
    ["scheduled", "Scheduled"],
    ["in_progress", "In Progress"],
    ["on_hold", "On Hold"],
    ["closed", "Closed"],
  ])("maps %s to live CHECK value %s", (input, expected) => {
    expect(workOrderStatusToDb(input)).toBe(expected);
  });

  it("accepts Title Case input", () => {
    expect(workOrderStatusToDb("In Progress")).toBe("In Progress");
    expect(workOrderStatusToDb("On Hold")).toBe("On Hold");
  });

  it.each(["assigned", "completed", "cancelled", "", "bogus"])("rejects retired/invalid %j", (input) => {
    expect(() => workOrderStatusToDb(input)).toThrow(/Invalid work order status/);
  });
});

describe("workOrderPriorityToDb", () => {
  it.each([
    ["low", "Low"],
    ["normal", "Normal"],
    ["high", "High"],
    ["urgent", "Urgent"],
    ["Urgent", "Urgent"],
  ])("maps %s to %s", (input, expected) => {
    expect(workOrderPriorityToDb(input)).toBe(expected);
  });

  it.each(["", "critical", "emergency"])("rejects invalid %j", (input) => {
    expect(() => workOrderPriorityToDb(input)).toThrow(/Invalid work order priority/);
  });
});

describe("maintenanceCategoryToDb", () => {
  it("accepts every canonical category", () => {
    for (const c of MAINTENANCE_CATEGORIES) expect(maintenanceCategoryToDb(c)).toBe(c);
  });

  it("trims whitespace", () => {
    expect(maintenanceCategoryToDb("  Plumbing ")).toBe("Plumbing");
  });

  it.each(["", "plumbing", "HVAC", "General"])("rejects non-canonical %j", (input) => {
    expect(() => maintenanceCategoryToDb(input)).toThrow(/Invalid maintenance category/);
  });
});
