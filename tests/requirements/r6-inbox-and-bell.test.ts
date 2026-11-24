/**
 * R6 — Messaging: one definition of "new activity" for every role, and a bell
 * built on real events with saved read state. Runs on the demo world that
 * `pnpm dev:local` shows (tests/emulator/seed.ts with `demo: true`), then puts
 * the standard world back.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  announceInboxChanged,
  countInboxUnread,
  loadInbox,
  markConversationRead,
  type InboxViewer,
} from "@/lib/inbox";
import { currentNotificationViewer, loadNotifications, markAllNotificationsRead } from "@/lib/notifications";
import { supabase } from "@/lib/supabase";
import type { DemoWorld } from "../emulator/seed";
import { clientFor, resetWorld, signInApp, signOutApp, sql, type World } from "../support/harness";
import { EMULATOR_URL } from "../support/ports";

let demo: DemoWorld;

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

async function viewerFor(role: InboxViewer["role"]): Promise<InboxViewer> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return { role, userId: session?.user.id ?? null };
}

beforeAll(async () => {
  const world = await resetDemoWorld();
  if (!world.demo) throw new Error("the emulator did not load the demo extras");
  demo = world.demo;
});

afterAll(async () => {
  await resetWorld();
});

describe("[R6] Inbox read state for tenants, landlords and technicians", () => {
  test("a technician's comment is unread for the tenant until she reads it, and stays read after a reload", async () => {
    await signInApp("tenant");
    const tina = await viewerFor("tenant");
    const key = `wo:${demo.requests.inProgress.id}`;

    const before = await loadInbox(tina);
    const conversation = before.find((c) => c.key === key);
    expect(conversation?.unread).toBe(true);
    // Tenants never see internal notes, so none of their conversations is built from one.
    expect(await countInboxUnread(tina)).toBe(before.filter((c) => c.unread).length);

    await markConversationRead(conversation!, conversation!.last.at, tina);
    announceInboxChanged();
    const after = await loadInbox(tina);
    expect(after.find((c) => c.key === key)?.unread).toBe(false);
  });

  test("RLS: a tenant keeps a shared-thread read row, never an internal one", async () => {
    const tenant = await clientFor("tenant");
    const office = await tenant
      .from("MaintenanceThreadReads")
      .upsert({ maintenance_request_id: demo.requests.inProgress.id, thread: "office", last_read_at: new Date().toISOString() });
    expect(office.error).not.toBeNull();
  });

  test("an office reply is unread for the technician; his own reply answers it", async () => {
    await signInApp("worker");
    const sam = await viewerFor("maintenance");
    const key = `office:${sam.userId}`;
    // The demo thread ends with the office's reply, which Sam has not opened.
    expect((await loadInbox(sam)).find((c) => c.key === key)?.unread).toBe(true);

    const { error } = await supabase
      .from("OfficeMessages")
      .insert({ thread_user_id: sam.userId!, author_user_id: sam.userId, author_role: "maintenance", body: "Thanks!" });
    expect(error).toBeNull();
    announceInboxChanged();
    expect((await loadInbox(sam)).find((c) => c.key === key)?.unread).toBe(false);
  });

  test("a landlord's inbox is their office thread only", async () => {
    await signInApp("landlord");
    const lena = await viewerFor("landlord");
    const inbox = await loadInbox(lena);
    expect(inbox.every((c) => c.kind === "office" && c.threadUserId === lena.userId)).toBe(true);
  });
});

describe("[R6] The bell", () => {
  test("a completed request reaches its tenant in the second person, and Mark all read survives a reload", async () => {
    await sql(
      `update public."MaintenanceRequests"
          set status = 'Closed', closed_at = now(), resolution_notes = 'Replaced the washer.'
        where id = $1`,
      [demo.requests.inProgress.id],
    );
    await signInApp("tenant");
    const viewer = await currentNotificationViewer();
    expect(viewer?.role).toBe("tenant");

    const first = await loadNotifications(viewer!);
    const done = first.items.find((i) => i.sentence === "Your request “Bedroom radiator stays cold” was completed");
    expect(done).toMatchObject({ unread: true, href: `/maintenance/${demo.requests.inProgress.id}` });
    // Never about herself: no "Tina … has an open request".
    expect(first.items.some((i) => /Tina/.test(i.sentence))).toBe(false);

    await markAllNotificationsRead(first, viewer!);
    announceInboxChanged();
    const again = await loadNotifications(viewer!);
    expect(again.items.length).toBeGreaterThan(0);
    expect(again.items.every((i) => !i.unread)).toBe(true);
    // The bell's message rows share the inbox's read state.
    expect(await countInboxUnread(viewer!)).toBe(0);
  });

  test("RLS: bell read marks are private to their owner", async () => {
    const tenant = await clientFor("tenant");
    const own = await tenant.from("NotificationReads").upsert({ item_key: "status:1" }, { onConflict: "user_id,item_key" });
    expect(own.error).toBeNull();

    const landlord = await clientFor("landlord");
    const seen = await landlord.from("NotificationReads").select("item_key");
    expect(seen.error).toBeNull();
    expect((seen.data ?? []).some((r) => r.item_key === "status:1")).toBe(false);

    const [tina] = await sql<{ user_id: string }>(
      `select user_id from public."NotificationReads" where item_key = 'status:1' limit 1`,
    );
    const forged = await landlord.from("NotificationReads").insert({ user_id: tina!.user_id, item_key: "status:2" });
    expect(forged.error).not.toBeNull();
  });
});
