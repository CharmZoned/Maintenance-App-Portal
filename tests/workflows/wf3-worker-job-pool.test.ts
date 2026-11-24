/**
 * WF3 — Worker job pool
 *
 *   Tenant reports a problem  →  admin sets the date, time and prices and pushes
 *   the job  →  workers whose services match see it  →  the first to accept
 *   gets it (there is no decline: the others just leave it)  →  the worker can
 *   release it back to the admin, or do the work and complete it with a photo
 *   →  the tenant confirms it is fixed, or says it is not.
 *
 * Also checks what the pool must NOT leak: a worker looking at an available job
 * sees the problem, photos, address, price and date, but not the conversation,
 * the history or the tenant's record, and a worker can never change the price
 * or the date.
 *
 * There are two prices, because Landlord Gopher keeps the difference: what the
 * worker is paid and what the landlord is billed. Each side sees only its own;
 * the tenant sees neither.
 *
 * Maintenance staff and vendors are the same thing: a Staff row with a company,
 * phone and services. Sam Fixit takes plumbing; Riley Wrench takes electrical.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, test } from "vitest";
import * as data from "@/lib/data";
import { clientFor, expectDenied, expectOk, pngFile, resetWorld, signInApp, sql, type World } from "../support/harness";

let world: World;
let admin: SupabaseClient;
let sam: SupabaseClient;
let riley: SupabaseClient;
let tenant: SupabaseClient;
let tenant2: SupabaseClient;
let landlord: SupabaseClient;

type Request = {
  id: number;
  status: string;
  assigned_staff_id: number | null;
  scheduled_for: string | null;
  offered_at: string | null;
  accepted_at: string | null;
  released_at: string | null;
  released_by_staff_id: number | null;
  tenant_fix_response: string | null;
  tenant_fix_note: string | null;
};

const inDays = (d: number, hourUtc: number) => {
  const t = new Date(Date.now() + d * 24 * 3600 * 1000);
  t.setUTCHours(hourUtc, 30, 0, 0);
  return t.toISOString();
};

async function newRequest(title: string, category = "Plumbing"): Promise<number> {
  const [row] = await sql<{ id: string }>(
    `insert into public."MaintenanceRequests"
       (unit_id, property_id, submitted_by_tenant_id, title, description, category, permission_to_enter)
     values ($1, $2, $3, $4, 'Details from the tenant.', $5, true) returning id`,
    [world.units.a.id, world.property.id, world.tenants.tenant.id, title, category],
  );
  return Number(row.id);
}

async function push(requestId: number, workerPrice = 140, when = inDays(1, 14), landlordPrice = 190): Promise<Request> {
  return expectOk(
    await admin.rpc("offer_maintenance_request", {
      p_request_id: requestId,
      p_scheduled_for: when,
      p_worker_price: workerPrice,
      p_landlord_price: landlordPrice,
    }),
    "admin pushes the job",
  ) as Request;
}

/** The price(s) a login can read for a request: [worker price, landlord price]. */
async function pricesSeenBy(client: SupabaseClient, requestId: number): Promise<[number | null, number | null]> {
  const read = async (table: string) => {
    const { data } = await client.from(table).select("amount").eq("maintenance_request_id", requestId);
    return data?.length ? Number(data[0].amount) : null;
  };
  return [await read("MaintenanceRequestWorkerPrices"), await read("MaintenanceRequestLandlordPrices")];
}

async function row(requestId: number): Promise<Request> {
  const [r] = await sql<Request>(`select * from public."MaintenanceRequests" where id = $1`, [requestId]);
  return r;
}

const TENANT_CONTACT = {
  email: "tenant@test.local",
  mobile_phone: "(410) 555-0142",
  emergency_contact: "Rae Renter (410) 555-0143",
};
const NO_CONTACT = { email: null, mobile_phone: null, emergency_contact: null };

/** What a login reads of Tina's tenant record: name plus the three contact fields. */
async function tenantRecordSeenBy(client: SupabaseClient) {
  const { data } = await client
    .from("Tenants")
    .select("first_name, email, mobile_phone, emergency_contact")
    .eq("id", world.tenants.tenant.id);
  return data ?? [];
}

const visibleIds = async (client: SupabaseClient): Promise<number[]> =>
  ((await client.from("MaintenanceRequests").select("id")).data ?? []).map((r) => Number(r.id));

