import { describe, expect, test } from "vitest";
import { liveUnits, vacantUnlistedUnits } from "@/lib/listings-overview";
import type { Lease, Property, Unit } from "@/types";

function unit(id: number, propertyId: number, name: string, partial: Partial<Unit> = {}): Unit {
  return {
    id,
    property_id: propertyId,
    name,
    bedrooms: 2,
    bathrooms: 1,
    sqft: null,
    market_rent: 1400,
    status: "occupied",
    readiness_status: "ready",
    notes: null,
    created_at: "2026-01-01T00:00:00Z",
    ...partial,
  };
}

function property(id: number, name: string): Property {
  return { id, name } as Property;
}

function lease(id: number, unitId: number, status: Lease["status"]): Lease {
  return { id, unit_id: unitId, status } as Lease;
}

const propertyById = new Map([
  [1, property(1, "Maple Court")],
  [2, property(2, "Birch House")],
]);

const units = [
  unit(11, 1, "2B", { status: "vacant", readiness_status: "turnover_needed" }),
  unit(12, 1, "1A", { status: "vacant" }),
  unit(13, 1, "10C", { status: "vacant" }),
  unit(21, 2, "1", { status: "vacant" }),
  unit(22, 2, "2", { status: "vacant" }),
  unit(23, 2, "3"),
];

describe("vacantUnlistedUnits", () => {
  test("ready homes first, then by property and unit label; marketed and leased homes are left out", () => {
    const result = vacantUnlistedUnits({
      units,
      marketedUnitIds: new Set([22]),
      leases: [lease(1, 13, "upcoming"), lease(2, 12, "ended")],
      propertyById,
    });
    expect(result.map((u) => u.id)).toEqual([21, 12, 11]);
  });

  test("with unknown marketing flags every vacant home without a lease counts", () => {
    const result = vacantUnlistedUnits({ units, marketedUnitIds: null, leases: null, propertyById });
    expect(result.map((u) => u.id)).toEqual([21, 22, 12, 13, 11]);
  });
});

describe("liveUnits", () => {
  test("lists marketed units by property then unit label, whatever their status", () => {
    const result = liveUnits({ units, marketedUnitIds: new Set([23, 13, 12]), propertyById });
    expect(result.map((u) => u.id)).toEqual([23, 12, 13]);
  });
});
