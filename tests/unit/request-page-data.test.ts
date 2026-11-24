/**
 * The request page's single-record reads and the list's batched "Started …"
 * lookup (src/client/lib/data.ts), against the emulator so RLS applies.
 */
import { beforeAll, describe, expect, test } from "vitest";
import * as data from "@/lib/data";
import { inProgressSince } from "@/lib/request-status";
import { resetWorld, signInApp, sql, type World } from "../support/harness";

let world: World;

beforeAll(async () => {
  world = await resetWorld();
});

async function history(requestId: number, toStatus: string, at: string): Promise<void> {
  await sql(
    `insert into public."MaintenanceRequestStatusHistory" (maintenance_request_id, from_status, to_status, created_at)
     values ($1, null, $2, $3::timestamptz)`,
    [requestId, toStatus, at],
  );
}

describe("request page data", () => {
  test("getWorkOrder returns the one request with the same fields as the list, or null under RLS", async () => {
    await signInApp("admin");
    const created = await data.createWorkOrder({
      title: "Hallway light is out",
      property_id: world.property.id,
      unit_id: world.units.a.id,
      priority: "urgent",
    });
    const fromList = (await data.listWorkOrders()).find((w) => w.id === created.id);
    const single = await data.getWorkOrder(created.id);
    expect(single).toEqual(fromList);
    expect(single).toMatchObject({ title: "Hallway light is out", priority: "urgent", property_name: "Maple Court" });
    expect(await data.getWorkOrder(999_999)).toBeNull();

    // An unassigned request is not the worker's to read: null, not an error.
    await signInApp("worker");
    expect(await data.getWorkOrder(created.id)).toBeNull();
  });

  test("listInProgressSince: one query, the latest move to In progress per request", async () => {
    await signInApp("admin");
    const make = (title: string) =>
      data.createWorkOrder({ title, property_id: world.property.id, unit_id: world.units.a.id });
    const twice = await make("Started, held, resumed");
    const never = await make("Never started");
    const mixedCase = await make("Stored with the old label");

    await history(twice.id, "In Progress", "2026-11-10T09:00:00Z");
    await history(twice.id, "On Hold", "2026-11-11T09:00:00Z");
    await history(twice.id, "in_progress", "2026-11-12T09:00:00Z");
    await history(twice.id, "Closed", "2026-11-13T09:00:00Z");
    await history(never.id, "Scheduled", "2026-11-12T09:00:00Z");
    await history(mixedCase.id, "In Progress", "2026-11-14T08:30:00Z");

    const since = await data.listInProgressSince([twice.id, never.id, mixedCase.id, twice.id]);
    expect(since.size).toBe(3);
    expect(Date.parse(since.get(twice.id)!)).toBe(Date.parse("2026-11-12T09:00:00Z"));
    expect(since.get(never.id)).toBeNull();
    expect(Date.parse(since.get(mixedCase.id)!)).toBe(Date.parse("2026-11-14T08:30:00Z"));

    // Same answer as the per-request history the request page uses.
    expect(Date.parse(inProgressSince(await data.listMaintenanceStatusHistory(twice.id))!)).toBe(
      Date.parse(since.get(twice.id)!),
    );

    expect((await data.listInProgressSince([])).size).toBe(0);
  });
});
