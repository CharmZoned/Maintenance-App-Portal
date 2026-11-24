/**
 * R7 — Permissions, on the demo world
 *
 * The demo world (tests/emulator/seed.ts with `demo: true`) is what
 * `pnpm dev:local` and the staging database show. These checks load it and look
 * at it the way each of the four roles does, through the app's own data layer:
 * every role has real things to look at, and nobody sees another role's slice.
 *
 * Every other test file runs on the standard world, so this file puts it back
 * when it is done.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import * as data from "@/lib/data";
import type { DemoWorld } from "../emulator/seed";
import { clientFor, resetWorld, signInApp, signOutApp, sql, type World } from "../support/harness";
import { EMULATOR_URL } from "../support/ports";

let world: World;
let demo: DemoWorld;

/** Wipe the database and load the standard world plus the demo extras. */
async function resetDemoWorld(): Promise<World> {
  await signOutApp();
  const res = await fetch(`${EMULATOR_URL}/__emulator/reset`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ seed: true, demo: true }),
  });
  const json = (await res.json()) as { world: World; message?: string };
  if (!res.ok) throw new Error(`emulator /reset: ${json.message ?? res.status}`);
  return json.world;
}

const sorted = <T extends string | number>(values: T[]) => [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
const ids = (rows: Array<{ id: number }>) => sorted(rows.map((r) => r.id));
const titles = (rows: Array<{ title: string }>) => sorted(rows.map((r) => r.title));

const officeMessages = async (client: SupabaseClient) =>
  ((await client.from("OfficeMessages").select("author_role, body").order("id")).data ?? []) as Array<{
    author_role: string;
    body: string;
  }>;

beforeAll(async () => {
  world = await resetDemoWorld();
  if (!world.demo) throw new Error("the emulator did not load the demo extras");
  demo = world.demo;
});

afterAll(async () => {
  await resetWorld();
});

describe("[R7] Demo world: each role sees its own slice", () => {
  test("Tenant · sees their own requests, rent and documents, and no prices", async () => {
    await signInApp("tenant");

    expect(await data.getTenantHomeContext()).toMatchObject({ unit_label: "1A", property_name: "Maple Court" });

    const requests = await data.listWorkOrders();
    expect(ids(requests), "Tina's three requests, none of Tom's").toEqual(
      sorted([demo.requests.pooled.id, demo.requests.inProgress.id, demo.requests.closed.id]),
    );
    expect(sorted(requests.map((r) => r.status))).toEqual(["closed", "in_progress", "open"]);
    expect(requests.every((r) => r.worker_price === null && r.landlord_price === null), "a tenant sees no price").toBe(true);

    // Newest first: this month is part-paid, the five months before are paid.
    const rent = await data.listChargesForTenantLeases(world.tenants.tenant.id);
    expect(rent.map((c) => c.status)).toEqual(["partial", "paid", "paid", "paid", "paid", "paid"]);
    expect(rent[0]).toMatchObject({ amount: 1450, amount_paid: 700 });
    expect(rent.every((c) => c.lease_id === demo.leases.tenant.id), "only the running lease, not the ended one").toBe(true);

    const documents = await data.listPropertyDocuments({ property_id: world.property.id });
    expect(titles(documents), "their own lease and the building notice").toEqual([
      "Building rules and trash schedule",
      "Lease agreement, Unit 1A",
    ]);

    const trail = await data.listMaintenanceStatusHistory(demo.requests.closed.id);
    expect(trail.map((h) => h.to_status)).toEqual(["Open", "Scheduled", "In Progress", "Closed", "Closed"]);
    expect(trail.map((h) => h.changed_by_role)).toEqual(["tenant", "admin", "maintenance", "maintenance", "tenant"]);
    expect(trail.at(-1)?.note).toBe("Tenant confirmed it is fixed");
    expect(await data.listMaintenanceComments(demo.requests.closed.id)).toHaveLength(2);
    expect(await data.listMaintenanceComments(demo.requests.onHold.id), "not the neighbour's conversation").toEqual([]);
  });

  test("Second tenant · is behind on rent and reads only the shared side of the job chat", async () => {
    await signInApp("tenant2");

    const requests = await data.listWorkOrders();
    expect(ids(requests)).toEqual(
      sorted([demo.requests.pooledElectrical.id, demo.requests.scheduled.id, demo.requests.onHold.id, demo.requests.new.id]),
    );

    // Newest first: this month unpaid, last month overdue, the two before paid.
    const rent = await data.listChargesForTenantLeases(world.tenants.tenant2.id);
    expect(rent).toHaveLength(4);
    expect(rent.slice(1).map((c) => c.status)).toEqual(["overdue", "paid", "paid"]);
    expect(rent[0]).toMatchObject({ amount: 1400, amount_paid: 0 });
    expect(["open", "overdue"], "unpaid: open on the 1st, overdue after").toContain(rent[0].status);

    const chat = await data.listMaintenanceComments(demo.requests.onHold.id);
    expect(chat.map((c) => c.visibility), "the two office-only notes stay hidden").toEqual(["tenant_visible"]);
    expect(titles(await data.listPropertyDocuments({ property_id: world.property.id }))).toEqual([
      "Building rules and trash schedule",
      "Lease agreement, Unit 2B",
    ]);
  });

  test("Worker · sees the pooled job their services match and their own jobs, never the landlord price", async () => {
    await signInApp("worker");
    const jobs = await data.listWorkOrders();
    const job = (id: number) => jobs.find((j) => j.id === id);

    expect(ids(jobs), "one pooled job plus Sam's three; not the electrical job, not the untouched one").toEqual(
      sorted([demo.requests.pooled.id, demo.requests.scheduled.id, demo.requests.onHold.id, demo.requests.closed.id]),
    );
    expect(job(demo.requests.pooled.id), "in the pool: open, nobody's yet, with the worker price").toMatchObject({
      status: "open",
      assigned_staff_id: null,
      worker_price: 140,
    });
    expect(job(demo.requests.scheduled.id), "accepted from the pool").toMatchObject({
      status: "scheduled",
      assigned_staff_id: world.staff.worker.id,
      worker_price: 120,
    });
    expect(job(demo.requests.onHold.id)).toMatchObject({ status: "on_hold", hold_reason: expect.stringMatching(/latch/) });
    expect(jobs.every((j) => j.landlord_price === null), "a worker never sees what the landlord is billed").toBe(true);

    const sam = await clientFor("worker");
    expect((await sam.from("MaintenanceRequestLandlordPrices").select("amount")).data).toEqual([]);
    expect((await sam.rpc("list_available_job_locations")).data).toEqual([
      {
        maintenance_request_id: demo.requests.pooled.id,
        unit_label: "1A",
        property_name: "Maple Court",
        street_address: "12 Maple St",
        city: "Baltimore",
        state: "MD",
        zip: "21201",
      },
    ]);
    expect(await officeMessages(sam), "Sam's own thread with the office").toHaveLength(2);

    // The other worker's trade is different, so their slice is too.
    await signInApp("worker2");
    expect(ids(await data.listWorkOrders())).toEqual(sorted([demo.requests.pooledElectrical.id, demo.requests.inProgress.id]));
  });

  test("Landlord · sees every request on their property with the price they are billed, and the rent", async () => {
    await signInApp("landlord");

    const requests = await data.listWorkOrders();
    const all = Object.values(demo.requests).map((r) => r.id);
    expect(ids(requests), "everything at Maple Court, nothing at Birch House").toEqual(
      sorted(all.filter((id) => id !== demo.requests.otherProperty.id)),
    );
    expect(requests.find((r) => r.id === demo.requests.closed.id)).toMatchObject({ status: "closed", landlord_price: 120 });
    expect(requests.every((r) => r.worker_price === null), "a landlord never sees what the worker is paid").toBe(true);

    const leases = await data.listLeases();
    expect(sorted(leases.map((l) => l.status))).toEqual(["active", "active", "ended"]);
    expect(await data.listCharges()).toHaveLength(10);

    expect(titles(await data.listPropertyDocuments()), "tenant and landlord documents, not the office's").toEqual([
      "Building rules and trash schedule",
      "Lease agreement, Unit 1A",
      "Lease agreement, Unit 2B",
      "Property insurance certificate",
    ]);
    const lena = await clientFor("landlord");
    expect((await officeMessages(lena)).map((m) => m.author_role)).toEqual(["landlord", "admin", "landlord", "admin"]);

    // Landlord wave: the common-area request Lena filed herself, the message
    // about it, and the on-hold job that says what it is waiting on.
    const filed = requests.find((r) => r.id === demo.requests.landlordCommonArea.id);
    expect(filed, "Lena's own common-area request").toMatchObject({ status: "open", unit_id: null, property_id: world.property.id });
    const [filedRow] = await sql<{ submitted_by_landlord_id: number | null; submitted_by_tenant_id: number | null }>(
      `select submitted_by_landlord_id, submitted_by_tenant_id from public."MaintenanceRequests" where id = $1`,
      [demo.requests.landlordCommonArea.id],
    );
    expect(filedRow).toEqual({ submitted_by_landlord_id: world.landlord.id, submitted_by_tenant_id: null });
    expect(await data.listMaintenancePhotos(demo.requests.landlordCommonArea.id), "her photo of it").toHaveLength(1);
    const linked = ((await lena.from("OfficeMessages").select("request_id").not("request_id", "is", null)).data ?? []).map(
      (m) => Number(m.request_id),
    );
    expect(linked, "one office message is about that request").toEqual([demo.requests.landlordCommonArea.id]);
    expect(requests.find((r) => r.id === demo.requests.onHold.id)).toMatchObject({
      status: "on_hold",
      hold_reason: expect.stringMatching(/replacement latch/),
    });
  });

  test("Admin · sees everything: every status, both prices, the ledger and the approval queue", async () => {
    await signInApp("admin");

    const requests = await data.listWorkOrders();
    expect(ids(requests)).toEqual(sorted(Object.values(demo.requests).map((r) => r.id)));
    expect(sorted([...new Set(requests.map((r) => r.status))]), "one of every status").toEqual([
      "closed",
      "in_progress",
      "on_hold",
      "open",
      "scheduled",
    ]);
    expect(requests.find((r) => r.id === demo.requests.closed.id)).toMatchObject({ worker_price: 85, landlord_price: 120 });
    expect(requests.find((r) => r.id === demo.requests.otherProperty.id)).toMatchObject({
      property_name: "Birch House",
      status: "open",
    });

    expect(await data.getDashboardSummary()).toMatchObject({
      properties: 2,
      units: 3,
      active_leases: 2,
      upcoming_move_outs: 1,
      open_work_orders: 8,
      urgent_work_orders: 1,
    });

    const charges = await data.listCharges();
    const count = (status: string) => charges.filter((c) => c.status === status).length;
    expect(charges).toHaveLength(10);
    expect(count("paid")).toBe(7);
    expect(count("partial")).toBe(1);
    expect(count("overdue")).toBeGreaterThanOrEqual(1);
    // The month Tina paid in two parts: both payments are on the ledger.
    const split = charges.filter((c) => c.lease_id === demo.leases.tenant.id).at(-3)!;
    expect((await data.listPayments(split.id)).map((p) => [p.amount, p.method])).toEqual([
      [450, "zelle"],
      [1000, "check"],
    ]);

    expect(await data.listPropertyDocuments()).toHaveLength(demo.documents.length);
    expect(demo.documents).toHaveLength(5);

    const accounts = await data.listUserAccounts();
    expect(accounts.filter((a) => a.account_status === "pending").map((a) => a.email)).toEqual(["pending@test.local"]);

    const admin = await clientFor("admin");
    expect(await officeMessages(admin), "both office threads").toHaveLength(6);
    const tina = await clientFor("tenant");
    expect(await officeMessages(tina), "threads never cross").toEqual([]);
  });

  test("every demo row is flagged as test data", async () => {
    const tables = [
      'public."Landlords"',
      'public."Properties"',
      'public."Units"',
      'public."Staff"',
      'public."Vendors"',
      "private.tenants",
      'public."Leases"',
      'public."RentCharges"',
      'public."Payments"',
      'public."MaintenanceRequests"',
      'public."PropertyDocuments"',
    ];
    for (const table of tables) {
      const [{ flagged, total }] = await sql<{ flagged: number; total: number }>(
        `select count(*) filter (where is_test_data)::int as flagged, count(*)::int as total from ${table}`,
      );
      expect(total, `${table} has rows`).toBeGreaterThan(0);
      expect(flagged, `${table}: every row flagged`).toBe(total);
    }
  });

  test("the standard world the other tests run on has none of the demo extras", async () => {
    const standard = await resetWorld();
    expect(standard.demo).toBeUndefined();
    const [counts] = await sql<Record<string, number>>(
      `select (select count(*)::int from public."Leases") as leases,
              (select count(*)::int from public."RentCharges") as charges,
              (select count(*)::int from public."MaintenanceRequests") as requests,
              (select count(*)::int from public."PropertyDocuments") as documents,
              (select count(*)::int from public."OfficeMessages") as messages,
              (select count(*)::int from public."Staff" where services <> '{}' or is_test_data) as changed_staff`,
    );
    expect(counts).toEqual({ leases: 0, charges: 0, requests: 0, documents: 0, messages: 0, changed_staff: 0 });
  });
});
