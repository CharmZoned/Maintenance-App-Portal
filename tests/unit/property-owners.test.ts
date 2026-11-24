import { describe, expect, test } from "vitest";
import {
  UNKNOWN_OWNER,
  buildPropertyOwners,
  landlordIndex,
  ownerIdentity,
  parseOwnerParam,
  portfolioSummary,
  withOwnerParam,
} from "@/components/properties/property-owners";
import type { Landlord, Property } from "@/types";

function landlord(id: number, first: string, last: string, company: string | null = null): Landlord {
  return {
    id,
    first_name: first,
    last_name: last,
    company_name: company,
    email: `${first.toLowerCase() || "x"}@example.test`,
    phone: null,
    preferred_contact: null,
    notes: null,
    created_at: "2026-01-01T00:00:00Z",
  };
}

function property(
  id: number,
  name: string,
  landlordId: number,
  units: number,
  occupied: number,
  landlordName: string | null = null,
): Property {
  return {
    id,
    name,
    type: "multi_family",
    address: null,
    city: null,
    state: null,
    zip: null,
    year_built: null,
    notes: null,
    color: "sky",
    landlord_id: landlordId,
    landlord_name: landlordName,
    created_at: "2026-01-01T00:00:00Z",
    unit_count: units,
    occupied_count: occupied,
  };
}

const LANDLORDS = landlordIndex([
  landlord(1, "Lena", "Owner", "Owner Holdings LLC"),
  landlord(2, "Oscar", "Elsewhere"),
  landlord(3, "", "", "Harbor Point Rentals"),
]);

describe("ownerIdentity", () => {
  test("prefers the person's name and keeps the company as a second line", () => {
    expect(ownerIdentity(1, LANDLORDS)).toEqual({ name: "Lena Owner", company: "Owner Holdings LLC" });
    expect(ownerIdentity(2, LANDLORDS)).toEqual({ name: "Oscar Elsewhere", company: null });
  });

  test("falls back to the company, then the property's landlord name, then a placeholder", () => {
    expect(ownerIdentity(3, LANDLORDS)).toEqual({ name: "Harbor Point Rentals", company: null });
    expect(ownerIdentity(9, LANDLORDS, " Old Name ")).toEqual({ name: "Old Name", company: null });
    expect(ownerIdentity(9, LANDLORDS)).toEqual({ name: UNKNOWN_OWNER, company: null });
  });
});

describe("buildPropertyOwners", () => {
  test("one entry per owner with totals, alphabetical", () => {
    const owners = buildPropertyOwners(
      [
        property(10, "Maple Court", 1, 2, 2),
        property(11, "Birch House", 2, 1, 1),
        property(12, "Oak Terrace", 1, 4, 2),
        property(13, "Cedar Row", 3, 2, 0),
      ],
      LANDLORDS,
    );
    expect(owners.map((o) => [o.id, o.name, o.propertyCount, o.unitCount, o.occupiedCount])).toEqual([
      [3, "Harbor Point Rentals", 1, 2, 0],
      [1, "Lena Owner", 2, 6, 4],
      [2, "Oscar Elsewhere", 1, 1, 1],
    ]);
  });

  test("owners without properties are left out; no properties, no owners", () => {
    expect(buildPropertyOwners([], LANDLORDS)).toEqual([]);
    expect(buildPropertyOwners([property(10, "Maple Court", 2, 1, 0)], LANDLORDS).map((o) => o.id)).toEqual([2]);
  });
});

describe("portfolioSummary", () => {
  test("matches the page meta line", () => {
    expect(portfolioSummary({ propertyCount: 2, unitCount: 3, occupiedCount: 3 })).toBe(
      "2 properties · 3 units · 3/3 occupied",
    );
    expect(portfolioSummary({ propertyCount: 1, unitCount: 1, occupiedCount: 0 })).toBe(
      "1 property · 1 unit · 0/1 occupied",
    );
  });
});

describe("owner URL param", () => {
  test("parses only a landlord id", () => {
    expect(parseOwnerParam("?owner=12")).toBe(12);
    expect(parseOwnerParam("")).toBeNull();
    expect(parseOwnerParam("?owner=abc")).toBeNull();
    expect(parseOwnerParam("?owner=")).toBeNull();
  });

  test("sets and clears the param, keeping others", () => {
    expect(withOwnerParam("", 3)).toBe("?owner=3");
    expect(withOwnerParam("?x=1&owner=2", 5)).toBe("?x=1&owner=5");
    expect(withOwnerParam("?x=1&owner=2", null)).toBe("?x=1");
    expect(withOwnerParam("?owner=2", null)).toBe("");
  });
});
