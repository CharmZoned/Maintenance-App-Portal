import { describe, expect, it } from "vitest";
import {
  emptyOfficeThread,
  formatMessageTime,
  officePersonLabel,
  officeSenderLabel,
  officeThreadHref,
  officeThreadId,
  officeUserIdFromThreadId,
  ownOfficeThread,
  sortThreads,
  threadsFromOfficeSummaries,
  threadsFromWorkOrders,
  workOrderThreadTitle,
  type OfficePerson,
  type OfficeThreadSummaryLike,
} from "../../src/client/lib/messages";
import {
  OFFICE_MESSAGE_MAX_LENGTH,
  officeMessageLength,
  officeMessageProblem,
} from "../../src/client/lib/office-messages";
import type { WorkOrder } from "../../src/client/types";

function wo(partial: Partial<WorkOrder> & Pick<WorkOrder, "id" | "title">): WorkOrder {
  return {
    property_id: 1,
    unit_id: 1,
    tenant_id: null,
    vendor_id: null,
    description: null,
    category: "Plumbing",
    priority: "normal",
    status: "open",
    permission_to_enter: false,
    scheduled_at: null,
    completed_at: null,
    worker_price: null,
    landlord_price: null,
    notes: null,
    created_at: "2026-11-14T12:00:00.000Z",
    ...partial,
  };
}

describe("formatMessageTime", () => {
  const now = new Date("2026-11-14T18:00:00.000Z");

  it("labels today", () => {
    expect(formatMessageTime("2026-11-14T14:14:00.000Z", now)).toMatch(/^Today /);
  });

  it("labels yesterday", () => {
    expect(formatMessageTime("2026-11-13T10:00:00.000Z", now)).toBe("Yesterday");
  });
});

describe("threadsFromWorkOrders", () => {
  it("builds request threads newest first with unread stub", () => {
    const threads = threadsFromWorkOrders(
      [
        wo({ id: 1, title: "Older", created_at: "2026-11-10T12:00:00.000Z", status: "closed" }),
        wo({ id: 2, title: "Leaking tap", request_number: "WO-1842", created_at: "2026-11-14T11:00:00.000Z" }),
      ],
      { now: new Date("2026-11-14T18:00:00.000Z") },
    );
    expect(threads[0]?.title).toBe("WO-1842 · Leaking tap");
    expect(threads[0]?.unread).toBe(true);
    expect(threads[1]?.unread).toBe(false);
  });

  it("marks opened threads read", () => {
    const threads = threadsFromWorkOrders(
      [wo({ id: 9, title: "Tap" })],
      { openedIds: new Set(["wo:9"]), now: new Date("2026-11-14T18:00:00.000Z") },
    );
    expect(threads[0]?.unread).toBe(false);
  });
});

describe("workOrderThreadTitle", () => {
  it("falls back to WO-id", () => {
    expect(workOrderThreadTitle(wo({ id: 42, title: "Gate" }))).toBe("WO-42 · Gate");
  });
});

