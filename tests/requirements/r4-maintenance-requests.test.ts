/**
 * R4 — Maintenance requests
 * Tenants submit requests with a category and photos; staff work them through
 * statuses; every status change is recorded.
 */
import { beforeAll, describe, expect, test } from "vitest";
import * as data from "@/lib/data";
import { MAINTENANCE_CATEGORIES } from "@/types";
import {
  clientFor,
  expectDenied,
  pdfFile,
  pngFile,
  resetWorld,
  signInApp,
  sql,
  tomorrow,
  type World,
} from "../support/harness";

let world: World;

beforeAll(async () => {
  world = await resetWorld();
});

/** A request as the database would hold it after a tenant submits (fixture, bypasses the app). */
async function seedRequest(over: { title?: string; tenant?: "tenant" | "tenant2" } = {}): Promise<number> {
  const who = over.tenant ?? "tenant";
  const unit = who === "tenant" ? world.units.a.id : world.units.b.id;
  const [row] = await sql<{ id: number }>(
    `insert into public."MaintenanceRequests"
       (title, description, category, unit_id, property_id, submitted_by_tenant_id)
     values ($1, 'Seeded for a test', 'General repair', $2, $3, $4) returning id`,
    [over.title ?? "Seeded request", unit, world.property.id, world.tenants[who].id],
  );
  return Number(row.id);
}

async function assign(requestId: number, staffId = world.staff.worker.id): Promise<void> {
  await sql(
    `update public."MaintenanceRequests"
        set assigned_staff_id = $2, scheduled_for = now() + interval '1 day', status = 'Scheduled'
      where id = $1`,
    [requestId, staffId],
  );
}

