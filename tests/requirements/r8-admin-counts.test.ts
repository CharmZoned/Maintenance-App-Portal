/**
 * R8 — Admin counts that agree.
 * The Maintenance rail badge, the Messages rail badge, the dashboard KPIs and
 * the Messages page all read the same numbers from the same rules, against the
 * demo world `pnpm dev:local` shows (tests/emulator/seed.ts with `demo: true`).
 *
 * Every other test file runs on the standard world, so this file puts it back
 * when it is done.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { countRequestsNeedingAction } from "@/components/chrome/use-admin-nav-counts";
import { staffQueueTab } from "@/components/maintenance/request-status";
import * as data from "@/lib/data";
import {
  announceInboxChanged,
  countAdminUnread,
  countUnreadConversations,
  loadAdminInbox,
  markOfficeThreadRead,
  markRequestThreadRead,
  sendOfficeMessage,
} from "@/lib/inbox";
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

beforeAll(async () => {
  world = await resetDemoWorld();
  if (!world.demo) throw new Error("the emulator did not load the demo extras");
  demo = world.demo;
});

afterAll(async () => {
  await resetWorld();
});

describe("[R8] Admin counts", () => {
  describe("emulator: PostgREST counts", () => {
    test("count=exact reports the filtered total in Content-Range, on GET and on HEAD", async () => {
      const admin = await clientFor("admin");
      const total = (await sql<{ n: number }>(`select count(*)::int as n from public."MaintenanceRequests"`))[0].n;
      expect(total).toBeGreaterThan(2);

      const page = await admin.from("MaintenanceRequests").select("id", { count: "exact" }).limit(2);
      expect(page.error).toBeNull();
      expect(page.data).toHaveLength(2);
      expect(page.count).toBe(total);

      const head = await admin
        .from("MaintenanceRequests")
        .select("id", { count: "exact", head: true })
        .in("status", ["Open", "Scheduled", "In Progress", "On Hold"]);
      expect(head.error).toBeNull();
      expect(head.data).toBeNull();
      const open = (await sql<{ n: number }>(`select count(*)::int as n from public."MaintenanceRequests" where status <> 'Closed'`))[0].n;
      expect(head.count).toBe(open);
    });

    test("an empty match counts zero", async () => {
      const admin = await clientFor("admin");
      const none = await admin.from("MaintenanceRequests").select("id", { count: "exact", head: true }).eq("id", -1);
      expect(none.error).toBeNull();
      expect(none.count).toBe(0);
    });
  });

  describe("Maintenance badge", () => {
    test("counts exactly the Maintenance page's Needs action requests", async () => {
      await signInApp("admin");
      const orders = await data.listWorkOrders();
      const needs = orders.filter((o) => staffQueueTab(o.status, Boolean(o.assigned_staff_id)) === "needs").length;
      expect(needs).toBeGreaterThan(0);
      expect(await countRequestsNeedingAction()).toBe(needs);
    });
  });

  describe("Messages: one unread definition", () => {
    test("the demo inbox: answered office threads are read, unanswered request threads are unread", async () => {
      await signInApp("admin");
      const inbox = await loadAdminInbox();
      const unread = inbox.filter((c) => c.unread).map((c) => c.key).sort();
      expect(unread).toEqual(
        [demo.requests.closed.id, demo.requests.scheduled.id, demo.requests.inProgress.id, demo.requests.pooled.id]
          .map((id) => `wo:${id}`)
          .sort(),
      );
      // Sam's and Lena's office threads end with an admin reply.
      expect(inbox.filter((c) => c.kind === "office").every((c) => !c.unread)).toBe(true);
      expect(await countAdminUnread()).toBe(countUnreadConversations(inbox));
    });

    test("callers asking at the same moment share one inbox load; a change starts a fresh one", async () => {
      await signInApp("admin");
      const a = loadAdminInbox();
      const b = loadAdminInbox();
      expect(b).toBe(a);
      announceInboxChanged();
      const c = loadAdminInbox();
      expect(c).not.toBe(a);
      expect(await c).toEqual(await a);
      // Settled loads are not reused.
      const d = loadAdminInbox();
      expect(d).not.toBe(c);
      await d;
    });

    test("opening a request thread marks it read for this admin only", async () => {
      await signInApp("admin");
      const before = await loadAdminInbox();
      const pooled = before.find((c) => c.key === `wo:${demo.requests.pooled.id}`)!;
      expect(pooled.unread).toBe(true);
      await markRequestThreadRead(demo.requests.pooled.id, pooled.last.at);
      const after = await loadAdminInbox();
      expect(after.find((c) => c.key === pooled.key)!.unread).toBe(false);
      expect(countUnreadConversations(after)).toBe(countUnreadConversations(before) - 1);

      // Marking again (an upsert) is harmless.
      await markRequestThreadRead(demo.requests.pooled.id, pooled.last.at);
      expect(countUnreadConversations(await loadAdminInbox())).toBe(countUnreadConversations(after));
    });

    test("a new message from the other side makes a thread unread again; an office reply answers it", async () => {
      const tenant = await clientFor("tenant");
      const tenantUserId = (await tenant.auth.getUser()).data.user!.id;
      // The reads above were recorded with server timestamps; keep this one clearly later.
      const posted = await tenant.from("MaintenanceRequestComments").insert({
        author_user_id: tenantUserId,
        maintenance_request_id: demo.requests.pooled.id,
        body: "Still dripping.",
        visibility: "tenant_visible",
        author_role: "tenant",
        author_tenant_id: world.tenants.tenant.id,
      });
      expect(posted.error).toBeNull();

      await signInApp("admin");
      const key = `wo:${demo.requests.pooled.id}`;
      expect((await loadAdminInbox()).find((c) => c.key === key)!.unread).toBe(true);

      await data.addMaintenanceComment(demo.requests.pooled.id, "We'll send someone today.", "tenant_visible");
      expect((await loadAdminInbox()).find((c) => c.key === key)!.unread).toBe(false);
    });

    test("office threads: a user's new message is unread until opened or answered", async () => {
      const worker = await clientFor("worker");
      const workerId = (await worker.auth.getUser()).data.user!.id;
      const sent = await worker
        .from("OfficeMessages")
        .insert({ thread_user_id: workerId, author_user_id: workerId, author_role: "maintenance", body: "Gate code?" })
        .select("created_at")
        .single();
      expect(sent.error).toBeNull();

      await signInApp("admin");
      const key = `office:${workerId}`;
      const conversation = (await loadAdminInbox()).find((c) => c.key === key)!;
      expect(conversation.unread).toBe(true);
      await markOfficeThreadRead(workerId, conversation.last.at);
      expect((await loadAdminInbox()).find((c) => c.key === key)!.unread).toBe(false);

      const again = await worker
        .from("OfficeMessages")
        .insert({ thread_user_id: workerId, author_user_id: workerId, author_role: "maintenance", body: "Never mind, found it." })
        .select("created_at")
        .single();
      expect(again.error).toBeNull();
      // The read row is earlier than the new message.
      await sql(`update public."OfficeMessages" set created_at = now() + interval '1 minute' where body = 'Never mind, found it.'`);
      expect((await loadAdminInbox()).find((c) => c.key === key)!.unread).toBe(true);

      const reply = await sendOfficeMessage(workerId, "Glad you found it.");
      expect(reply.author_role).toBe("admin");
      await sql(`update public."OfficeMessages" set created_at = now() + interval '2 minutes' where id = $1`, [reply.id]);
      expect((await loadAdminInbox()).find((c) => c.key === key)!.unread).toBe(false);
    });
  });
});
