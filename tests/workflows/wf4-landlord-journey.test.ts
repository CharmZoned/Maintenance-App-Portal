/**
 * WF4 — Landlord journey
 *
 *   Landlord sees their units  →  opens a unit and sees its requests  →  files
 *   a common-area request with photos  →  the admin sees it in the queue as New
 *   →  the landlord messages the office about it  →  the admin replies from
 *   Messages → Landlords  →  the landlord sees the reply and the unread clears.
 *
 * Each step signs in as that person and calls the same data-layer functions
 * the screens call (src/client/lib/*). Steps run in order and build on each
 * other. The browser version is tests/e2e/wf4-landlord-journey.spec.ts.
 * Plan: docs/landlord-wave-plan.md, LG-Q and section 7.
 */
import { beforeAll, describe, expect, test } from "vitest";
import * as data from "@/lib/data";
import { createLandlordRequest } from "@/lib/landlord-requests";
import { listLandlordsWithPortfolio } from "@/lib/landlord-portfolio";
import {
  countUnreadOfficeMessages,
  getOfficeThreadReadAt,
  listOfficeMessages,
  listOfficeThreads,
  markOfficeThreadRead,
  sendOfficeMessage,
} from "@/lib/office-messages";
import { landlordNextStep, priorityLabel, statusLabel } from "@/lib/request-status";
import { clientFor, pngFile, resetWorld, signInApp, sql, type World } from "../support/harness";

let world: World;
let unitRequestId: number;
let filedId: number;

const TITLE = "Hallway light out by the front door";
const QUESTION = "I filed a request for the hallway light. Can Sam fit it into his next visit?";
const REPLY = "Yes, Sam will be there Thursday morning.";

beforeAll(async () => {
  world = await resetWorld();
  // Something already open on Unit 1A, reported by its tenant.
  const [row] = await sql<{ id: string }>(
    `insert into public."MaintenanceRequests"
       (unit_id, property_id, submitted_by_tenant_id, title, description, category, permission_to_enter)
     values ($1, $2, $3, 'Kitchen faucet dripping', 'Drips about once a second.', 'Plumbing', true) returning id`,
    [world.units.a.id, world.property.id, world.tenants.tenant.id],
  );
  unitRequestId = Number(row.id);
});

