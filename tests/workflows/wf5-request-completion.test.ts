/**
 * WF5 — Completing a job, and the tenant's "Is it fixed?"
 *
 *   Worker uploads a photo of the finished work  →  completes the job  →  the
 *   tenant confirms it is fixed, or says it is still a problem, which reopens
 *   the request for the same worker (who then needs a new photo).
 *
 * Guards from 20261124120000_request_completion_fixes.sql:
 *   - a photo row whose file never reached storage does not prove the fix;
 *   - when an upload fails, the app removes the row (workers may delete their
 *     own photo row only while it has no file);
 *   - only the reporting tenant can reopen, with a note, and not after they
 *     confirmed the fix.
 *
 * And from 20261124130000_work_photo_cap_per_visit.sql: the 5-work-photo cap
 * counts the current visit only, so a reopened job is never stuck.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, test } from "vitest";
import * as data from "@/lib/data";
import { clientFor, expectOk, pngFile, resetWorld, signInApp, sql, type World } from "../support/harness";

let world: World;
let admin: SupabaseClient;
let sam: SupabaseClient;
let tenant: SupabaseClient;
let tenant2: SupabaseClient;
let landlord: SupabaseClient;

const inDays = (d: number) => new Date(Date.now() + d * 24 * 3600 * 1000).toISOString();

async function newRequest(title: string): Promise<number> {
  const [row] = await sql<{ id: string }>(
    `insert into public."MaintenanceRequests"
       (unit_id, property_id, submitted_by_tenant_id, title, description, category, permission_to_enter)
     values ($1, $2, $3, $4, 'Details from the tenant.', 'Plumbing', true) returning id`,
    [world.units.a.id, world.property.id, world.tenants.tenant.id, title],
  );
  return Number(row.id);
}

/** Admin assigns Sam and Sam starts work. */
async function startedBySam(title: string): Promise<number> {
  const id = await newRequest(title);
  await signInApp("admin");
  await data.updateWorkOrder(
    id,
    { status: "scheduled", assigned_staff_id: world.staff.worker.id, scheduled_at: inDays(1) },
    { previousStatus: "open" },
  );
  await signInApp("worker");
  await data.updateWorkOrder(id, { status: "in_progress" }, { previousStatus: "scheduled" });
  return id;
}

const complete = (id: number, notes = "Replaced the washer.") =>
  data.updateWorkOrder(id, { status: "closed", resolution_notes: notes }, { previousStatus: "in_progress" });

const photoRows = (id: number) =>
  sql<{ storage_path: string }>(
    `select storage_path from public."MaintenanceRequestPhotos" where maintenance_request_id = $1 order by id`,
    [id],
  );

async function status(id: number): Promise<{ status: string; tenant_fix_response: string | null; closed_at: string | null }> {
  const [row] = await sql<{ status: string; tenant_fix_response: string | null; closed_at: string | null }>(
    `select status, tenant_fix_response, closed_at from public."MaintenanceRequests" where id = $1`,
    [id],
  );
  return row;
}

beforeAll(async () => {
  world = await resetWorld();
  [admin, sam, tenant, tenant2, landlord] = await Promise.all([
    clientFor("admin"),
    clientFor("worker"),
    clientFor("tenant"),
    clientFor("tenant2"),
    clientFor("landlord"),
  ]);
});

describe("[WF5] a completion photo must be a real file", () => {
  test("a photo row without its file does not let the worker complete", async () => {
    const id = await startedBySam("Row but no file");
    const {
      data: { user },
    } = await sam.auth.getUser();
    expectOk(
      await sam.from("MaintenanceRequestPhotos").insert({
        maintenance_request_id: id,
        storage_path: `${id}/${randomUUID()}.png`,
        uploaded_by_user_id: user!.id,
        uploaded_by_role: "maintenance",
      }),
      "the row alone saves (the upload comes next)",
    );
    await expect(complete(id)).rejects.toThrow(/photo of the finished work/);

    await data.uploadMaintenancePhoto(id, pngFile("finished.png"));
    expect(await complete(id)).toMatchObject({ status: "closed" });
  });

  test("a failed upload leaves no photo row behind, for a worker too", async () => {
    const id = await startedBySam("Upload rejected");
    // The bucket takes jpeg/png/webp/heic only, so storage refuses this file after the row is written.
    const gif = new File([Buffer.from("GIF89a")], "finished.gif", { type: "image/gif" });
    await expect(data.uploadMaintenancePhoto(id, gif)).rejects.toThrow();
    expect(await photoRows(id), "the row was rolled back").toEqual([]);
    await expect(complete(id)).rejects.toThrow(/photo of the finished work/);
  });

  test("the uploader can remove their own row only while it has no file", async () => {
    const id = await startedBySam("Orphan cleanup");
    const stored = await data.uploadMaintenancePhoto(id, pngFile("kept.png"));
    const { data: deleted } = await sam.from("MaintenanceRequestPhotos").delete().eq("id", stored.id).select("id");
    expect(deleted, "a photo with its file stays").toEqual([]);
    expect(await photoRows(id)).toHaveLength(1);
  });

  test("a missing file can be uploaded again into the same photo", async () => {
    const id = await startedBySam("Retry the upload");
    const {
      data: { user },
    } = await sam.auth.getUser();
    const path = `${id}/${randomUUID()}.png`;
    await signInApp("worker");
    expectOk(
      await sam.from("MaintenanceRequestPhotos").insert({
        maintenance_request_id: id,
        storage_path: path,
        uploaded_by_user_id: user!.id,
        uploaded_by_role: "maintenance",
      }),
      "row saved, file lost",
    );
    const [listed] = await data.listMaintenancePhotos(id);
    expect(listed).toMatchObject({ storage_path: path, url: null, missing: true, uploaded_by_user_id: user!.id });

    await data.retryMissingMaintenancePhoto(listed, pngFile("again.png"));
    const [fixed] = await data.listMaintenancePhotos(id);
    expect(fixed.missing).toBe(false);
    expect(fixed.url).toBeTruthy();
    expect(await complete(id)).toMatchObject({ status: "closed" });
  });
});

