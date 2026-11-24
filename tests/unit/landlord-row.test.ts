import { describe, expect, test } from "vitest";
import { landlordCountsLine, landlordPropertiesLine } from "@/components/people/landlord-row";

describe("People → Landlords row text", () => {
  test("lists property names, or says there are none", () => {
    expect(landlordPropertiesLine({ properties: [] })).toBe("No properties yet");
    expect(
      landlordPropertiesLine({
        properties: [
          { id: 1, name: "Maple Court", unit_count: 2, open_requests: 1 },
          { id: 2, name: "Birch House", unit_count: 1, open_requests: 0 },
        ],
      }),
    ).toBe("Maple Court, Birch House");
  });

  test("counts read in plain words with singular and plural", () => {
    expect(landlordCountsLine({ unit_count: 1, open_requests: 1 })).toBe("1 unit · 1 open request");
    expect(landlordCountsLine({ unit_count: 2, open_requests: 0 })).toBe("2 units · 0 open requests");
  });
});
