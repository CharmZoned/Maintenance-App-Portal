/**
 * WF4 — Messaging the office
 *
 *   A worker writes to the office  →  the admin sees the thread as unread
 *   (this is the number on the dashboard's "Unread messages" tile)  →  the
 *   admin opens it, which marks it read, and the count drops to zero  →  the
 *   admin replies  →  the worker sees the reply as unread until they open it.
 *
 * Everyone who is not an admin has exactly one thread with the office, and
 * threads never cross: nobody can read, write in, or mark another person's
 * thread.
 *
 * Runs through the app's own data layer (src/client/lib/office-messages.ts and
 * `listOfficeThreads` in data.ts) signed in as each person, exactly as the
 * Messages screen does.
 */
import { beforeAll, describe, expect, test } from "vitest";
import * as data from "@/lib/data";
import * as office from "@/lib/office-messages";
import { officePersonLabel } from "@/lib/messages";
import { clientFor, expectDenied, resetWorld, signInApp, type World } from "../support/harness";

let world: World;

const unreadCount = async () => (await data.listOfficeThreads()).filter((t) => t.unread).length;

beforeAll(async () => {
  world = await resetWorld();
});

describe("[WF4] Messaging the office", () => {
  test("Worker · writes to the office from their own thread", async () => {
    await signInApp("worker");
    const viewer = await office.getOfficeViewer();
    expect(viewer).toEqual({ userId: world.users.worker.id, role: "maintenance" });
    expect(await office.getOwnOfficeThread(viewer.userId), "nothing written yet").toBeNull();

    const sent = await office.sendOfficeMessage(viewer.userId, "  Is there a lockbox at Maple Court 2B?  ");
    expect(sent).toMatchObject({
      thread_user_id: world.users.worker.id,
      author_user_id: world.users.worker.id,
      author_role: "maintenance",
      body: "Is there a lockbox at Maple Court 2B?",
    });

    const own = await office.getOwnOfficeThread(viewer.userId);
    expect(own?.last_message_body).toBe("Is there a lockbox at Maple Court 2B?");
    expect(own?.unread, "your own message is never unread to you").toBe(false);
  });

  test("Admin · sees the thread as unread, named after the worker", async () => {
    await signInApp("admin");
    const threads = await data.listOfficeThreads();
    expect(threads).toHaveLength(1);
    expect(threads[0]).toMatchObject({
      thread_user_id: world.users.worker.id,
      last_message_body: "Is there a lockbox at Maple Court 2B?",
      last_author_role: "maintenance",
      unread: true,
    });
    expect(await unreadCount()).toBe(1);

    const people = await office.listOfficePeople();
    expect(officePersonLabel(people.get(world.users.worker.id))).toBe("Sam Fixit · Team");
    expect(officePersonLabel(people.get(world.users.tenant.id))).toBe("Tina Renter · Tenant · 1A");
    expect(officePersonLabel(people.get(world.users.landlord.id))).toBe("Lena Owner · Landlord");
    expect(people.has(world.users.admin.id), "admins have no thread of their own").toBe(false);
  });

  test("Admin · opening the thread marks it read and the unread count drops to zero", async () => {
    await signInApp("admin");
    const messages = await office.listOfficeMessages(world.users.worker.id);
    expect(messages.map((m) => m.body)).toEqual(["Is there a lockbox at Maple Court 2B?"]);

    await office.markOfficeThreadRead(world.users.worker.id, messages[messages.length - 1].created_at);
    expect(await unreadCount()).toBe(0);

    // Marking again (the screen does this whenever new messages arrive) keeps one row.
    await office.markOfficeThreadRead(world.users.worker.id);
    expect(await unreadCount()).toBe(0);
  });

  test("Admin · replies, and replying does not make the thread unread for the office", async () => {
    await signInApp("admin");
    const reply = await office.sendOfficeMessage(world.users.worker.id, "No lockbox. Tom will let you in.");
    expect(reply).toMatchObject({
      thread_user_id: world.users.worker.id,
      author_user_id: world.users.admin.id,
      author_role: "admin",
    });
    expect(await unreadCount()).toBe(0);
  });

  test("Worker · sees the reply, unread until they open the thread", async () => {
    await signInApp("worker");
    const me = world.users.worker.id;
    const messages = await office.listOfficeMessages(me);
    expect(messages.map((m) => [m.author_role, m.body])).toEqual([
      ["maintenance", "Is there a lockbox at Maple Court 2B?"],
      ["admin", "No lockbox. Tom will let you in."],
    ]);
    expect((await office.getOwnOfficeThread(me))?.unread).toBe(true);

    await office.markOfficeThreadRead(me, messages[messages.length - 1].created_at);
    expect((await office.getOwnOfficeThread(me))?.unread).toBe(false);
  });

  test("Admin · a new message from the worker makes the thread unread again", async () => {
    await signInApp("worker");
    await office.sendOfficeMessage(world.users.worker.id, "Thanks, on my way.");

    await signInApp("admin");
    expect(await unreadCount()).toBe(1);
    await office.markOfficeThreadRead(world.users.worker.id);
    expect(await unreadCount()).toBe(0);
  });

  test("A message must have text and at most 5,000 characters", async () => {
    await signInApp("worker");
    const me = world.users.worker.id;
    await expect(office.sendOfficeMessage(me, "   ")).rejects.toThrow(/Write a message/);
    await expect(office.sendOfficeMessage(me, "x".repeat(5001))).rejects.toThrow(/up to 5,000 characters/);
    const longest = await office.sendOfficeMessage(me, "x".repeat(5000));
    expect(longest.body).toHaveLength(5000);

    // The database enforces the same limit for anyone who skips the app.
    const sam = await clientFor("worker");
    expectDenied(
      await sam
        .from("OfficeMessages")
        .insert({ thread_user_id: me, author_role: "maintenance", body: "x".repeat(5001) })
        .select("id"),
      "5,001 characters is refused by the database",
    );
  });

  test("Nobody can read or write another person's thread", async () => {
    const sam = world.users.worker.id;
    await signInApp("worker");
    const before = (await office.listOfficeMessages(sam)).map((m) => m.id);
    expect(before.length).toBeGreaterThan(0);

    // Another worker, through the app's data layer.
    await signInApp("worker2");
    const riley = await office.getOfficeViewer();
    expect(await office.listOfficeMessages(sam), "Sam's thread is invisible to Riley").toEqual([]);
    expect(await data.listOfficeThreads(), "a non-admin has no inbox of other people's threads").toEqual([]);
    await expect(office.sendOfficeMessage(sam, "Hello from Riley")).rejects.toThrow(/your own conversation/);
    await expect(office.markOfficeThreadRead(sam)).rejects.toThrow();

    // And straight at the database, without the app's own checks.
    const rileyDb = await clientFor("worker2");
    expectDenied(
      await rileyDb
        .from("OfficeMessages")
        .insert({ thread_user_id: sam, author_user_id: riley.userId, author_role: "maintenance", body: "Hello" })
        .select("id"),
      "a worker cannot write into another worker's thread",
    );
    expectDenied(
      await rileyDb
        .from("OfficeMessages")
        .insert({ thread_user_id: riley.userId, author_user_id: riley.userId, author_role: "admin", body: "Hi" })
        .select("id"),
      "a worker cannot pose as the office",
    );
    expectDenied(await rileyDb.from("OfficeMessages").select("id").eq("thread_user_id", sam));

    // A tenant and a landlord are in the same position.
    for (const persona of ["tenant", "landlord"] as const) {
      await signInApp(persona);
      expect(await office.listOfficeMessages(sam), `${persona} cannot read Sam's thread`).toEqual([]);
      await expect(office.sendOfficeMessage(sam, "Hello")).rejects.toThrow();
    }

    // Nothing leaked into Sam's thread, and Riley's own thread still works.
    await signInApp("worker2");
    await office.sendOfficeMessage(riley.userId, "Riley here: can I get the Birch House key?");
    await signInApp("admin");
    const threads = await data.listOfficeThreads();
    expect(threads.map((t) => t.thread_user_id).sort()).toEqual([riley.userId, sam].sort());
    expect(threads.find((t) => t.thread_user_id === riley.userId)?.unread).toBe(true);
    expect(
      (await office.listOfficeMessages(sam)).map((m) => m.id),
      "Sam's thread is exactly as it was",
    ).toEqual(before);
  });

  test("An account that is not approved cannot message the office", async () => {
    await signInApp("pending");
    await expect(office.getOfficeViewer()).rejects.toThrow(/approved accounts/);
    await expect(office.sendOfficeMessage(world.users.pending.id, "Hello")).rejects.toThrow();
  });

  test("Each admin's read state is their own row; a reader cannot move someone else's", async () => {
    const admin = await clientFor("admin");
    const { data: rows } = await admin.from("OfficeThreadReads").select("user_id, thread_user_id");
    expect(rows?.every((r) => r.user_id === world.users.admin.id)).toBe(true);
    expect(rows?.map((r) => r.thread_user_id)).toEqual([world.users.worker.id]);

    const sam = await clientFor("worker");
    expectDenied(
      await sam
        .from("OfficeThreadReads")
        .update({ last_read_at: "2000-01-01T00:00:00Z" })
        .eq("user_id", world.users.admin.id)
        .select(),
      "a worker cannot rewind the admin's read row",
    );
  });
});