beforeAll(async () => {
  world = await resetWorld();
  await sql(
    `update public."Staff" set company_name = 'Fixit Home Repair', phone = '(410) 555-0171',
       services = '{Plumbing,"General repair"}' where id = $1`,
    [world.staff.worker.id],
  );
  await sql(`update public."Staff" set services = '{Electrical}' where id = $1`, [world.staff.worker2.id]);
  await sql(`update public."Tenants" set mobile_phone = '(410) 555-0142', emergency_contact = 'Rae Renter (410) 555-0143' where id = $1`, [
    world.tenants.tenant.id,
  ]);
  [admin, sam, riley, tenant, tenant2, landlord] = await Promise.all([
    clientFor("admin"),
    clientFor("worker"),
    clientFor("worker2"),
    clientFor("tenant"),
    clientFor("tenant2"),
    clientFor("landlord"),
  ]);
});

describe("[WF3] Worker job pool", () => {
  let requestId: number;
  let photoPath: string;
  const when = inDays(1, 14);

  test("Tenant · reports a leak with a photo", async () => {
    await signInApp("tenant");
    const wo = await data.submitTenantMaintenanceRequest({
      title: "Kitchen faucet leaking",
      description: "Drips constantly, even when fully closed.",
      category: "Plumbing",
      permission_to_enter: true,
    });
    requestId = wo.id;
    photoPath = (await data.uploadMaintenancePhoto(requestId, pngFile("leak.png"))).storage_path;
    await data.addMaintenanceComment(requestId, "It is getting worse.");
  });

  test("Worker · sees nothing until the office pushes the job", async () => {
    expect(await visibleIds(sam)).toEqual([]);
    const accepted = await sam.rpc("accept_maintenance_request", { p_request_id: requestId });
    expect(accepted.error?.message).toMatch(/not available/);
  });

  test("Admin · cannot push a job without a date and a price, and nobody else can push at all", async () => {
    const noDate = await admin.rpc("offer_maintenance_request", {
      p_request_id: requestId,
      p_scheduled_for: null,
      p_worker_price: 140,
    });
    expect(noDate.error?.message).toMatch(/date and time/);
    const noPrice = await admin.rpc("offer_maintenance_request", {
      p_request_id: requestId,
      p_scheduled_for: when,
      p_worker_price: null,
    });
    expect(noPrice.error?.message).toMatch(/worker price/);

    for (const client of [sam, tenant, landlord]) {
      const res = await client.rpc("offer_maintenance_request", {
        p_request_id: requestId,
        p_scheduled_for: when,
        p_worker_price: 1,
      });
      expect(res.error?.message).toMatch(/Only admins/);
    }
    expect((await row(requestId)).offered_at).toBeNull();
  });

  test("Admin · sets the date, time and both prices and pushes the job to workers", async () => {
    const offered = await push(requestId, 140, when, 190);
    expect(offered).toMatchObject({ status: "Open", assigned_staff_id: null });
    expect(offered, "the request row itself carries no money").not.toHaveProperty("cost");
    expect(await pricesSeenBy(admin, requestId)).toEqual([140, 190]);
    expect(new Date(offered.scheduled_for!).toISOString()).toBe(when);
    expect(offered.offered_at).toBeTruthy();
  });

  test("Worker · sees the problem, photo, address, price and date before accepting", async () => {
    const { data: jobs } = await sam
      .from("MaintenanceRequests")
      .select("id, title, description, category, scheduled_for, unit_id, property_id")
      .eq("id", requestId);
    expect(jobs).toHaveLength(1);
    expect(jobs![0]).toMatchObject({ title: "Kitchen faucet leaking", category: "Plumbing" });
    expect(await pricesSeenBy(sam, requestId), "the worker sees their price, never the landlord's").toEqual([140, null]);
    expect(new Date(jobs![0].scheduled_for).toISOString()).toBe(when);

    const { data: locations } = await sam.rpc("list_available_job_locations");
    expect(locations).toEqual([
      {
        maintenance_request_id: requestId,
        unit_label: "1A",
        property_name: "Maple Court",
        street_address: "12 Maple St",
        city: "Baltimore",
        state: "MD",
        zip: "21201",
      },
    ]);

    const { data: photos } = await sam
      .from("MaintenanceRequestPhotos")
      .select("storage_path")
      .eq("maintenance_request_id", requestId);
    expect(photos).toEqual([{ storage_path: photoPath }]);
    const signed = await sam.storage.from("maintenance-photos").createSignedUrl(photoPath, 60);
    expect(signed.error, "the worker can open the tenant's photo").toBeNull();
  });

  test("Worker · does not see the conversation, the history or the tenant before accepting", async () => {
    expect((await sam.from("MaintenanceRequestComments").select("id").eq("maintenance_request_id", requestId)).data).toEqual(
      [],
    );
    expect(
      (await sam.from("MaintenanceRequestStatusHistory").select("id").eq("maintenance_request_id", requestId)).data,
    ).toEqual([]);
    expect((await sam.from("Tenants").select("id")).data).toEqual([]);
    expectDenied(
      await sam
        .from("MaintenanceRequestComments")
        .insert({ maintenance_request_id: requestId, body: "Hi", visibility: "tenant_visible" })
        .select(),
      "no chat before accepting",
    );
    // The address comes from list_available_job_locations() only: the unit and
    // property records (notes, rent, listing details) stay closed.
    expect((await sam.from("Units").select("id, notes")).data).toEqual([]);
    expect((await sam.from("Properties").select("id, notes")).data).toEqual([]);
  });

  test("Worker with other services · does not see the job and cannot accept it", async () => {
    expect(await visibleIds(riley)).toEqual([]);
    expect((await riley.from("Properties").select("id")).data).toEqual([]);
    expect((await riley.rpc("list_available_job_locations")).data).toEqual([]);
    for (const client of [tenant, landlord]) {
      expect((await client.rpc("list_available_job_locations")).data).toEqual([]);
    }
    const res = await riley.rpc("accept_maintenance_request", { p_request_id: requestId });
    expect(res.error?.message).toMatch(/not available/);
  });

  test("Worker · cannot grab the job, or change its price or date, by editing the request", async () => {
    const mr = () => sam.from("MaintenanceRequests");
    expectDenied(await mr().update({ assigned_staff_id: world.staff.worker.id }).eq("id", requestId).select());
    expectDenied(await mr().update({ scheduled_for: inDays(5, 9) }).eq("id", requestId).select());
    expectDenied(
      await sam.from("MaintenanceRequestWorkerPrices").update({ amount: 900 }).eq("maintenance_request_id", requestId).select(),
    );
    expect(await row(requestId)).toMatchObject({ assigned_staff_id: null, status: "Open" });
    expect(await pricesSeenBy(admin, requestId)).toEqual([140, 190]);
  });

  test("Tenant and landlord · cannot accept jobs", async () => {
    for (const client of [tenant, landlord]) {
      const res = await client.rpc("accept_maintenance_request", { p_request_id: requestId });
      expect(res.error?.message).toMatch(/approved worker/);
    }
  });

  test("Worker · accepts the job: it is theirs, at the admin's date and price", async () => {
    const accepted = expectOk(
      await sam.rpc("accept_maintenance_request", { p_request_id: requestId }),
      "Sam accepts",
    ) as Request;
    expect(accepted).toMatchObject({ status: "Scheduled", assigned_staff_id: world.staff.worker.id });
    expect(await pricesSeenBy(sam, requestId)).toEqual([140, null]);
    expect(new Date(accepted.scheduled_for!).toISOString()).toBe(when);
    expect(accepted.accepted_at).toBeTruthy();
  });

  test("Another worker · is told the job is already taken", async () => {
    await sql(`update public."Staff" set services = '{Plumbing,Electrical}' where id = $1`, [world.staff.worker2.id]);
    expect(await visibleIds(riley), "an accepted job leaves the pool").toEqual([]);
    const res = await riley.rpc("accept_maintenance_request", { p_request_id: requestId });
    expect(res.error?.message).toMatch(/already been taken/);
    expect((await row(requestId)).assigned_staff_id).toBe(world.staff.worker.id);
  });

  test("Worker · now sees the tenant and the conversation, and can reply", async () => {
    expect((await sam.from("Tenants").select("id")).data).toEqual([{ id: world.tenants.tenant.id }]);
    expect(await tenantRecordSeenBy(sam), "contact details open while the job is open").toEqual([
      { first_name: "Tina", ...TENANT_CONTACT },
    ]);
    expect(await tenantRecordSeenBy(riley), "but not for a worker without the job").toEqual([]);
    expect((await sam.from("Landlords").select("id")).data, "the landlord's record stays closed").toEqual([]);
    const { data: thread } = await sam
      .from("MaintenanceRequestComments")
      .select("body")
      .eq("maintenance_request_id", requestId);
    expect(thread).toEqual([{ body: "It is getting worse." }]);
    await signInApp("worker");
    await data.addMaintenanceComment(requestId, "I'll be there tomorrow afternoon.", "tenant_visible");
  });

  test("Tenant · sees who accepted, and reads the history in plain words", async () => {
    await signInApp("tenant");
    const [mine] = await data.listWorkOrders();
    expect(mine).toMatchObject({ id: requestId, status: "scheduled", assigned_staff_id: world.staff.worker.id });
    const trail = await data.listMaintenanceStatusHistory(requestId);
    expect(trail.map((h) => h.note)).toEqual(["Created", "Offered to workers", "Accepted by worker"]);
  });

  test("Worker · still cannot change the price or the date after accepting", async () => {
    const prices = () => sam.from("MaintenanceRequestWorkerPrices");
    expectDenied(await prices().update({ amount: 900 }).eq("maintenance_request_id", requestId).select());
    expectDenied(await prices().delete().eq("maintenance_request_id", requestId).select());
    expectDenied(
      await sam.from("MaintenanceRequestLandlordPrices").insert({ maintenance_request_id: requestId, amount: 1 }).select(),
    );
    const date = await sam
      .from("MaintenanceRequests")
      .update({ scheduled_for: inDays(5, 9) })
      .eq("id", requestId)
      .select();
    expect(date.error?.message).toMatch(/Only admins/);
    expect(await pricesSeenBy(admin, requestId)).toEqual([140, 190]);
  });

  test("Everyone · sees only their own price: worker pay, landlord bill, tenant neither", async () => {
    expect(await pricesSeenBy(sam, requestId), "assigned worker").toEqual([140, null]);
    expect(await pricesSeenBy(landlord, requestId), "owning landlord").toEqual([null, 190]);
    expect(await pricesSeenBy(tenant, requestId), "reporting tenant").toEqual([null, null]);
    expect(await pricesSeenBy(riley, requestId), "a worker who did not get the job").toEqual([null, null]);

    // The same holds through the app's own data layer.
    const seen = async (persona: "admin" | "worker" | "landlord" | "tenant") => {
      await signInApp(persona);
      const wo = (await data.listWorkOrders()).find((w) => w.id === requestId)!;
      return [wo.worker_price, wo.landlord_price];
    };
    expect(await seen("admin")).toEqual([140, 190]);
    expect(await seen("worker")).toEqual([140, null]);
    expect(await seen("landlord")).toEqual([null, 190]);
    expect(await seen("tenant")).toEqual([null, null]);
  });

  test("Admin · changes either price from the work order", async () => {
    await signInApp("admin");
    const saved = await data.updateWorkOrder(requestId, { worker_price: 150, landlord_price: 210 });
    expect(saved).toMatchObject({ worker_price: 150, landlord_price: 210 });
    expect(await pricesSeenBy(sam, requestId)).toEqual([150, null]);
  });

  test("Worker · cannot complete the job without a photo of the finished work", async () => {
    await signInApp("worker");
    await data.updateWorkOrder(requestId, { status: "in_progress" }, { previousStatus: "scheduled" });
    await expect(
      data.updateWorkOrder(
        requestId,
        { status: "closed", resolution_notes: "Replaced the cartridge." },
        { previousStatus: "in_progress" },
      ),
    ).rejects.toThrow(/photo of the finished work/);
  });

  test("Worker · uploads a photo and completes the job", async () => {
    await signInApp("worker");
    await data.uploadMaintenancePhoto(requestId, pngFile("new-cartridge.png"));
    const closed = await data.updateWorkOrder(
      requestId,
      { status: "closed", resolution_notes: "Replaced the cartridge." },
      { previousStatus: "in_progress" },
    );
    expect(closed).toMatchObject({ status: "closed" });
  });

  test("Worker · once the job is completed, the tenant's contact details are hidden again", async () => {
    expect(await tenantRecordSeenBy(sam), "the name stays on the finished job; the contact details go").toEqual([
      { first_name: "Tina", ...NO_CONTACT },
    ]);
    expect((await sam.from("Landlords").select("id")).data).toEqual([]);
    // Nothing changes for the people who are meant to have them.
    expect(await tenantRecordSeenBy(admin)).toEqual([{ first_name: "Tina", ...TENANT_CONTACT }]);
    // Owners get name, email and phone, never the emergency contact (20261124091000).
    expect(await tenantRecordSeenBy(landlord)).toEqual([
      { first_name: "Tina", ...TENANT_CONTACT, emergency_contact: null },
    ]);
    expect(await tenantRecordSeenBy(tenant)).toEqual([{ first_name: "Tina", ...TENANT_CONTACT }]);
  });

  test("Tenant · only the tenant who reported it can answer, and only once it is completed", async () => {
    for (const client of [tenant2, sam, landlord, admin]) {
      const res = await client.rpc("confirm_maintenance_request_fixed", { p_request_id: requestId, p_fixed: true });
      expect(res.error?.message).toMatch(/Only the tenant who reported/);
    }
    const open = await newRequest("Still open");
    const early = await tenant.rpc("confirm_maintenance_request_fixed", { p_request_id: open, p_fixed: true });
    expect(early.error?.message).toMatch(/not completed yet/);
    expectDenied(
      await sam.from("MaintenanceRequests").update({ tenant_fix_response: "confirmed" }).eq("id", requestId).select(),
      "a worker cannot confirm their own fix",
    );
  });

  test("Tenant · says it is still a problem, and the admin reopens it", async () => {
    const answered = expectOk(
      await tenant.rpc("confirm_maintenance_request_fixed", {
        p_request_id: requestId,
        p_fixed: false,
        p_note: "Still dripping this morning.",
      }),
      "tenant answers",
    ) as Request;
    expect(answered).toMatchObject({
      status: "Closed",
      tenant_fix_response: "not_fixed",
      tenant_fix_note: "Still dripping this morning.",
    });

    await signInApp("admin");
    await data.updateWorkOrder(requestId, { status: "in_progress" }, { previousStatus: "closed" });
    expect(await row(requestId), "reopening clears the tenant's answer").toMatchObject({
      status: "In Progress",
      tenant_fix_response: null,
      tenant_fix_note: null,
    });
    expect(await tenantRecordSeenBy(sam), "a reopened job is open again, so the worker can reach the tenant").toEqual([
      { first_name: "Tina", ...TENANT_CONTACT },
    ]);
  });

  test("Tenant · confirms it is fixed after the second visit", async () => {
    await signInApp("worker");
    const closeAgain = () =>
      data.updateWorkOrder(
        requestId,
        { status: "closed", resolution_notes: "Re-seated the cartridge and replaced the O-ring." },
        { previousStatus: "in_progress" },
      );
    await expect(closeAgain(), "the photo from before the reopen does not prove the second fix").rejects.toThrow(
      /photo of the finished work/,
    );
    await data.uploadMaintenancePhoto(requestId, pngFile("second-visit.png"));
    await closeAgain();
    const answered = expectOk(
      await tenant.rpc("confirm_maintenance_request_fixed", { p_request_id: requestId, p_fixed: true }),
      "tenant confirms",
    ) as Request;
    expect(answered).toMatchObject({ tenant_fix_response: "confirmed", tenant_fix_note: null });
  });

  describe("releasing a job", () => {
    let releaseId: number;

    test("Worker · accepts a second job, then must give a reason to release it", async () => {
      releaseId = await newRequest("Dishwasher not draining");
      await push(releaseId, 120);
      expectOk(await sam.rpc("accept_maintenance_request", { p_request_id: releaseId }), "Sam accepts");

      const noReason = await sam.rpc("release_maintenance_request", { p_request_id: releaseId, p_reason: "  " });
      expect(noReason.error?.message).toMatch(/Say why/);
      const notMine = await riley.rpc("release_maintenance_request", { p_request_id: releaseId, p_reason: "x" });
      expect(notMine.error?.message).toMatch(/not assigned to you/);
    });

    test("Worker · releases it: the job goes back to the admin, not back into the pool", async () => {
      expectOk(
        await sam.rpc("release_maintenance_request", { p_request_id: releaseId, p_reason: "Van broke down." }),
        "Sam releases",
      );
      const released = await row(releaseId);
      expect(released).toMatchObject({
        status: "Open",
        assigned_staff_id: null,
        offered_at: null,
        accepted_at: null,
        released_by_staff_id: world.staff.worker.id,
      });
      expect(released.released_at).toBeTruthy();
      expect(released.scheduled_for, "the admin's date is kept for whoever takes it next").toBeTruthy();

      expect(await pricesSeenBy(admin, releaseId), "prices are kept for whoever takes it next").toEqual([120, 190]);
      expect(await visibleIds(sam), "the releasing worker no longer sees it").not.toContain(releaseId);
      expect(await pricesSeenBy(sam, releaseId), "or its price").toEqual([null, null]);
      expect(await visibleIds(riley), "and it is not offered to anyone else").not.toContain(releaseId);
    });

    test("Admin · reads the reason; the tenant never does", async () => {
      const { data: officeThread } = await admin
        .from("MaintenanceRequestComments")
        .select("body, visibility, author_role")
        .eq("maintenance_request_id", releaseId);
      expect(officeThread).toEqual([
        { body: "Released this job: Van broke down.", visibility: "internal", author_role: "maintenance" },
      ]);
      expect(
        (await tenant.from("MaintenanceRequestComments").select("id").eq("maintenance_request_id", releaseId)).data,
      ).toEqual([]);
      const { data: trail } = await tenant
        .from("MaintenanceRequestStatusHistory")
        .select("note")
        .eq("maintenance_request_id", releaseId)
        .order("id");
      expect(trail?.map((h) => h.note)).toEqual(["Created", "Offered to workers", "Accepted by worker", "Released by worker"]);
    });

    test("Admin · reassigns the released job to another worker directly", async () => {
      await signInApp("admin");
      const reassigned = await data.updateWorkOrder(
        releaseId,
        { status: "scheduled", assigned_staff_id: world.staff.worker2.id, scheduled_at: inDays(2, 15) },
        { previousStatus: "open" },
      );
      expect(reassigned).toMatchObject({ status: "scheduled", assigned_staff_id: world.staff.worker2.id });
      expect(await visibleIds(riley)).toContain(releaseId);
    });
  });

  describe("the pool", () => {
    test("when two workers accept at the same moment, exactly one gets the job", async () => {
      await sql(`update public."Staff" set services = '{Plumbing}' where id = any($1::bigint[])`, [
        `{${world.staff.worker.id},${world.staff.worker2.id}}`,
      ]);
      const id = await newRequest("Race for the job");
      await push(id, 80);
      const results = await Promise.all([
        sam.rpc("accept_maintenance_request", { p_request_id: id }),
        riley.rpc("accept_maintenance_request", { p_request_id: id }),
      ]);
      expect(results.filter((r) => r.error === null)).toHaveLength(1);
      expect(results.find((r) => r.error)?.error?.message).toMatch(/already been taken/);
    });

    test("an admin can withdraw a pushed job before anyone accepts it", async () => {
      const id = await newRequest("Pushed by mistake");
      await push(id, 60);
      expect(await visibleIds(sam)).toContain(id);
      const denied = await sam.rpc("withdraw_maintenance_offer", { p_request_id: id });
      expect(denied.error?.message).toMatch(/Only admins/);

      expectOk(await admin.rpc("withdraw_maintenance_offer", { p_request_id: id }), "admin withdraws");
      expect(await visibleIds(sam)).not.toContain(id);
      expect((await row(id)).offered_at).toBeNull();
    });

    test("a pushed job cannot lose its date or price while it waits", async () => {
      const id = await newRequest("Keeps its terms");
      await push(id, 60);
      const noDate = await admin.from("MaintenanceRequests").update({ scheduled_for: null }).eq("id", id).select();
      expect(noDate.error?.message).toMatch(/requests_offered_details/);
      const noPrice = await admin.from("MaintenanceRequestWorkerPrices").delete().eq("maintenance_request_id", id).select();
      expect(noPrice.error?.message).toMatch(/Withdraw the job/);
    });

    test("a worker waiting for approval sees no jobs and cannot accept", async () => {
      const id = await newRequest("Not for pending accounts");
      await push(id, 60);
      const pending = await clientFor("pending");
      expect(await visibleIds(pending)).toEqual([]);
      const res = await pending.rpc("accept_maintenance_request", { p_request_id: id });
      expect(res.error?.message).toMatch(/approved worker/);
    });

    test("a tenant's five photos no longer block the worker's completion photo", async () => {
      const id = await newRequest("Photo room");
      await signInApp("tenant");
      for (let i = 0; i < 5; i++) await data.uploadMaintenancePhoto(id, pngFile(`t${i}.png`));
      await expect(data.uploadMaintenancePhoto(id, pngFile("t6.png"))).rejects.toThrow(/at most 5 photos/);

      await push(id, 60);
      expectOk(await sam.rpc("accept_maintenance_request", { p_request_id: id }), "Sam accepts");
      await signInApp("worker");
      for (let i = 0; i < 5; i++) await data.uploadMaintenancePhoto(id, pngFile(`w${i}.png`));
      await expect(data.uploadMaintenancePhoto(id, pngFile("w6.png"))).rejects.toThrow(/at most 5 work photos/);
    });
  });

  describe("the completion photo is this worker's, from this hold of the job", () => {
    test("a previous worker's photo does not let the next worker complete", async () => {
      const id = await newRequest("Handed over mid-job");
      await push(id, 90);
      expectOk(await sam.rpc("accept_maintenance_request", { p_request_id: id }), "Sam accepts");
      await signInApp("worker");
      await data.uploadMaintenancePhoto(id, pngFile("sams-progress.png"));
      expectOk(await sam.rpc("release_maintenance_request", { p_request_id: id, p_reason: "Out sick." }), "Sam releases");

      await signInApp("admin");
      await data.updateWorkOrder(
        id,
        { status: "scheduled", assigned_staff_id: world.staff.worker2.id, scheduled_at: inDays(2, 15) },
        { previousStatus: "open" },
      );

      await signInApp("worker2");
      await data.updateWorkOrder(id, { status: "in_progress" }, { previousStatus: "scheduled" });
      const close = () =>
        data.updateWorkOrder(id, { status: "closed", resolution_notes: "Finished the job." }, { previousStatus: "in_progress" });
      await expect(close()).rejects.toThrow(/photo of the finished work/);
      await data.uploadMaintenancePhoto(id, pngFile("rileys-finish.png"));
      expect(await close()).toMatchObject({ status: "closed" });
    });

    test("a worker who releases and is given the job back needs a new photo", async () => {
      const id = await newRequest("Back to the same worker");
      await push(id, 90);
      expectOk(await sam.rpc("accept_maintenance_request", { p_request_id: id }), "Sam accepts");
      await signInApp("worker");
      await data.uploadMaintenancePhoto(id, pngFile("first-go.png"));
      expectOk(await sam.rpc("release_maintenance_request", { p_request_id: id, p_reason: "Wrong part." }), "Sam releases");

      await signInApp("admin");
      await data.updateWorkOrder(
        id,
        { status: "scheduled", assigned_staff_id: world.staff.worker.id, scheduled_at: inDays(2, 15) },
        { previousStatus: "open" },
      );

      await signInApp("worker");
      await data.updateWorkOrder(id, { status: "in_progress" }, { previousStatus: "scheduled" });
      const close = () =>
        data.updateWorkOrder(id, { status: "closed", resolution_notes: "Fitted the right part." }, { previousStatus: "in_progress" });
      await expect(close()).rejects.toThrow(/photo of the finished work/);
      await data.uploadMaintenancePhoto(id, pngFile("second-go.png"));
      expect(await close()).toMatchObject({ status: "closed" });
    });

    test("uploads fired at the same moment still cannot pass the cap of 5", async () => {
      const id = await newRequest("Upload race");
      await signInApp("tenant");
      const results = await Promise.allSettled(
        Array.from({ length: 8 }, (_, i) => data.uploadMaintenancePhoto(id, pngFile(`race-${i}.png`))),
      );
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(5);
      const [{ n }] = await sql<{ n: string }>(
        `select count(*)::text as n from public."MaintenanceRequestPhotos" where maintenance_request_id = $1`,
        [id],
      );
      expect(Number(n)).toBe(5);
    });
  });

  describe("services decide which jobs a worker sees", () => {
    test("a worker with no services listed sees no pushed jobs at all", async () => {
      const id = await newRequest("Not for a blank profile");
      await push(id, 70);
      await sql(`update public."Staff" set services = '{}' where id = $1`, [world.staff.worker2.id]);

      expect(await visibleIds(riley)).not.toContain(id);
      expect((await riley.rpc("list_available_job_locations")).data).toEqual([]);
      expect(await pricesSeenBy(riley, id)).toEqual([null, null]);
      expect(
        (await riley.from("MaintenanceRequestPhotos").select("id").eq("maintenance_request_id", id)).data,
      ).toEqual([]);
      const res = await riley.rpc("accept_maintenance_request", { p_request_id: id });
      expect(res.error?.message).toMatch(/not available/);
    });

    test("a name-only profile save leaves the services list exactly as it was", async () => {
      await sql(`update public."Staff" set services = '{Electrical}', company_name = 'Wrench Co', phone = '555-0111' where id = $1`, [
        world.staff.worker2.id,
      ]);
      const pooled = await newRequest("Plumbing job Riley must not see");
      await push(pooled, 70);

      const saved = expectOk(
        await riley.rpc("update_staff_profile", { p_first_name: "Riley", p_last_name: "Wrench-Lee" }),
        "name-only save",
      ) as { last_name: string; services: string[]; company_name: string; phone: string };
      expect(saved).toMatchObject({
        last_name: "Wrench-Lee",
        services: ["Electrical"],
        company_name: "Wrench Co",
        phone: "555-0111",
      });
      expect(await visibleIds(riley), "the save opened nothing").not.toContain(pooled);

      // Clearing is explicit: '' clears company, [] means no jobs.
      const cleared = expectOk(
        await riley.rpc("update_staff_profile", { p_company_name: "", p_services: [] }),
        "explicit clear",
      ) as { last_name: string; services: string[]; company_name: string | null; phone: string };
      expect(cleared).toMatchObject({ last_name: "Wrench-Lee", services: [], company_name: null, phone: "555-0111" });
      expect(await visibleIds(riley)).not.toContain(pooled);

      const blank = await riley.rpc("update_staff_profile", { p_first_name: "  " });
      expect(blank.error?.message).toMatch(/cannot be blank/);
    });
  });

  describe("worker profile", () => {
    test("Worker · updates their own name, company, phone and services", async () => {
      const saved = expectOk(
        await sam.rpc("update_staff_profile", {
          p_first_name: "Sam",
          p_last_name: "Fixit",
          p_company_name: "Fixit Home Repair LLC",
          p_phone: "(410) 555-0199",
          p_services: ["Plumbing", "Heating / AC", "Plumbing"],
        }),
        "Sam saves his profile",
      ) as { id: number; company_name: string; phone: string; services: string[]; email: string };
      expect(saved).toMatchObject({
        id: world.staff.worker.id,
        company_name: "Fixit Home Repair LLC",
        phone: "(410) 555-0199",
        services: ["Heating / AC", "Plumbing"],
        email: "worker@test.local",
      });
    });

    test("services must be real maintenance categories, and only staff logins have a staff profile", async () => {
      const bad = await sam.rpc("update_staff_profile", {
        p_first_name: "Sam",
        p_last_name: "Fixit",
        p_services: ["Juggling"],
      });
      expect(bad.error?.message).toMatch(/staff_services_allowed/);
      const notStaff = await tenant.rpc("update_staff_profile", { p_first_name: "Tina", p_last_name: "Renter" });
      expect(notStaff.error?.message).toMatch(/approved staff login/);
      expectDenied(await sam.from("Staff").update({ company_name: "Hacked" }).eq("id", world.staff.worker2.id).select());
    });
  });

  describe("direct chat with the office", () => {
    const say = (client: SupabaseClient, threadUser: string, authorRole: string, body: string) =>
      client
        .from("OfficeMessages")
        .insert({ thread_user_id: threadUser, author_role: authorRole, body })
        .select("id")
        .single();

    test("Worker · writes to the Landlord Gopher office and the admin answers", async () => {
      expectOk(await say(sam, world.users.worker.id, "maintenance", "Can I get the lockbox code for Birch House?"));
      expectOk(await say(admin, world.users.worker.id, "admin", "It's on the job page now."));
      const { data: thread } = await sam.from("OfficeMessages").select("author_role, body").order("id");
      expect(thread).toEqual([
        { author_role: "maintenance", body: "Can I get the lockbox code for Birch House?" },
        { author_role: "admin", body: "It's on the job page now." },
      ]);
    });

    test("Landlord · has their own thread with the office; threads never cross", async () => {
      expectOk(await say(landlord, world.users.landlord.id, "landlord", "When is the boiler service?"));
      expect((await landlord.from("OfficeMessages").select("body")).data).toEqual([
        { body: "When is the boiler service?" },
      ]);
      expect((await sam.from("OfficeMessages").select("id")).data).toHaveLength(2);
      expect((await riley.from("OfficeMessages").select("id")).data).toEqual([]);
      expect((await admin.from("OfficeMessages").select("id")).data).toHaveLength(3);
    });

    test("nobody can write into someone else's thread or pose as another role", async () => {
      expectDenied(await say(sam, world.users.landlord.id, "maintenance", "Hello landlord"));
      expectDenied(await say(sam, world.users.worker.id, "admin", "Posing as the office"));
      expectDenied(await say(admin, world.users.admin.id, "admin", "Admins have no thread of their own"));
      const pending = await clientFor("pending");
      expectDenied(await say(pending, world.users.pending.id, "maintenance", "Not approved yet"));
    });

    test("each person keeps their own unread marker", async () => {
      expectOk(
        await sam
          .from("OfficeThreadReads")
          .upsert({ thread_user_id: world.users.worker.id, last_read_at: new Date().toISOString() })
          .select(),
        "Sam marks his office thread read",
      );
      expectOk(
        await admin
          .from("OfficeThreadReads")
          .upsert({ thread_user_id: world.users.worker.id, last_read_at: new Date().toISOString() })
          .select(),
        "the admin marks Sam's thread read",
      );
      expectDenied(
        await sam.from("OfficeThreadReads").insert({ thread_user_id: world.users.landlord.id }).select(),
        "a worker cannot track someone else's thread",
      );
      expect((await sam.from("OfficeThreadReads").select("thread_user_id")).data).toHaveLength(1);
      expect((await landlord.from("OfficeThreadReads").select("thread_user_id")).data).toEqual([]);
    });

    test("job threads have unread markers too, and the office thread is staff-only", async () => {
      const [mine] = await visibleIds(sam);
      expectOk(
        await sam.from("MaintenanceThreadReads").upsert({ maintenance_request_id: mine, thread: "office" }).select(),
        "worker marks the office notes read",
      );
      const tenantRequest = (await visibleIds(tenant))[0];
      expectOk(
        await tenant
          .from("MaintenanceThreadReads")
          .upsert({ maintenance_request_id: tenantRequest, thread: "shared" })
          .select(),
        "tenant marks the job chat read",
      );
      expectDenied(
        await tenant
          .from("MaintenanceThreadReads")
          .insert({ maintenance_request_id: tenantRequest, thread: "office" })
          .select(),
        "a tenant has no office notes to mark",
      );
    });
  });
});
