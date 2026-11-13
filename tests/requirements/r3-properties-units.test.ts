/**
 * R3 — Properties and units
 * Staff create properties and units and link tenants through a lease; every
 * property belongs to a landlord.
 */
import { beforeAll, describe, expect, test } from "vitest";
import * as data from "@/lib/data";
import { propertyToInsert, unitReadinessToDb, unitStatusToDb } from "@/lib/mappers";
import {
  clientFor,
  expectDenied,
  resetWorld,
  serviceClient,
  signInApp,
  sql,
  type World,
} from "../support/harness";

let world: World;

beforeAll(async () => {
  world = await resetWorld();
});

describe("[R3] Properties and units", () => {
  describe("viewing the portfolio", () => {
    test("an admin sees every property with its landlord and unit counts", async () => {
      await signInApp("admin");
      const properties = await data.listProperties();
      const maple = properties.find((p) => p.name === "Maple Court");
      expect(properties).toHaveLength(2);
      expect(maple).toMatchObject({ unit_count: 2, occupied_count: 2, landlord_id: world.landlord.id });
      expect(maple?.landlord_name).toMatch(/Owner/);
    });

    test("an admin sees the units of a property with their current tenant", async () => {
      await signInApp("admin");
      const units = await data.listUnits(world.property.id);
      expect(units.map((u) => u.name).sort()).toEqual(["1A", "2B"]);
      expect(units.every((u) => u.property_name === "Maple Court")).toBe(true);
    });

    test("an admin sees all landlords and tenants", async () => {
      await signInApp("admin");
      expect((await data.listLandlords()).length).toBe(2);
      const tenants = await data.listTenants();
      expect(tenants.find((t) => t.first_name === "Tina")).toMatchObject({
        active_unit_name: "1A",
        active_property_name: "Maple Court",
      });
    });
  });

  describe("an admin builds the portfolio", () => {
    test("creates a landlord", async () => {
      await signInApp("admin");
      const landlord = await data.createLandlord({
        first_name: "Grace",
        last_name: "Holder",
        email: "grace@holder.test",
      });
      expect(landlord.id).toBeGreaterThan(0);
      expect((await data.listLandlords()).some((l) => l.email === "grace@holder.test")).toBe(true);
    });

    test("creates a property for a landlord", async () => {
      await signInApp("admin");
      // Attach to Grace (created above), not the seeded landlord — later visibility
      // checks expect Lena Owner to keep only Maple Court from the seed world.
      const grace = (await data.listLandlords()).find((l) => l.email === "grace@holder.test");
      expect(grace?.id).toBeGreaterThan(0);
      const property = await data.createProperty({
        name: "Cedar Row",
        landlord_id: grace!.id,
        type: "multi_family",
        address: "4 Cedar Row",
        city: "Baltimore",
        state: "MD",
        zip: "21202",
      });
      expect(property).toMatchObject({ name: "Cedar Row", landlord_id: grace!.id });
    });

    test("adds a unit to a property", async () => {
      await signInApp("admin");
      const unit = await data.createUnit({ property_id: world.property.id, name: "3C", bedrooms: 1, market_rent: 1200 });
      expect(unit).toMatchObject({ name: "3C", property_id: world.property.id, status: "vacant" });
    });

    test("creates a tenant", async () => {
      await signInApp("admin");
      const tenant = await data.createTenant({ first_name: "Ivy", last_name: "Mover", email: "ivy@mover.test" });
      expect(tenant.id).toBeGreaterThan(0);
    });

    test("links a tenant to a unit through a lease", async () => {
      const [{ id: tenantId }] = await sql<{ id: number }>(
        `insert into public."Tenants" (first_name, last_name, email, primary_on_lease, invite_to_app)
         values ('Leo', 'Lessee', 'leo@lessee.test', false, false) returning id`,
      );
      const [{ id: unitId }] = await sql<{ id: number }>(
        `insert into public."Units" (property_id, unit_label, status) values ($1, '4D', 'Vacant') returning id`,
        [world.property.id],
      );
      await signInApp("admin");
      const lease = await data.createLease({
        unit_id: Number(unitId),
        primary_tenant_id: Number(tenantId),
        start_date: "2026-12-01",
        end_date: "2027-11-30",
        monthly_rent: 1300,
      });
      expect(lease).toMatchObject({ unit_id: Number(unitId), status: "active", tenant_first_name: "Leo" });
      const [tenant] = await sql<{ unit_id: number }>(`select unit_id from public."Tenants" where id = $1`, [tenantId]);
      expect(Number(tenant.unit_id), "the tenant now lives in the leased unit").toBe(Number(unitId));
      const membership = await sql(
        `select 1 from public."LeaseTenants" where lease_id = $1 and tenant_id = $2`,
        [lease.id, tenantId],
      );
      expect(membership, "createLease upserts LeaseTenants for the primary").toHaveLength(1);
    });

    test("updateLease moves tenant.unit_id and LeaseTenants when unit or primary changes (gap R3)", async () => {
      const [{ id: tenantA }] = await sql<{ id: number }>(
        `insert into public."Tenants" (first_name, last_name, email, primary_on_lease, invite_to_app)
         values ('Uma', 'Updater', 'uma@updater.test', false, false) returning id`,
      );
      const [{ id: tenantB }] = await sql<{ id: number }>(
        `insert into public."Tenants" (first_name, last_name, email, primary_on_lease, invite_to_app)
         values ('Ned', 'Newprimary', 'ned@newprimary.test', false, false) returning id`,
      );
      const [{ id: unitA }] = await sql<{ id: number }>(
        `insert into public."Units" (property_id, unit_label, status) values ($1, 'Sync-A', 'Vacant') returning id`,
        [world.property.id],
      );
      const [{ id: unitB }] = await sql<{ id: number }>(
        `insert into public."Units" (property_id, unit_label, status) values ($1, 'Sync-B', 'Vacant') returning id`,
        [world.property.id],
      );
      await signInApp("admin");
      const lease = await data.createLease({
        unit_id: Number(unitA),
        primary_tenant_id: Number(tenantA),
        start_date: "2026-01-01",
        end_date: "2026-12-31",
        monthly_rent: 1100,
      });

      await data.updateLease(lease.id, { unit_id: Number(unitB) });
      const [afterUnitMove] = await sql<{ unit_id: number | null; primary_on_lease: boolean }>(
        `select unit_id, primary_on_lease from public."Tenants" where id = $1`,
        [tenantA],
      );
      expect(Number(afterUnitMove.unit_id), "same primary follows the new lease unit").toBe(Number(unitB));
      expect(afterUnitMove.primary_on_lease).toBe(true);

      await data.updateLease(lease.id, { primary_tenant_id: Number(tenantB) });
      const [oldPrimary] = await sql<{ unit_id: number | null; primary_on_lease: boolean }>(
        `select unit_id, primary_on_lease from public."Tenants" where id = $1`,
        [tenantA],
      );
      const [newPrimary] = await sql<{ unit_id: number | null; primary_on_lease: boolean }>(
        `select unit_id, primary_on_lease from public."Tenants" where id = $1`,
        [tenantB],
      );
      expect(oldPrimary.unit_id, "previous primary is cleared when replaced").toBeNull();
      expect(oldPrimary.primary_on_lease).toBe(false);
      expect(Number(newPrimary.unit_id)).toBe(Number(unitB));
      expect(newPrimary.primary_on_lease).toBe(true);
      expect(
        await sql(`select 1 from public."LeaseTenants" where lease_id = $1 and tenant_id = $2`, [
          lease.id,
          tenantA,
        ]),
      ).toHaveLength(0);
      expect(
        await sql(`select 1 from public."LeaseTenants" where lease_id = $1 and tenant_id = $2`, [
          lease.id,
          tenantB,
        ]),
      ).toHaveLength(1);
    });

    test("updateLease sets co-tenants to the lease unit even if their unit_id was already moved (gap R3)", async () => {
      const [{ id: primaryId }] = await sql<{ id: number }>(
        `insert into public."Tenants" (first_name, last_name, email, primary_on_lease, invite_to_app)
         values ('Pat', 'Primary', 'pat@cotenant.test', false, false) returning id`,
      );
      const [{ id: roommateId }] = await sql<{ id: number }>(
        `insert into public."Tenants" (first_name, last_name, email, primary_on_lease, invite_to_app)
         values ('Roo', 'Mate', 'roo@cotenant.test', false, false) returning id`,
      );
      const [{ id: unitA }] = await sql<{ id: number }>(
        `insert into public."Units" (property_id, unit_label, status) values ($1, 'Co-A', 'Vacant') returning id`,
        [world.property.id],
      );
      const [{ id: unitB }] = await sql<{ id: number }>(
        `insert into public."Units" (property_id, unit_label, status) values ($1, 'Co-B', 'Vacant') returning id`,
        [world.property.id],
      );
      const [{ id: unitC }] = await sql<{ id: number }>(
        `insert into public."Units" (property_id, unit_label, status) values ($1, 'Co-C', 'Vacant') returning id`,
        [world.property.id],
      );
      await signInApp("admin");
      const lease = await data.createLease({
        unit_id: Number(unitA),
        primary_tenant_id: Number(primaryId),
        start_date: "2026-04-01",
        end_date: "2027-03-31",
        monthly_rent: 1400,
      });
      await sql(`insert into public."LeaseTenants" (lease_id, tenant_id) values ($1, $2)`, [
        lease.id,
        roommateId,
      ]);
      // Simulate a concurrent move that already parked the roommate on an intermediate unit.
      await sql(`update public."Tenants" set unit_id = $1 where id = $2`, [unitB, roommateId]);

      await data.updateLease(lease.id, { unit_id: Number(unitC) });
      const [roommate] = await sql<{ unit_id: number | null }>(
        `select unit_id from public."Tenants" where id = $1`,
        [roommateId],
      );
      expect(Number(roommate.unit_id), "co-tenant converges to lease unit without needing beforeUnit").toBe(
        Number(unitC),
      );
    });

    test("deleteLease clears tenant.unit_id and leaves no LeaseTenants orphans (gap R3)", async () => {
      const [{ id: tenantId }] = await sql<{ id: number }>(
        `insert into public."Tenants" (first_name, last_name, email, primary_on_lease, invite_to_app)
         values ('Del', 'Leasee', 'del@leasee.test', false, false) returning id`,
      );
      const [{ id: unitId }] = await sql<{ id: number }>(
        `insert into public."Units" (property_id, unit_label, status) values ($1, 'Del-U', 'Vacant') returning id`,
        [world.property.id],
      );
      await signInApp("admin");
      const lease = await data.createLease({
        unit_id: Number(unitId),
        primary_tenant_id: Number(tenantId),
        start_date: "2026-03-01",
        end_date: "2027-02-28",
        monthly_rent: 900,
      });
      await data.deleteLease(lease.id);
      expect(await sql(`select 1 from public."Leases" where id = $1`, [lease.id])).toHaveLength(0);
      expect(await sql(`select 1 from public."LeaseTenants" where lease_id = $1`, [lease.id])).toHaveLength(0);
      const [tenant] = await sql<{ unit_id: number | null; primary_on_lease: boolean }>(
        `select unit_id, primary_on_lease from public."Tenants" where id = $1`,
        [tenantId],
      );
      expect(tenant.unit_id, "product rule: clear unit_id on lease delete (no reassign)").toBeNull();
      expect(tenant.primary_on_lease).toBe(false);
    });

    test("renames a property", async () => {
      await signInApp("admin");
      const updated = await data.updateProperty(world.otherProperty.id, { name: "Birch House (renovated)" });
      expect(updated.name).toBe("Birch House (renovated)");
    });

    test("removes an empty unit", async () => {
      const [{ id }] = await sql<{ id: number }>(
        `insert into public."Units" (property_id, unit_label, status) values ($1, 'Spare', 'Vacant') returning id`,
        [world.property.id],
      );
      await signInApp("admin");
      await data.deleteUnit(Number(id));
      expect(await sql(`select 1 from public."Units" where id = $1`, [id])).toHaveLength(0);
    });
  });

  describe("every property has a landlord", () => {
    test("the app refuses to create a property without a landlord", async () => {
      await signInApp("admin");
      await expect(data.createProperty({ name: "Orphan", landlord_id: 0 })).rejects.toThrow(/landlord_id is required/);
    });

    test("the database refuses a property without a landlord", async () => {
      const result = await serviceClient()
        .from("Properties")
        .insert({ property_name: "Orphan", street_address: "1 A St", city: "X", state: "MD", zip: "21201", property_type: "Other" })
        .select();
      expect(result.error?.message).toMatch(/landlord_id/);
    });

    test("a landlord with properties cannot be deleted out from under them", async () => {
      const result = await serviceClient().from("Landlords").delete().eq("id", world.landlord.id).select();
      expect(result.error?.message).toMatch(/foreign key/i);
    });
  });

  describe("the app and the database agree on allowed values", () => {
    // Uses the app's own mapping code, written straight to the database (service
    // role), so this isolates "is the value acceptable" from "is the user allowed".
    test.each([
      "single_family",
      "multi_family",
      "condo",
      "townhouse",
      "apartment_building",
      "commercial",
      "other",
    ] as const)("property type '%s' offered in the property form is accepted", async (type) => {
      const row = propertyToInsert({ name: `Type check ${type}`, type, landlord_id: world.landlord.id });
      const result = await serviceClient().from("Properties").insert(row).select("id").single();
      expect(result.error, `database rejected property_type "${row.property_type}": ${result.error?.message}`).toBeNull();
      // Remove probe rows so later RLS visibility checks stay isolated.
      if (result.data?.id != null) await serviceClient().from("Properties").delete().eq("id", result.data.id);
    });

    test.each(["vacant", "occupied"] as const)(
      "unit occupancy '%s' offered in the unit form is accepted",
      async (status) => {
        const result = await serviceClient()
          .from("Units")
          .insert({ property_id: world.property.id, unit_label: `Status check ${status}`, status: unitStatusToDb(status) })
          .select("id")
          .single();
        expect(result.error, `database rejected unit status "${unitStatusToDb(status)}": ${result.error?.message}`).toBeNull();
        if (result.data?.id != null) await serviceClient().from("Units").delete().eq("id", result.data.id);
      },
    );

    test.each([
      "ready",
      "turnover_needed",
      "turnover_in_progress",
      "rehab_needed",
      "rehab_in_progress",
    ] as const)("unit readiness '%s' offered in the unit form is accepted", async (readiness) => {
      const result = await serviceClient()
        .from("Units")
        .insert({
          property_id: world.property.id,
          unit_label: `Readiness check ${readiness}`,
          status: "Vacant",
          readiness_status: unitReadinessToDb(readiness),
        })
        .select("id")
        .single();
      expect(
        result.error,
        `database rejected readiness_status "${unitReadinessToDb(readiness)}": ${result.error?.message}`,
      ).toBeNull();
      if (result.data?.id != null) await serviceClient().from("Units").delete().eq("id", result.data.id);
    });
  });

  describe("who else can see or change the portfolio", () => {
    test("a tenant sees only their own unit and property", async () => {
      const client = await clientFor("tenant");
      expect((await client.from("Units").select("id")).data).toEqual([{ id: world.units.a.id }]);
      expect((await client.from("Properties").select("id")).data).toEqual([{ id: world.property.id }]);
    });

    test("a landlord sees only the properties they own", async () => {
      const client = await clientFor("landlord");
      const { data: rows } = await client.from("Properties").select("id").order("id");
      const ids = (rows ?? []).map((r) => r.id);
      // Includes seed Maple Court plus any properties created earlier in this file for Lena.
      expect(ids).toContain(world.property.id);
      expect(ids).not.toContain(world.otherProperty.id);
      const [{ count }] = await sql<{ count: string }>(
        `select count(*)::text as count from public."Properties" where landlord_id = $1`,
        [world.landlord.id],
      );
      expect(ids).toHaveLength(Number(count));
    });

    test("a worker with no assigned jobs sees no properties", async () => {
      const client = await clientFor("worker");
      expect((await client.from("Properties").select("id")).data).toEqual([]);
    });

    test.each(["worker", "tenant", "landlord"] as const)("a %s cannot add a unit", async (persona) => {
      const client = await clientFor(persona);
      const attempt = await client
        .from("Units")
        .insert({ property_id: world.property.id, unit_label: `Sneaky ${persona}`, status: "Vacant" })
        .select();
      expectDenied(attempt);
      expect(await sql(`select 1 from public."Units" where unit_label = $1`, [`Sneaky ${persona}`])).toHaveLength(0);
    });

    test.each(["worker", "tenant"] as const)("a %s cannot rename a property", async (persona) => {
      const client = await clientFor(persona);
      expectDenied(await client.from("Properties").update({ property_name: "Hacked" }).eq("id", world.property.id).select());
      const [row] = await sql<{ property_name: string }>(`select property_name from public."Properties" where id = $1`, [
        world.property.id,
      ]);
      expect(row.property_name).toBe("Maple Court");
    });
  });
});