describe("[WF4] Landlord journey", () => {
  test("Landlord · sees their units", async () => {
    await signInApp("landlord");
    const properties = await data.listProperties();
    expect(properties.map((p) => p.name), "one property, not the other landlord's").toEqual(["Maple Court"]);
    const units = await data.listUnits(world.property.id);
    expect(units.map((u) => u.name).sort()).toEqual(["1A", "2B"]);
  });

  test("Landlord · opens a unit and sees its requests", async () => {
    await signInApp("landlord");
    // The unit page reads the property's requests and keeps the unit's own.
    const forUnit = (await data.listWorkOrders({ property_id: world.property.id })).filter((w) => w.unit_id === world.units.a.id);
    expect(forUnit.map((w) => w.id)).toEqual([unitRequestId]);
    const [faucet] = forUnit;
    expect(statusLabel(faucet, "landlord")).toBe("New");
    expect(priorityLabel(faucet.priority)).toBe("Normal");
    expect(landlordNextStep(faucet)).toMatchObject({ who: "office", text: expect.stringMatching(/Nothing needed from you/) });
  });

  test("Landlord · files a request with photos", async () => {
    await signInApp("landlord");
    const result = await createLandlordRequest({
      property_id: world.property.id,
      unit_id: null, // common area
      title: TITLE,
      description: "The ceiling light in the front hallway has stopped working.",
      category: "Electrical",
      priority: "normal",
      permission_to_enter: false,
      photos: [pngFile("hallway-1.png"), pngFile("hallway-2.png")],
    });
    expect(result).toMatchObject({ photosUploaded: 2, photoError: null });
    filedId = result.request.id;
    expect(result.request).toMatchObject({ status: "open", unit_id: null, property_id: world.property.id });

    const [row] = await sql<{ submitted_by_landlord_id: number; submitted_by_tenant_id: number | null }>(
      `select submitted_by_landlord_id, submitted_by_tenant_id from public."MaintenanceRequests" where id = $1`,
      [filedId],
    );
    expect(row).toEqual({ submitted_by_landlord_id: world.landlord.id, submitted_by_tenant_id: null });

    const mine = await data.listWorkOrders();
    expect(mine.map((w) => w.id), "it is in the landlord's own list").toContain(filedId);
    expect(await data.listMaintenancePhotos(filedId)).toHaveLength(2);

    // A common-area request is not shown to the building's tenants (D3).
    const tina = await clientFor("tenant");
    expect((await tina.from("MaintenanceRequests").select("id").eq("id", filedId)).data).toEqual([]);
  });

  test("Admin · sees it in the queue", async () => {
    await signInApp("admin");
    const queue = await data.listWorkOrders();
    const filed = queue.find((w) => w.id === filedId);
    expect(filed).toMatchObject({
      status: "open",
      title: TITLE,
      property_name: "Maple Court",
      unit_id: null,
      assigned_staff_id: null,
      permission_to_enter: false,
    });
    expect(statusLabel(filed!, "staff")).toBe("New");
    expect(await data.listMaintenancePhotos(filedId), "the admin sees both photos").toHaveLength(2);

    const history = await data.listMaintenanceStatusHistory(filedId);
    expect(history.map((h) => [h.to_status, h.changed_by_role])).toEqual([["Open", "landlord"]]);
  });

  test("Landlord · messages the office about it", async () => {
    await signInApp("landlord");
    const sent = await sendOfficeMessage({ threadUserId: world.users.landlord.id, body: QUESTION, requestId: filedId });
    expect(sent).toMatchObject({ author_role: "landlord", request_id: filedId, body: QUESTION });

    const thread = await listOfficeMessages(world.users.landlord.id);
    expect(thread.map((m) => [m.body, m.request_id])).toEqual([[QUESTION, filedId]]);
  });

  test("Admin · replies from Messages → Landlords", async () => {
    await signInApp("admin");
    const lena = world.users.landlord.id;

    // Messages → Landlords: the landlord's thread is listed and unread.
    const threads = await listOfficeThreads();
    expect(threads.find((t) => t.thread_user_id === lena)).toMatchObject({ unread: true, last_author_role: "landlord" });

    // People → Landlords carries the Message button into the same thread.
    const portfolio = (await listLandlordsWithPortfolio()).find((l) => l.id === world.landlord.id);
    expect(portfolio).toMatchObject({ user_id: lena, unit_count: 2 });
    expect(portfolio!.properties.map((p) => p.name)).toEqual(["Maple Court"]);
    expect(portfolio!.open_requests).toBe(2);

    // Opening the thread marks it read; the message shows the request link.
    const thread = await listOfficeMessages(lena);
    expect(thread.at(-1)).toMatchObject({ body: QUESTION, request_id: filedId });
    await markOfficeThreadRead(lena);
    expect((await listOfficeThreads()).find((t) => t.thread_user_id === lena)?.unread).toBe(false);

    const reply = await sendOfficeMessage({ threadUserId: lena, body: REPLY });
    expect(reply).toMatchObject({ author_role: "admin", thread_user_id: lena });
  });

  test("Landlord · sees the reply and the unread clears", async () => {
    await signInApp("landlord");
    const lena = world.users.landlord.id;
    const viewer = { userId: lena, isAdmin: false };

    const thread = await listOfficeMessages(lena);
    expect(thread.map((m) => m.author_role)).toEqual(["landlord", "admin"]);
    expect(thread.at(-1)?.body).toBe(REPLY);
    expect(countUnreadOfficeMessages(thread, viewer, await getOfficeThreadReadAt(lena)), "the reply is unread").toBe(1);

    await markOfficeThreadRead(lena);
    expect(countUnreadOfficeMessages(thread, viewer, await getOfficeThreadReadAt(lena)), "opening the thread clears it").toBe(0);

    // The office thread is the landlord's alone.
    const tina = await clientFor("tenant");
    expect((await tina.from("OfficeMessages").select("id")).data).toEqual([]);
  });
});
