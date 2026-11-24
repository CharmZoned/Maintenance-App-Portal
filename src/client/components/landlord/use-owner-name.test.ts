import { describe, expect, it } from "vitest";
import { ownerDisplayName } from "./use-owner-name";

describe("ownerDisplayName", () => {
  it("uses the owner's name from the Landlords record", () => {
    expect(ownerDisplayName({ first_name: "Lena", last_name: "Owner", company_name: "Owner Holdings" })).toBe("Lena Owner");
  });

  it("falls back to the company, then to nothing", () => {
    expect(ownerDisplayName({ first_name: " ", last_name: "", company_name: "Owner Holdings" })).toBe("Owner Holdings");
    expect(ownerDisplayName({ first_name: "", last_name: "", company_name: null })).toBeNull();
  });
});
