import { describe, expect, test } from "vitest";
import {
  displayNameFromEmail,
  initialsFromName,
  navItemsForAudience,
  PORTAL_BRAND,
  roleLabel,
} from "@/lib/portal-nav";

describe("portal-nav", () => {
  test("brand is Landlord Gopher for every shell", () => {
    expect(PORTAL_BRAND).toBe("Landlord Gopher");
  });

  test("staff Phase 0 nav", () => {
    expect(navItemsForAudience("staff").map((i) => i.label)).toEqual([
      "Dashboard",
      "Maintenance",
      "Properties",
      "People",
      "Messages",
      "Documents",
    ]);
  });

  test("tenant / landlord / maintenance Phase 0 nav", () => {
    expect(navItemsForAudience("tenant").map((i) => i.label)).toEqual([
      "Home",
      "Requests",
      "Messages",
      "Documents",
    ]);
    expect(navItemsForAudience("landlord").map((i) => i.label)).toEqual([
      "Home",
      "Properties",
      "Maintenance",
      "Messages",
      "Documents",
    ]);
    expect(navItemsForAudience("maintenance").map((i) => i.label)).toEqual([
      "My jobs",
      "Messages",
    ]);
  });

  test("display helpers", () => {
    expect(displayNameFromEmail("ada.admin@example.com")).toBe("Ada Admin");
    expect(initialsFromName("Ada Admin")).toBe("AA");
    expect(roleLabel("maintenance")).toBe("Maintenance");
  });
});