describe("[R4] Maintenance requests", () => {
  describe("a tenant submits a request", () => {
    test("the request is created Open, numbered, and tied to the tenant's own unit", async () => {
      await signInApp("tenant");
      const wo = await data.submitTenantMaintenanceRequest({
        title: "Kitchen tap drips",
        description: "It has been dripping since Monday.",
        category: "Plumbing",
        permission_to_enter: true,
      });
      expect(wo).toMatchObject({
        status: "open",
        category: "Plumbing",
        priority: "normal",
        permission_to_enter: true,
        unit_id: world.units.a.id,
        property_id: world.property.id,
        tenant_id: world.tenants.tenant.id,
      });
      expect(wo.request_number).toMatch(/^MR-\d{6}$/);
    });

    test("marking it an emergency sets urgent priority", async () => {
      await signInApp("tenant");
      const wo = await data.submitTenantMaintenanceRequest({
        title: "No heat",
        description: "Boiler is off and it is freezing.",
        category: "Heating / AC",
        permission_to_enter: false,
        priority: "urgent",
      });
      expect(wo.priority).toBe("urgent");
    });

    test.each(MAINTENANCE_CATEGORIES)("category '%s' offered in the form is accepted", async (category) => {
      await signInApp("tenant");
      const wo = await data.submitTenantMaintenanceRequest({
        title: `Category check: ${category}`,
        description: "Checking every category in the dropdown saves.",
        category,
        permission_to_enter: false,
      });
      expect(wo.category).toBe(category);
    });

    test("a category that is not on the list is refused", async () => {
      await signInApp("tenant");
      await expect(
        data.submitTenantMaintenanceRequest({
          title: "Bad category",
          description: "Should not save.",
          category: "Interior design",
          permission_to_enter: false,
        }),
      ).rejects.toThrow(/category/i);
    });

    test("a title and description are required", async () => {
      await signInApp("tenant");
      await expect(
        data.submitTenantMaintenanceRequest({ title: "   ", description: "x", category: "Other", permission_to_enter: false }),
      ).rejects.toThrow(/title/i);
    });

    test("the tenant sees their own requests in 'My requests'", async () => {
      await signInApp("tenant");
      const mine = await data.listWorkOrders();
      expect(mine.length).toBeGreaterThanOrEqual(2);
      expect(mine.every((w) => w.tenant_id === world.tenants.tenant.id)).toBe(true);
    });

    test("the submit form knows which unit the tenant lives in", async () => {
      await signInApp("tenant");
      expect(await data.getTenantHomeContext()).toMatchObject({
        unit_id: world.units.a.id,
        unit_label: "1A",
        property_name: "Maple Court",
      });
    });
  });

  describe("what a tenant cannot do", () => {
    const base = () => ({
      title: "Forged",
      description: "Should be refused",
      category: "Other",
      status: "Open",
      unit_id: world.units.a.id,
      property_id: world.property.id,
      submitted_by_tenant_id: world.tenants.tenant.id,
    });

    test("submit a request for someone else's unit", async () => {
      const client = await clientFor("tenant");
      expectDenied(await client.from("MaintenanceRequests").insert({ ...base(), unit_id: world.units.b.id }).select());
    });

    test("submit a request in another tenant's name", async () => {
      const client = await clientFor("tenant");
      expectDenied(
        await client.from("MaintenanceRequests").insert({ ...base(), submitted_by_tenant_id: world.tenants.tenant2.id }).select(),
      );
    });

    test("pre-assign a worker or skip the queue with a later status", async () => {
      const client = await clientFor("tenant");
      expectDenied(
        await client.from("MaintenanceRequests").insert({ ...base(), assigned_staff_id: world.staff.worker.id }).select(),
      );
      expectDenied(
        await client
          .from("MaintenanceRequests")
          .insert({ ...base(), status: "Closed", closed_at: new Date().toISOString(), resolution_notes: "done" })
          .select(),
      );
    });

    test("see another tenant's requests", async () => {
      const otherId = await seedRequest({ tenant: "tenant2", title: "Tom's private request" });
      const client = await clientFor("tenant");
      const { data: rows } = await client.from("MaintenanceRequests").select("id").eq("id", otherId);
      expect(rows).toEqual([]);
    });

    test("edit or close a request after submitting it", async () => {
      const id = await seedRequest();
      const client = await clientFor("tenant");
      expectDenied(await client.from("MaintenanceRequests").update({ title: "Edited" }).eq("id", id).select());
      expectDenied(
        await client
          .from("MaintenanceRequests")
          .update({ status: "Closed", closed_at: new Date().toISOString(), resolution_notes: "never mind" })
          .eq("id", id)
          .select(),
      );
    });
  });

  describe("photos", () => {
    test("a tenant attaches a photo to their request and can view it", async () => {
      const id = await seedRequest();
      await signInApp("tenant");
      const photo = await data.uploadMaintenancePhoto(id, pngFile("drip.png"));
      expect(photo.storage_path).toMatch(new RegExp(`^${id}/[^/]+\\.png$`));
      expect(photo.url).toBeTruthy();

      const listed = await data.listMaintenancePhotos(id);
      expect(listed).toHaveLength(1);
      const download = await fetch(listed[0].url!);
      expect(download.status).toBe(200);
      expect(download.headers.get("content-type")).toBe("image/png");
    });

    test("staff assigned to the request see the tenant's photo", async () => {
      const id = await seedRequest();
      await signInApp("tenant");
      await data.uploadMaintenancePhoto(id, pngFile());
      await assign(id);
      await signInApp("worker");
      expect(await data.listMaintenancePhotos(id)).toHaveLength(1);
    });

    test("files that are not images are refused", async () => {
      const id = await seedRequest();
      await signInApp("tenant");
      await expect(data.uploadMaintenancePhoto(id, pdfFile("not-a-photo.pdf"))).rejects.toThrow(/mime type/i);
    });

    test("a tenant cannot add photos to another tenant's request", async () => {
      const id = await seedRequest({ tenant: "tenant2" });
      await signInApp("tenant");
      await expect(data.uploadMaintenancePhoto(id, pngFile())).rejects.toThrow();
      expect(await sql(`select 1 from public."MaintenanceRequestPhotos" where maintenance_request_id = $1`, [id])).toHaveLength(0);
    });

    test("another tenant cannot see or download the photo", async () => {
      const id = await seedRequest();
      await signInApp("tenant");
      const photo = await data.uploadMaintenancePhoto(id, pngFile());
      const other = await clientFor("tenant2");
      expect((await other.from("MaintenanceRequestPhotos").select("id").eq("maintenance_request_id", id)).data).toEqual([]);
      const signed = await other.storage.from("maintenance-photos").createSignedUrl(photo.storage_path, 60);
      expect(signed.error).not.toBeNull();
    });
  });

  describe("staff work the request through its statuses", () => {
    test("an admin creates a work order on a tenant's behalf", async () => {
      await signInApp("admin");
      const wo = await data.createWorkOrder({
        title: "Replace hallway light",
        category: "Electrical",
        property_id: world.property.id,
        unit_id: world.units.a.id,
        tenant_id: world.tenants.tenant.id,
        priority: "high",
      });
      expect(wo).toMatchObject({ status: "open", priority: "high", unit_name: "1A", property_name: "Maple Court" });
    });

    test("an admin accepts a request: assigns a worker and schedules a date", async () => {
      const id = await seedRequest();
      await signInApp("admin");
      const wo = await data.updateWorkOrder(
        id,
        { status: "scheduled", assigned_staff_id: world.staff.worker.id, scheduled_at: tomorrow() },
        { previousStatus: "open" },
      );
      expect(wo).toMatchObject({ status: "scheduled", assigned_staff_id: world.staff.worker.id });
      expect(wo.scheduled_at?.slice(0, 10)).toBe(tomorrow());
    });

    test("a request cannot be Scheduled without both a worker and a date", async () => {
      const id = await seedRequest();
      await signInApp("admin");
      await expect(data.updateWorkOrder(id, { status: "scheduled", scheduled_at: tomorrow() })).rejects.toThrow(
        /requests_scheduled_details/,
      );
    });

    test("the assigned worker starts work, puts it on hold with a reason, then closes it with resolution notes", async () => {
      const id = await seedRequest();
      await assign(id);
      await signInApp("worker");

      const started = await data.updateWorkOrder(id, { status: "in_progress" }, { previousStatus: "scheduled" });
      expect(started.status).toBe("in_progress");

      const held = await data.updateWorkOrder(
        id,
        { status: "on_hold", hold_reason: "Waiting on a part", next_follow_up_date: tomorrow() },
        { previousStatus: "in_progress" },
      );
      expect(held).toMatchObject({ status: "on_hold", hold_reason: "Waiting on a part" });

      const closed = await data.updateWorkOrder(
        id,
        { status: "closed", resolution_notes: "Replaced the washer." },
        { previousStatus: "on_hold" },
      );
      expect(closed).toMatchObject({ status: "closed", resolution_notes: "Replaced the washer." });
      expect(closed.completed_at).toBeTruthy();
    });

    test("On hold needs a reason and a follow-up date; Closed needs resolution notes", async () => {
      const id = await seedRequest();
      await assign(id);
      await signInApp("worker");
      await expect(data.updateWorkOrder(id, { status: "on_hold" })).rejects.toThrow(/requests_hold_details/);
      await expect(data.updateWorkOrder(id, { status: "closed" })).rejects.toThrow(/requests_closed_details/);
    });

    test("a closed request can be reopened by an admin", async () => {
      const id = await seedRequest();
      await assign(id);
      await sql(
        `update public."MaintenanceRequests" set status = 'Closed', closed_at = now(), resolution_notes = 'Done' where id = $1`,
        [id],
      );
      await signInApp("admin");
      const reopened = await data.updateWorkOrder(id, { status: "open" }, { previousStatus: "closed" });
      expect(reopened).toMatchObject({ status: "open", completed_at: null });
    });

    test("an admin deletes a work order", async () => {
      const id = await seedRequest({ title: "Created by mistake" });
      await signInApp("admin");
      await data.deleteWorkOrder(id);
      expect(await sql(`select 1 from public."MaintenanceRequests" where id = $1`, [id])).toHaveLength(0);
    });
  });

  describe("status history", () => {
    test("every status change is recorded with who made it", async () => {
      await signInApp("tenant");
      const wo = await data.submitTenantMaintenanceRequest({
        title: "History check",
        description: "Follow me through the trail.",
        category: "Appliance",
        permission_to_enter: false,
      });
      await signInApp("admin");
      await data.updateWorkOrder(
        wo.id,
        { status: "scheduled", assigned_staff_id: world.staff.worker.id, scheduled_at: tomorrow() },
        { previousStatus: "open" },
      );
      await signInApp("worker");
      await data.updateWorkOrder(wo.id, { status: "in_progress" }, { previousStatus: "scheduled" });
      await data.updateWorkOrder(wo.id, { status: "closed", resolution_notes: "Fixed." }, { previousStatus: "in_progress" });

      await signInApp("tenant");
      const trail = await data.listMaintenanceStatusHistory(wo.id);
      expect(trail.map((h) => [h.from_status, h.to_status, h.changed_by_role])).toEqual([
        [null, "Open", "tenant"],
        ["Open", "Scheduled", "admin"],
        ["Scheduled", "In Progress", "maintenance"],
        ["In Progress", "Closed", "maintenance"],
      ]);
      expect(trail[0].note).toBe("Created");
    });

    test("saving without changing the status adds nothing to the trail", async () => {
      const id = await seedRequest();
      await signInApp("admin");
      await data.updateWorkOrder(id, { notes: "Called the tenant." });
      expect(await data.listMaintenanceStatusHistory(id)).toHaveLength(1);
    });

    test.each(["tenant", "worker", "admin"] as const)("a %s cannot rewrite or delete history", async (persona) => {
      const id = await seedRequest();
      await assign(id);
      const client = await clientFor(persona);
      expectDenied(
        await client
          .from("MaintenanceRequestStatusHistory")
          .insert({ maintenance_request_id: id, to_status: "Closed", note: "forged" })
          .select(),
      );
      expectDenied(
        await client.from("MaintenanceRequestStatusHistory").update({ note: "tampered" }).eq("maintenance_request_id", id).select(),
      );
      expectDenied(await client.from("MaintenanceRequestStatusHistory").delete().eq("maintenance_request_id", id).select());
      const rows = await sql<{ note: string | null }>(
        `select note from public."MaintenanceRequestStatusHistory" where maintenance_request_id = $1 order by id`,
        [id],
      );
      expect(rows.map((r) => r.note)).toEqual(["Created", null]);
    });
  });

  describe("comments", () => {
    test("staff post an internal note the tenant cannot see, and an update the tenant can", async () => {
      const id = await seedRequest();
      await assign(id);
      await signInApp("worker");
      await data.addMaintenanceComment(id, "Tenant's dog is loose — call ahead.", "internal");
      await data.addMaintenanceComment(id, "I'll be there Thursday morning.", "tenant_visible");
      expect(await data.listMaintenanceComments(id)).toHaveLength(2);

      await signInApp("tenant");
      const visible = await data.listMaintenanceComments(id);
      expect(visible.map((c) => c.body)).toEqual(["I'll be there Thursday morning."]);
    });

    test("a tenant replies on their own request", async () => {
      const id = await seedRequest();
      await signInApp("tenant");
      const comment = await data.addMaintenanceComment(id, "Thursday works, thanks!");
      expect(comment).toMatchObject({ visibility: "tenant_visible", author_role: "tenant" });
    });

    test("a tenant cannot post an internal note", async () => {
      const id = await seedRequest();
      await signInApp("tenant");
      await expect(data.addMaintenanceComment(id, "sneaky", "internal")).rejects.toThrow();
    });

    test("a comment cannot be posted under someone else's name", async () => {
      const id = await seedRequest();
      const client = await clientFor("tenant");
      expectDenied(
        await client
          .from("MaintenanceRequestComments")
          .insert({
            maintenance_request_id: id,
            body: "I am the admin, honest",
            visibility: "tenant_visible",
            author_user_id: world.users.admin.id,
            author_role: "admin",
          })
          .select(),
      );
    });
  });
});
