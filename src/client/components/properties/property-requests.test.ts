import { describe, expect, it } from "vitest";
import {
  openRequestCountByProperty,
  openRequestCountByUnit,
  openRequestsLabel,
  requestRowContext,
  singlePropertyRedirect,
  splitRequests,
  unitPagePath,
} from "./property-requests";

describe("unitPagePath", () => {
  it("follows the §4 route contract", () => {
    expect(unitPagePath(3, 12)).toBe("/properties/3/units/12");
  });
});

describe("splitRequests", () => {
  it("puts open requests first and completed ones under past, newest first", () => {
    const rows = [
      { id: 1, status: "closed" as const, created_at: "2026-11-01T10:00:00Z" },
      { id: 2, status: "open" as const, created_at: "2026-11-02T10:00:00Z" },
      { id: 3, status: "on_hold" as const, created_at: "2026-11-05T10:00:00Z" },
      { id: 4, status: "closed" as const, created_at: "2026-11-04T10:00:00Z" },
    ];
    const { open, past } = splitRequests(rows);
    expect(open.map((r) => r.id)).toEqual([3, 2]);
    expect(past.map((r) => r.id)).toEqual([4, 1]);
  });
});

describe("open request counts", () => {
  const rows = [
    { status: "open" as const, unit_id: 1, property_id: 10 },
    { status: "in_progress" as const, unit_id: 1, property_id: 10 },
    { status: "closed" as const, unit_id: 1, property_id: 10 },
    { status: "scheduled" as const, unit_id: 2, property_id: 10 },
    { status: "open" as const, unit_id: null, property_id: 10 },
    { status: "open" as const, unit_id: 5, property_id: 20 },
  ];

  it("counts open requests per unit and skips common areas", () => {
    const byUnit = openRequestCountByUnit(rows);
    expect(byUnit.get(1)).toBe(2);
    expect(byUnit.get(2)).toBe(1);
    expect(byUnit.get(5)).toBe(1);
    expect(byUnit.size).toBe(3);
  });

  it("counts open requests per property, common areas included", () => {
    const byProperty = openRequestCountByProperty(rows);
    expect(byProperty.get(10)).toBe(4);
    expect(byProperty.get(20)).toBe(1);
  });

  it("words the count plainly", () => {
    expect(openRequestsLabel(0)).toBe("No open requests");
    expect(openRequestsLabel(1)).toBe("1 open request");
    expect(openRequestsLabel(2)).toBe("2 open requests");
  });
});

describe("requestRowContext", () => {
  const base = {
    unit_id: 4,
    unit_name: "1A",
    created_at: "2026-11-13",
    completed_at: null,
  };

  it("names the unit or the common area on the property page", () => {
    expect(requestRowContext({ ...base, status: "open" })).toMatch(/^Unit 1A · Reported /);
    expect(requestRowContext({ ...base, unit_id: null, unit_name: null, status: "open" })).toMatch(
      /^Common area · Reported /,
    );
  });

  it("drops the place on the unit page", () => {
    expect(requestRowContext({ ...base, status: "open" }, { showPlace: false })).toMatch(/^Reported /);
  });

  it("says when a completed job was fixed", () => {
    expect(
      requestRowContext({ ...base, status: "closed", completed_at: "2026-11-14" }, { showPlace: false }),
    ).toMatch(/^Fixed /);
  });
});

describe("singlePropertyRedirect", () => {
  it("sends a landlord with exactly one property straight to it", () => {
    expect(singlePropertyRedirect({ isLandlord: true, loading: false, properties: [{ id: 7 }] })).toBe(
      "/properties/7",
    );
  });

  it("waits for loading, and leaves several properties and staff on the list", () => {
    expect(singlePropertyRedirect({ isLandlord: true, loading: true, properties: [{ id: 7 }] })).toBeNull();
    expect(
      singlePropertyRedirect({ isLandlord: true, loading: false, properties: [{ id: 7 }, { id: 8 }] }),
    ).toBeNull();
    expect(singlePropertyRedirect({ isLandlord: true, loading: false, properties: [] })).toBeNull();
    expect(singlePropertyRedirect({ isLandlord: false, loading: false, properties: [{ id: 7 }] })).toBeNull();
  });
});
