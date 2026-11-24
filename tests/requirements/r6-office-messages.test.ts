/**
 * R6 — Messaging: the landlord (and worker) ↔ Landlord Gopher office chat.
 *
 * Exercises src/client/lib/office-messages.ts exactly as the Messages page and
 * the landlord Home card call it, against the emulator's real RLS on
 * OfficeMessages / OfficeThreadReads (docs/landlord-wave-plan.md, LG-B).
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  countUnreadOfficeMessages,
  getOfficeThreadReadAt,
  listOfficeContacts,
  listOfficeMessages,
  listOfficeThreads,
  markOfficeThreadRead,
  officeThreadKey,
  parseOfficeThreadKey,
  sendOfficeMessage,
  subscribeOfficeThread,
  type OfficeMessage,
} from "@/lib/office-messages";
import { resetWorld, signInApp, signOutApp, sql, type World } from "../support/harness";

let world: World;

/** request_id arrives with LG-A2's migration; the link check runs once it exists. */
const hasRequestLink =
  (
    await sql<{ n: number }>(
      `select count(*)::int as n from information_schema.columns
        where table_schema = 'public' and table_name = 'OfficeMessages' and column_name = 'request_id'`,
    )
  )[0]?.n === 1;

beforeAll(async () => {
  world = await resetWorld();
});

afterAll(async () => {
  await signOutApp();
});

