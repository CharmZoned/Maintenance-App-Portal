/**
 * R8 — People → Landlords (LG-G)
 * The admin sees each landlord with their properties, unit count, open
 * requests and portal login, so they can message the landlord from People.
 * Every read is one the existing RLS already allows an admin; anyone else is
 * refused by the admin-only accounts RPC.
 */
import { beforeAll, describe, expect, test } from "vitest";
import { listLandlordsWithPortfolio, officeThreadHref } from "@/lib/landlord-portfolio";
import { resetWorld, signInApp, signOutApp, sql, type World } from "../support/harness";

let world: World;

beforeAll(async () => {
  world = await resetWorld();
  await sql(
    `insert into public."MaintenanceRequests"
       (title, description, category, status, unit_id, property_id, submitted_by_tenant_id,
        closed_at, resolution_notes, hold_reason, next_follow_up_date)
     values ('Leaky tap', 'Drips all night', 'Plumbing', 'Open', $1, $3, $4, null, null, null, null),
            ('Broken blind', 'Fixed last week', 'General repair', 'Closed', $2, $3, null, now(), 'Replaced the cord.', null, null),
            ('Hall light out', 'Common area', 'Electrical', 'On Hold', null, $3, null, null, null, 'Waiting on a part', current_date + 3),
            ('Roof check', 'Other landlord', 'General repair', 'Open', $5, $6, null, null, null, null, null)`,
    [world.units.a.id, world.units.b.id, world.property.id, world.tenants.tenant.id, world.units.other.id, world.otherProperty.id],
  );
});

describe("[R8] People → Landlords portfolio", () => {
  test("admin sees properties, unit count, open requests and the landlord's login", async () => {
    await signInApp("admin");
    const rows = await listLandlordsWithPortfolio();
    const owner = rows.find((r) => r.id === world.landlord.id);
    const other = rows.find((r) => r.id === world.otherLandlord.id);

    expect(owner).toMatchObject({
      name: "Owner Holdings LLC",
      unit_count: 2,
      // Leaky tap (unit 1A) + Hall light out (common area). Closed does not count.
      open_requests: 2,
      user_id: world.users.landlord.id,
      portal_status: "active",
    });
    expect(owner?.properties).toEqual([
      { id: world.property.id, name: "Maple Court", unit_count: 2, open_requests: 2 },
    ]);

    // No portal login yet: no user id, so the screen hides Message.
    expect(other).toMatchObject({
      name: "Oscar Elsewhere",
      unit_count: 1,
      open_requests: 1,
      user_id: null,
      portal_status: "not_invited",
    });
    expect(other?.properties.map((p) => p.name)).toEqual(["Birch House"]);
  });

  test("a request filed with only a unit still counts against that unit's property", async () => {
    await sql(
      `insert into public."MaintenanceRequests" (title, description, category, unit_id, submitted_by_tenant_id)
       values ('Stuck window', 'Unit only', 'General repair', $1, $2)`,
      [world.units.b.id, world.tenants.tenant2.id],
    );
    await signInApp("admin");
    const owner = (await listLandlordsWithPortfolio()).find((r) => r.id === world.landlord.id);
    expect(owner?.open_requests).toBe(3);
  });

  test("a landlord with no properties shows zero counts", async () => {
    await sql(
      `insert into public."Landlords" (first_name, last_name, email) values ('Nina', 'Newcomer', 'nina@new.test')`,
    );
    await signInApp("admin");
    const nina = (await listLandlordsWithPortfolio()).find((r) => r.email === "nina@new.test");
    expect(nina).toMatchObject({ properties: [], unit_count: 0, open_requests: 0, user_id: null });
  });

  test("pending landlord login still links, with its status", async () => {
    await sql(`update public.user_roles set account_status = 'pending' where user_id = $1`, [world.users.landlord.id]);
    try {
      await signInApp("admin");
      const owner = (await listLandlordsWithPortfolio()).find((r) => r.id === world.landlord.id);
      expect(owner).toMatchObject({ user_id: world.users.landlord.id, portal_status: "pending" });
    } finally {
      await sql(`update public.user_roles set account_status = 'approved' where user_id = $1`, [world.users.landlord.id]);
    }
  });

  test("non-admins are refused", async () => {
    for (const persona of ["landlord", "tenant", "worker"] as const) {
      await signInApp(persona);
      await expect(listLandlordsWithPortfolio()).rejects.toThrow(/admin/i);
    }
    await signOutApp();
  });

  test("Message opens the admin's view of that landlord's office thread", () => {
    expect(officeThreadHref("abc-123")).toBe("/messages?thread=office:abc-123");
  });
});