describe("office threads", () => {
  const SAM = "11111111-1111-4111-8111-111111111111";
  const RAJ = "22222222-2222-4222-8222-222222222222";
  const ADMIN = "99999999-9999-4999-8999-999999999999";

  const people = new Map<string, OfficePerson>([
    [SAM, { name: "Sam Fixit", role: "maintenance", email: "sam@example.test" }],
    [RAJ, { name: "Raj Patel", role: "tenant", unit: "1B" }],
  ]);

  const summary = (partial: Partial<OfficeThreadSummaryLike> & { thread_user_id: string }): OfficeThreadSummaryLike => ({
    last_message_at: "2026-11-14T12:00:00.000Z",
    last_message_body: "Hello",
    last_author_role: "maintenance",
    last_author_user_id: partial.thread_user_id,
    unread: false,
    ...partial,
  });

  it("uses office:<userId> as the thread id and deep link", () => {
    expect(officeThreadId(SAM)).toBe(`office:${SAM}`);
    expect(officeThreadHref(SAM)).toBe(`/messages?thread=office:${SAM}`);
    expect(officeUserIdFromThreadId(`office:${SAM}`)).toBe(SAM);
    expect(officeUserIdFromThreadId("wo:12")).toBeNull();
    expect(officeUserIdFromThreadId("office:")).toBeNull();
    expect(officeUserIdFromThreadId(null)).toBeNull();
  });

  it("names the person with their role, and a tenant with their unit", () => {
    expect(officePersonLabel(people.get(SAM))).toBe("Sam Fixit · Team");
    expect(officePersonLabel(people.get(RAJ))).toBe("Raj Patel · Tenant · 1B");
    expect(officePersonLabel({ name: "Lena Owner", role: "landlord", unit: "ignored" })).toBe("Lena Owner · Landlord");
    expect(officePersonLabel({ email: "new@example.test", role: "tenant" })).toBe("new@example.test · Tenant");
    expect(officePersonLabel(undefined)).toBe("Portal user");
  });

  it("builds the admin's rows: person as title, last message as preview, unread from the summary", () => {
    const threads = threadsFromOfficeSummaries(
      [
        summary({ thread_user_id: SAM, last_message_body: "Is there a\n lockbox?", unread: true }),
        summary({ thread_user_id: RAJ, last_author_role: "admin", last_author_user_id: ADMIN, last_message_body: "Done." }),
        summary({ thread_user_id: "unknown", last_author_role: "admin", last_author_user_id: "other-admin" }),
      ],
      { people, viewerUserId: ADMIN },
    );
    expect(threads[0]).toMatchObject({
      id: `office:${SAM}`,
      kind: "office",
      title: "Sam Fixit · Team",
      preview: "Is there a lockbox?",
      unread: true,
      officeUserId: SAM,
    });
    expect(threads[1]).toMatchObject({ title: "Raj Patel · Tenant · 1B", preview: "You: Done.", unread: false });
    expect(threads[2]).toMatchObject({ title: "Portal user", preview: "Office: Hello" });
  });

  it("gives a non-admin one Office thread, even before anyone has written", () => {
    const blank = ownOfficeThread(SAM, null);
    expect(blank).toMatchObject({ id: `office:${SAM}`, kind: "office", title: "Office", unread: false, updatedAt: "" });

    const answered = ownOfficeThread(
      SAM,
      summary({ thread_user_id: SAM, last_author_role: "admin", last_author_user_id: ADMIN, last_message_body: "Yes.", unread: true }),
    );
    expect(answered).toMatchObject({ title: "Office", preview: "Yes.", unread: true });
    expect(ownOfficeThread(SAM, summary({ thread_user_id: SAM, last_message_body: "Hi" })).preview).toBe("You: Hi");
  });

  it("sorts every kind of thread by newest activity, with pinned threads first", () => {
    const requests = threadsFromWorkOrders(
      [
        wo({ id: 1, title: "Old", created_at: "2026-11-10T12:00:00.000Z" }),
        wo({ id: 2, title: "New", created_at: "2026-11-14T15:00:00.000Z" }),
      ],
      { now: new Date("2026-11-14T18:00:00.000Z") },
    );
    const office = threadsFromOfficeSummaries(
      [summary({ thread_user_id: SAM, last_message_at: "2026-11-12T09:00:00.000Z" })],
      { people },
    );
    expect(sortThreads([...requests, ...office]).map((t) => t.id)).toEqual(["wo:2", `office:${SAM}`, "wo:1"]);

    const pinned = emptyOfficeThread(RAJ, people.get(RAJ));
    expect(pinned).toMatchObject({ title: "Raj Patel · Tenant · 1B", preview: "No messages yet.", unread: false });
    expect(sortThreads([...requests, ...office], [pinned]).map((t) => t.id)).toEqual([
      `office:${RAJ}`,
      "wo:2",
      `office:${SAM}`,
      "wo:1",
    ]);
    // A pinned thread is never listed twice.
    expect(sortThreads([pinned, ...requests], [pinned]).filter((t) => t.id === pinned.id)).toHaveLength(1);
  });

  it("labels who wrote a message from each side of the conversation", () => {
    const fromSam = { author_user_id: SAM, author_role: "maintenance" as const };
    const fromAdmin = { author_user_id: ADMIN, author_role: "admin" as const };
    const fromOtherAdmin = { author_user_id: "other-admin", author_role: "admin" as const };

    const asAdmin = { viewerUserId: ADMIN, viewerIsAdmin: true, threadPersonLabel: "Sam Fixit · Team" };
    expect(officeSenderLabel(fromSam, asAdmin)).toEqual({ label: "Sam Fixit · Team", outgoing: false });
    expect(officeSenderLabel(fromAdmin, asAdmin)).toEqual({ label: "You · Office", outgoing: true });
    expect(officeSenderLabel(fromOtherAdmin, asAdmin)).toEqual({ label: "Office", outgoing: true });

    const asSam = { viewerUserId: SAM, viewerIsAdmin: false };
    expect(officeSenderLabel(fromSam, asSam)).toEqual({ label: "You", outgoing: true });
    expect(officeSenderLabel(fromAdmin, asSam)).toEqual({ label: "Office", outgoing: false });
  });

  it("explains why a draft cannot be sent", () => {
    expect(OFFICE_MESSAGE_MAX_LENGTH).toBe(5000);
    expect(officeMessageProblem("  \n ")).toBe("Write a message first.");
    expect(officeMessageProblem("Hello")).toBeNull();
    expect(officeMessageProblem("x".repeat(5000))).toBeNull();
    expect(officeMessageProblem(` ${"x".repeat(5000)} `), "surrounding spaces are not sent").toBeNull();
    expect(officeMessageProblem("x".repeat(5001))).toBe(
      "Messages can be up to 5,000 characters. This one is 5,001.",
    );
    // Counted like Postgres char_length: an emoji is one character.
    expect(officeMessageLength("👍👍")).toBe(2);
    expect(officeMessageProblem("👍".repeat(5000))).toBeNull();
  });
});
