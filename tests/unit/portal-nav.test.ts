import { describe, expect, test } from "vitest";
import {
  displayNameFromEmail,
  initialsFromName,
  navItemsForAudience,
  PORTAL_BRAND,
  roleLabel,
  withNavCounts,
} from "@/lib/portal-nav";

describe("portal-nav", () => {
  test("brand is Landlord Gopher for every shell", () => {
    expect(PORTAL_BRAND).toBe("Landlord Gopher");
  });

  test("staff nav follows the admin workspace rail", () => {
    const items = navItemsForAudience("staff");
    expect(items.map((i) => [i.label, i.href])).toEqual([
      ["Dashboard", "/dashboard"],
      ["Maintenance", "/maintenance"],
      ["Properties", "/properties"],
      ["Rent", "/rent"],
      ["People", "/people"],
      ["Messages", "/messages"],
      ["Documents", "/documents"],
      ["Website listings", "/listings"],
      ["Settings", "/settings"],
    ]);
    // Every rail row has an icon, and no row carries a count until one is loaded.
    expect(items.every((i) => i.icon)).toBe(true);
    expect(items.some((i) => "count" in i)).toBe(false);
    expect(items.some((i) => "adminOnly" in i)).toBe(false);
  });

  test("non-admin staff do not get admin-only destinations", () => {
    const labels = navItemsForAudience("staff", { isAdmin: false }).map((i) => i.label);
    expect(labels).not.toContain("Settings");
    expect(labels).toContain("Rent");
    expect(labels).toContain("Website listings");
    expect(navItemsForAudience("staff", { isAdmin: true }).map((i) => i.label)).toContain(
      "Settings",
    );
  });

  test("withNavCounts only adds real, positive counts", () => {
    const items = withNavCounts(navItemsForAudience("staff"), {
      maintenance: 3,
      people: 0,
      messages: undefined,
      documents: Number.NaN,
      nowhere: 9,
    });
    const byId = Object.fromEntries(items.map((i) => [i.id, i]));
    expect(byId.maintenance.count).toBe(3);
    expect(byId.maintenance.countLabel).toBe("need action");
    expect(byId.people.count).toBeUndefined();
    expect(byId.messages.count).toBeUndefined();
    expect(byId.documents.count).toBeUndefined();
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
      "Calendar",
      "Messages",
    ]);
  });

  test("display helpers", () => {
    expect(displayNameFromEmail("ada.admin@example.com")).toBe("Ada Admin");
    expect(initialsFromName("Ada Admin")).toBe("AA");
    expect(roleLabel("maintenance")).toBe("Maintenance");
  });
});
