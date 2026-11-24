/**
 * R4 — Maintenance requests, landlord "New request" (landlord wave LG-C).
 * The data function behind the landlord form: createLandlordRequest().
 */
import { beforeAll, describe, expect, test } from "vitest";
import * as data from "@/lib/data";
import { createLandlordRequest } from "@/lib/landlord-requests";
import { statusLabel } from "@/lib/request-status";
import { pngFile, resetWorld, signInApp, type World } from "../support/harness";

let world: World;

beforeAll(async () => {
  world = await resetWorld();
});

describe("[R4] Landlord files a request from the portal", () => {
  test("a common-area request with 2 photos shows in the admin queue as New", async () => {
    await signInApp("landlord");
    const result = await createLandlordRequest({
      property_id: world.property.id,
      unit_id: null,
      title: "Front gate sticks",
      description: "The latch catches and the gate won't close.",
      category: "Exterior / yard",
      priority: "normal",
      permission_to_enter: false,
      photos: [pngFile("gate-1.png"), pngFile("gate-2.png")],
    });

    expect(result.photoError).toBeNull();
    expect(result.photosUploaded).toBe(2);
    expect(result.request).toMatchObject({
      status: "open",
      unit_id: null,
      property_id: world.property.id,
      tenant_id: null,
      permission_to_enter: false,
      assigned_staff_id: null,
    });
    expect(result.request.request_number).toMatch(/^MR-\d{6}$/);

    // The landlord sees it in their own list.
    const mine = await data.listWorkOrders();
    expect(mine.some((w) => w.id === result.request.id)).toBe(true);

    await signInApp("admin");
    const queue = await data.listWorkOrders();
    const row = queue.find((w) => w.id === result.request.id);
    expect(row, "request in the admin queue").toBeDefined();
    expect(statusLabel(row!, "staff")).toBe("New");

    const photos = await data.listMaintenancePhotos(result.request.id);
    expect(photos).toHaveLength(2);
    expect(photos.every((p) => p.uploaded_by_role === "landlord")).toBe(true);
  });

  test("a unit request keeps the unit and its property, with the chosen priority and entry permission", async () => {
    await signInApp("landlord");
    const { request } = await createLandlordRequest({
      property_id: world.property.id,
      unit_id: world.units.a.id,
      title: "Boiler making noise",
      description: "",
      category: "Heating / AC",
      priority: "urgent",
      permission_to_enter: true,
    });
    expect(request).toMatchObject({
      unit_id: world.units.a.id,
      property_id: world.property.id,
      priority: "urgent",
      permission_to_enter: true,
      // Empty details fall back to the title (description is required).
      description: "Boiler making noise",
    });
  });

  test("a tenant cannot use the landlord form", async () => {
    await signInApp("tenant");
    await expect(
      createLandlordRequest({
        property_id: world.property.id,
        unit_id: world.units.a.id,
        title: "Not a landlord",
        category: "Other",
        priority: "normal",
        permission_to_enter: false,
      }),
    ).rejects.toThrow(/landlord/i);
  });
});
