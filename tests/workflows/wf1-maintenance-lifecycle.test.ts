/**
 * WF1 — Maintenance request lifecycle
 *
 *   Tenant submits a request  →  Admin assigns it to a worker  →  Worker views
 *   and works the request  →  Tenant sees the outcome.
 *
 * Each step signs in as that person and calls the same data-layer functions the
 * screens call (src/client/lib/data.ts). Steps run in order and build on each
 * other, exactly like the real hand-offs. The browser version of this workflow
 * is tests/e2e/wf1-maintenance-lifecycle.spec.ts.
 */
import { beforeAll, describe, expect, test } from "vitest";
import * as data from "@/lib/data";
import type { WorkOrder } from "@/types";
import { clientFor, expectDenied, pngFile, resetWorld, signInApp, tomorrow, type World } from "../support/harness";

let world: World;
let request: WorkOrder;

beforeAll(async () => {
  world = await resetWorld();
});

describe("[WF1] Maintenance request lifecycle", () => {
  test("Tenant · submits a maintenance request with a photo", async () => {
    await signInApp("tenant");
    request = await data.submitTenantMaintenanceRequest({
      title: "Bathroom sink is leaking",
      description: "Water pools under the sink every time the tap runs.",
      category: "Plumbing",
      permission_to_enter: true,
    });
    await data.uploadMaintenancePhoto(request.id, pngFile("sink.png"));

    expect(request).toMatchObject({ status: "open", unit_id: world.units.a.id });
    const mine = await data.listWorkOrders();
    expect(mine.map((w) => w.id)).toEqual([request.id]);
    expect(await data.listMaintenancePhotos(request.id)).toHaveLength(1);
  });

  test("Worker · cannot see the request before it is assigned", async () => {
    await signInApp("worker");
    expect(await data.listWorkOrders()).toEqual([]);
  });

  test("Admin · sees the new request in the queue with the tenant and unit", async () => {
    await signInApp("admin");
    const queue = await data.listWorkOrders();
    expect(queue.find((w) => w.id === request.id)).toMatchObject({
      status: "open",
      title: "Bathroom sink is leaking",
      category: "Plumbing",
      tenant_first_name: "Tina",
      unit_name: "1A",
      property_name: "Maple Court",
      permission_to_enter: true,
      assigned_staff_id: null,
    });
    expect(await data.listMaintenancePhotos(request.id), "admin sees the tenant's photo").toHaveLength(1);
  });

  test("Admin · assigns the request to a worker and schedules the visit", async () => {
    await signInApp("admin");
    const staff = await data.listStaff();
    const sam = staff.find((s) => s.last_name === "Fixit")!;
    expect(sam, "Sam appears in the staff picker").toBeTruthy();

    const scheduled = await data.updateWorkOrder(
      request.id,
      { status: "scheduled", assigned_staff_id: sam.id, scheduled_at: tomorrow() },
      { previousStatus: "open" },
    );
    expect(scheduled).toMatchObject({ status: "scheduled", assigned_staff_id: world.staff.worker.id });
    expect(scheduled.scheduled_at?.slice(0, 10)).toBe(tomorrow());
  });

  test("Worker · now sees the request with the tenant's description, unit and photo", async () => {
    await signInApp("worker");
    const jobs = await data.listWorkOrders();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      id: request.id,
      status: "scheduled",
      description: "Water pools under the sink every time the tap runs.",
      tenant_first_name: "Tina",
      tenant_last_name: "Renter",
      unit_name: "1A",
      property_name: "Maple Court",
      permission_to_enter: true,
    });
    const photos = await data.listMaintenancePhotos(request.id);
    expect(photos).toHaveLength(1);
    expect((await fetch(photos[0].url!)).status, "the photo actually downloads").toBe(200);
  });

  test("Another worker · does not see a request assigned to someone else", async () => {
    await signInApp("worker2");
    expect(await data.listWorkOrders()).toEqual([]);
  });

  test("Worker · starts the job", async () => {
    await signInApp("worker");
    const started = await data.updateWorkOrder(request.id, { status: "in_progress" }, { previousStatus: "scheduled" });
    expect(started.status).toBe("in_progress");
  });

  test("Worker · leaves an internal note and an update for the tenant", async () => {
    await signInApp("worker");
    await data.addMaintenanceComment(request.id, "Trap is cracked, need a 1¼ inch replacement.", "internal");
    await data.addMaintenanceComment(request.id, "Found the problem — back tomorrow with the part.", "tenant_visible");
    expect(await data.listMaintenanceComments(request.id)).toHaveLength(2);
  });

  test("Worker · adds a photo of the work", async () => {
    await signInApp("worker");
    await data.uploadMaintenancePhoto(request.id, pngFile("cracked-trap.png"));
    expect(await data.listMaintenancePhotos(request.id)).toHaveLength(2);
  });

  test("Worker · cannot reassign the job, reschedule it, or edit the tenant's report", async () => {
    const worker = await clientFor("worker");
    const mr = () => worker.from("MaintenanceRequests");
    expectDenied(await mr().update({ assigned_staff_id: world.staff.worker2.id }).eq("id", request.id).select());
    expectDenied(await mr().update({ scheduled_for: new Date().toISOString() }).eq("id", request.id).select());
    expectDenied(await mr().update({ description: "Tenant broke it" }).eq("id", request.id).select());
  });

  test("Tenant · sees it is in progress, reads the worker's update, and replies", async () => {
    await signInApp("tenant");
    const [mine] = await data.listWorkOrders();
    expect(mine).toMatchObject({ id: request.id, status: "in_progress" });

    const comments = await data.listMaintenanceComments(request.id);
    expect(comments.map((c) => c.body), "internal notes stay hidden from the tenant").toEqual([
      "Found the problem — back tomorrow with the part.",
    ]);
    await data.addMaintenanceComment(request.id, "Thanks! I'll leave the bathroom clear.");
  });

  test("Worker · reads the tenant's reply and closes the job with resolution notes", async () => {
    await signInApp("worker");
    const thread = await data.listMaintenanceComments(request.id);
    expect(thread.map((c) => c.author_role)).toEqual(["maintenance", "maintenance", "tenant"]);

    const closed = await data.updateWorkOrder(
      request.id,
      { status: "closed", resolution_notes: "Replaced the cracked trap and re-sealed the drain." },
      { previousStatus: "in_progress" },
    );
    expect(closed).toMatchObject({ status: "closed" });
    expect(closed.completed_at).toBeTruthy();
  });

  test("Tenant · sees the request closed with the full status trail", async () => {
    await signInApp("tenant");
    const [mine] = await data.listWorkOrders();
    expect(mine).toMatchObject({
      id: request.id,
      status: "closed",
      resolution_notes: "Replaced the cracked trap and re-sealed the drain.",
    });
    const trail = await data.listMaintenanceStatusHistory(request.id);
    expect(trail.map((h) => `${h.to_status} (${h.changed_by_role})`)).toEqual([
      "Open (tenant)",
      "Scheduled (admin)",
      "In Progress (maintenance)",
      "Closed (maintenance)",
    ]);
  });

  test("Admin · sees the closed job, both photos and the whole conversation", async () => {
    await signInApp("admin");
    const closed = (await data.listWorkOrders({ status: "closed" })).find((w) => w.id === request.id);
    expect(closed).toBeTruthy();
    expect(await data.listMaintenancePhotos(request.id)).toHaveLength(2);
    expect(await data.listMaintenanceComments(request.id)).toHaveLength(3);
    expect((await data.getDashboardSummary()).open_work_orders).toBe(0);
  });

  test("Another tenant · never saw any of it", async () => {
    await signInApp("tenant2");
    expect(await data.listWorkOrders()).toEqual([]);
    expect(await data.listMaintenanceComments(request.id)).toEqual([]);
    expect(await data.listMaintenancePhotos(request.id)).toEqual([]);
    expect(await data.listMaintenanceStatusHistory(request.id)).toEqual([]);
  });
});