describe("[WF5] the tenant's \"Is it fixed?\"", () => {
  let id: number;

  test("only the reporting tenant can reopen, and only a completed request", async () => {
    id = await startedBySam("Dripping tap");
    const early = await tenant.rpc("reopen_maintenance_request_not_fixed", { p_request_id: id, p_note: "x" });
    expect(early.error?.message).toMatch(/not completed yet/);

    await data.uploadMaintenancePhoto(id, pngFile("tap.png"));
    await complete(id);
    for (const client of [tenant2, sam, landlord, admin]) {
      const res = await client.rpc("reopen_maintenance_request_not_fixed", { p_request_id: id, p_note: "Still dripping" });
      expect(res.error?.message).toMatch(/Only the tenant who reported/);
    }
    const blank = await tenant.rpc("reopen_maintenance_request_not_fixed", { p_request_id: id, p_note: "   " });
    expect(blank.error?.message).toMatch(/Say what is still wrong/);
    expect((await status(id)).status).toBe("Closed");
  });

  test("Still a problem: the note becomes a message and the job goes back to the worker", async () => {
    await signInApp("tenant");
    await data.reopenMaintenanceRequestNotFixed(id, "Still dripping this morning.");
    expect(await status(id)).toMatchObject({ status: "Scheduled", closed_at: null, tenant_fix_response: null });

    const { data: messages } = await tenant
      .from("MaintenanceRequestComments")
      .select("body, visibility, author_role")
      .eq("maintenance_request_id", id);
    expect(messages).toEqual([
      { body: "Still a problem: Still dripping this morning.", visibility: "tenant_visible", author_role: "tenant" },
    ]);
    const history = await data.listMaintenanceStatusHistory(id);
    expect(history.at(-1)).toMatchObject({ from_status: "Closed", to_status: "Scheduled", note: "Tenant says it is not fixed" });
  });

  test("the worker needs a new photo to complete the reopened job", async () => {
    await signInApp("worker");
    await data.updateWorkOrder(id, { status: "in_progress" }, { previousStatus: "scheduled" });
    await expect(complete(id, "Replaced the cartridge.")).rejects.toThrow(/photo of the finished work/);
    await data.uploadMaintenancePhoto(id, pngFile("second-visit.png"));
    expect(await complete(id, "Replaced the cartridge.")).toMatchObject({ status: "closed" });
  });

  test("Yes, it's fixed: confirmed, and then it can no longer be reopened by the tenant", async () => {
    await signInApp("tenant");
    await data.confirmMaintenanceRequestFixed(id);
    expect((await status(id)).tenant_fix_response).toBe("confirmed");
    const [order] = (await data.listWorkOrders()).filter((o) => o.id === id);
    expect(order).toMatchObject({ tenant_fix_response: "confirmed" });
    expect(order.tenant_fix_responded_at).toBeTruthy();

    await expect(data.reopenMaintenanceRequestNotFixed(id, "Again")).rejects.toThrow(/already confirmed/);
  });

  test("nobody assigned: Still a problem sends it back to New", async () => {
    const unassigned = await newRequest("Closed by the office");
    await sql(
      `update public."MaintenanceRequests" set status = 'Closed', closed_at = now(), resolution_notes = 'Done.' where id = $1`,
      [unassigned],
    );
    await signInApp("tenant");
    await data.reopenMaintenanceRequestNotFixed(unassigned, "Not done.");
    expect((await status(unassigned)).status).toBe("Open");
  });
});

describe("[WF5] the work-photo cap counts the current visit only", () => {
  test("a job reopened with 5 work photos still takes the new proof", async () => {
    const id = await startedBySam("Leaking trap");
    for (let i = 1; i <= 5; i += 1) await data.uploadMaintenancePhoto(id, pngFile(`first-${i}.png`));
    await expect(data.uploadMaintenancePhoto(id, pngFile("first-6.png"))).rejects.toThrow(/at most 5 work photos/);
    expect(await complete(id)).toMatchObject({ status: "closed" });

    await signInApp("tenant");
    await data.reopenMaintenanceRequestNotFixed(id, "Still leaking under the sink.");

    await signInApp("worker");
    await data.updateWorkOrder(id, { status: "in_progress" }, { previousStatus: "scheduled" });
    await expect(complete(id, "Resealed the trap.")).rejects.toThrow(/photo of the finished work/);
    await data.uploadMaintenancePhoto(id, pngFile("second-visit.png"));
    expect(await complete(id, "Resealed the trap.")).toMatchObject({ status: "closed" });
    expect(await photoRows(id)).toHaveLength(6);
  });

  test("a worker cannot back-date a photo out of the current visit", async () => {
    const id = await startedBySam("Loose hinge");
    const { data: me } = await sam.auth.getUser();
    const { data: row, error } = await sam
      .from("MaintenanceRequestPhotos")
      .insert({
        maintenance_request_id: id,
        storage_path: `${id}/${randomUUID()}.png`,
        uploaded_by_user_id: me.user!.id,
        uploaded_by_role: "maintenance",
        created_at: "2020-01-01T00:00:00Z",
      })
      .select("created_at")
      .single();
    expect(error).toBeNull();
    expect(Date.now() - Date.parse(row!.created_at)).toBeLessThan(60_000);
  });
});