describe("[R6] Office chat · landlord ↔ Landlord Gopher office", () => {
  test("Landlord · starts with an empty thread and nothing unread", async () => {
    await signInApp("landlord");
    expect(await listOfficeMessages(world.users.landlord.id)).toEqual([]);
    expect(await getOfficeThreadReadAt(world.users.landlord.id)).toBeNull();
  });

  test("Landlord · writes to the office", async () => {
    await signInApp("landlord");
    const sent = await sendOfficeMessage({
      threadUserId: world.users.landlord.id,
      body: "  When is the boiler service at Maple Court?  ",
    });
    expect(sent).toMatchObject({
      thread_user_id: world.users.landlord.id,
      author_user_id: world.users.landlord.id,
      author_role: "landlord",
      body: "When is the boiler service at Maple Court?",
      request_id: null,
    });
    const thread = await listOfficeMessages(world.users.landlord.id);
    expect(thread.map((m) => m.body)).toEqual(["When is the boiler service at Maple Court?"]);
  });

  test("Admin · sees the landlord's thread as unread, by name, under Landlords", async () => {
    await signInApp("admin");
    const threads = await listOfficeThreads();
    expect(threads).toEqual([
      expect.objectContaining({
        thread_user_id: world.users.landlord.id,
        last_author_role: "landlord",
        last_message_body: "When is the boiler service at Maple Court?",
        unread: true,
      }),
    ]);

    const contacts = await listOfficeContacts();
    const lena = contacts.find((c) => c.userId === world.users.landlord.id);
    expect(lena).toMatchObject({ role: "landlord" });
    expect(lena?.name).toBeTruthy();
    expect(contacts.find((c) => c.userId === world.users.worker.id)).toMatchObject({ role: "maintenance" });
    expect(contacts.some((c) => c.userId === world.users.admin.id), "admins have no thread").toBe(false);
    expect(contacts.some((c) => c.userId === world.users.pending.id), "pending accounts can't be messaged").toBe(false);
  });

  test("Admin · replies, and opening the thread clears the unread dot", async () => {
    await signInApp("admin");
    const reply = await sendOfficeMessage({
      threadUserId: world.users.landlord.id,
      body: "Thursday morning. Sam will let you know when he's on his way.",
    });
    expect(reply).toMatchObject({ author_role: "admin", author_user_id: world.users.admin.id });

    await markOfficeThreadRead(world.users.landlord.id);
    const [thread] = await listOfficeThreads();
    expect(thread).toMatchObject({ last_author_role: "admin", unread: false });
  });

  test("Landlord · sees one unread reply until they open the thread", async () => {
    await signInApp("landlord");
    const messages = await listOfficeMessages(world.users.landlord.id);
    expect(messages.map((m) => m.author_role)).toEqual(["landlord", "admin"]);

    const viewer = { userId: world.users.landlord.id, isAdmin: false };
    expect(countUnreadOfficeMessages(messages, viewer, await getOfficeThreadReadAt(world.users.landlord.id))).toBe(1);

    await markOfficeThreadRead(world.users.landlord.id);
    const readAt = await getOfficeThreadReadAt(world.users.landlord.id);
    expect(readAt).not.toBeNull();
    expect(countUnreadOfficeMessages(messages, viewer, readAt)).toBe(0);

    // Marking read again just moves the marker; it never duplicates.
    await markOfficeThreadRead(world.users.landlord.id);
    const rows = await sql(`select 1 from public."OfficeThreadReads" where user_id = $1`, [world.users.landlord.id]);
    expect(rows).toHaveLength(1);
  });

  test("Landlord · cannot write into or read anyone else's thread", async () => {
    await signInApp("landlord");
    await expect(
      sendOfficeMessage({ threadUserId: world.users.worker.id, body: "Hello worker" }),
    ).rejects.toThrow();
    expect(await listOfficeMessages(world.users.worker.id)).toEqual([]);
  });

  test("Worker · has their own thread, separate from the landlord's", async () => {
    await signInApp("worker");
    expect(await listOfficeMessages(world.users.landlord.id), "threads never cross").toEqual([]);
    await sendOfficeMessage({ threadUserId: world.users.worker.id, body: "Is there a lockbox at Birch House?" });
    expect((await listOfficeMessages(world.users.worker.id)).map((m) => m.author_role)).toEqual(["maintenance"]);

    await signInApp("admin");
    const threads = await listOfficeThreads();
    expect(threads.map((t) => t.thread_user_id).sort()).toEqual(
      [world.users.landlord.id, world.users.worker.id].sort(),
    );
    expect(threads.find((t) => t.thread_user_id === world.users.worker.id)?.unread).toBe(true);
  });

  test("an empty or too-long message is refused before it is sent", async () => {
    await signInApp("landlord");
    await expect(sendOfficeMessage({ threadUserId: world.users.landlord.id, body: "   " })).rejects.toThrow(
      /Write a message/,
    );
    await expect(
      sendOfficeMessage({ threadUserId: world.users.landlord.id, body: "x".repeat(5001) }),
    ).rejects.toThrow(/5000/);
  });

  /** A request on the landlord's own property (Maple Court, unit A). */
  const landlordRequest = async () =>
    (
      await sql<{ id: number; request_number: string }>(
        `insert into public."MaintenanceRequests"
           (title, description, category, unit_id, property_id, submitted_by_tenant_id, status)
         values ('Hallway light', 'Flickers at night', 'Other', $1, $2, $3, 'Open')
         returning id::int as id, request_number`,
        [world.units.a.id, world.property.id, world.tenants.tenant.id],
      )
    )[0];

  test.runIf(hasRequestLink)("Landlord · links a message to one of their requests (Regarding #MR-…)", async () => {
    const request = await landlordRequest();
    await signInApp("landlord");
    const sent = await sendOfficeMessage({
      threadUserId: world.users.landlord.id,
      body: "Any news on this one?",
      requestId: request.id,
    });
    expect(sent.request_id).toBe(request.id);
    const thread = await listOfficeMessages(world.users.landlord.id);
    expect(thread.at(-1)?.request_id).toBe(request.id);
  });

  test.skipIf(hasRequestLink)("Landlord · without the request link column, the request is named in the text", async () => {
    const request = await landlordRequest();
    await signInApp("landlord");
    const sent = await sendOfficeMessage({
      threadUserId: world.users.landlord.id,
      body: "Any news on this one?",
      requestId: request.id,
    });
    expect(sent.request_id).toBeNull();
    expect(sent.body).toBe(`Regarding #${request.request_number}: Any news on this one?`);
  });

  test("Landlord · sees the office's reply arrive live", async () => {
    await signInApp("landlord");
    const received: OfficeMessage[] = [];
    // Realtime is not emulated, so this also proves the polling fallback.
    const stop = subscribeOfficeThread(world.users.landlord.id, (m) => received.push(m), { pollMs: 150 });
    try {
      await new Promise((r) => setTimeout(r, 300));
      await sql(
        `insert into public."OfficeMessages" (thread_user_id, author_user_id, author_role, body)
         values ($1, $2, 'admin', 'Sam is on his way.')`,
        [world.users.landlord.id, world.users.admin.id],
      );
      const deadline = Date.now() + 8000;
      while (received.length === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
    } finally {
      stop();
    }
    expect(received.map((m) => m.body)).toEqual(["Sam is on his way."]);
  });
});

describe("[R6] Office chat · unread count", () => {
  const msg = (id: number, author_role: OfficeMessage["author_role"], minute: number): OfficeMessage => ({
    id,
    created_at: new Date(Date.UTC(2026, 10, 24, 9, minute)).toISOString(),
    thread_user_id: "lena",
    author_user_id: author_role === "admin" ? "ada" : "lena",
    author_role,
    body: `m${id}`,
    request_id: null,
  });

  test("only the other side's messages after your last read or reply count", () => {
    const thread = [msg(1, "landlord", 0), msg(2, "admin", 5), msg(3, "admin", 6)];
    const lena = { userId: "lena", isAdmin: false };
    const ada = { userId: "ada", isAdmin: true };
    expect(countUnreadOfficeMessages(thread, lena, null)).toBe(2);
    expect(countUnreadOfficeMessages(thread, lena, thread[1].created_at)).toBe(1);
    expect(countUnreadOfficeMessages(thread, ada, null), "the office replied, so nothing is waiting").toBe(0);
    expect(countUnreadOfficeMessages([...thread, msg(4, "landlord", 9)], lena, null), "Lena replied").toBe(0);
  });
});

describe("[R6] Office chat · /messages?thread= links", () => {
  test("office is your own thread; office:<user_id> is one person's thread", () => {
    expect(officeThreadKey()).toBe("office");
    expect(officeThreadKey("abc-123")).toBe("office:abc-123");
    expect(parseOfficeThreadKey("office")).toEqual({ own: true });
    expect(parseOfficeThreadKey("office:abc-123")).toEqual({ own: false, userId: "abc-123" });
    expect(parseOfficeThreadKey("office:")).toBeNull();
    expect(parseOfficeThreadKey("wo:12")).toBeNull();
    expect(parseOfficeThreadKey(null)).toBeNull();
  });
});
