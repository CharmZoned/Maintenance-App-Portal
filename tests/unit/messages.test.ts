import { describe, expect, it } from "vitest";
import {
  formatMessageTime,
  mergeMessageThreads,
  officeThreadId,
  officeThreadTitleFromAccount,
  parseOfficeThreadId,
  parseWorkOrderThreadId,
  resolveStaffMessagesDeepLink,
  threadsFromOfficeSummaries,
  threadsFromWorkOrders,
  workOrderThreadId,
  workOrderThreadTitle,
} from "../../src/client/lib/messages";
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

describe("office thread helpers", () => {
  it("round-trips office and work-order thread ids", () => {
    expect(officeThreadId("u-sam")).toBe("office:u-sam");
    expect(parseOfficeThreadId("office:u-sam")).toBe("u-sam");
    expect(parseOfficeThreadId("wo:1")).toBeNull();
    expect(workOrderThreadId(42)).toBe("wo:42");
    expect(parseWorkOrderThreadId("wo:42")).toBe(42);
  });

  it("builds direct threads and can ensure an empty own thread", () => {
    const threads = threadsFromOfficeSummaries(
      [
        {
          thread_user_id: "u-sam",
          last_message_at: "2026-11-14T12:00:00.000Z",
          last_message_body: "Need the lockbox code",
          last_author_role: "maintenance",
          last_author_user_id: "u-sam",
          unread: true,
        },
      ],
      {
        titles: new Map([["u-sam", "Sam · Maintenance"]]),
        ensureOwnThread: { userId: "u-tenant", title: "Landlord Gopher office" },
      },
    );
    expect(threads[0]?.id).toBe("office:u-sam");
    expect(threads[0]?.title).toBe("Sam · Maintenance");
    expect(threads.some((t) => t.id === "office:u-tenant")).toBe(true);
  });

  it("merges request and direct threads by recency", () => {
    const merged = mergeMessageThreads(
      threadsFromWorkOrders([wo({ id: 1, title: "Tap", created_at: "2026-11-14T10:00:00.000Z" })]),
      threadsFromOfficeSummaries([
        {
          thread_user_id: "u-1",
          last_message_at: "2026-11-14T11:00:00.000Z",
          last_message_body: "Hi",
          last_author_role: "tenant",
          last_author_user_id: "u-1",
          unread: false,
        },
      ]),
    );
    expect(merged[0]?.kind).toBe("direct");
    expect(merged[1]?.kind).toBe("request");
  });

  it("formats account titles for admin inbox", () => {
    expect(
      officeThreadTitleFromAccount({ email: "sam.fixit@example.com", role: "maintenance" }),
    ).toBe("Sam Fixit · Maintenance");
  });
});

describe("resolveStaffMessagesDeepLink", () => {
  const threads = [
    ...threadsFromWorkOrders([wo({ id: 7, title: "Heater" })]),
    ...threadsFromOfficeSummaries([
      {
        thread_user_id: "u-lena",
        last_message_at: "2026-11-14T12:00:00.000Z",
        last_message_body: "Boiler?",
        last_author_role: "landlord",
        last_author_user_id: "u-lena",
        unread: false,
      },
    ]),
  ];

  it("resolves thread and request params", () => {
    expect(resolveStaffMessagesDeepLink("?thread=wo:7", threads)).toEqual({
      kind: "thread",
      threadId: "wo:7",
    });
    expect(resolveStaffMessagesDeepLink("?thread=office:u-lena", threads)).toEqual({
      kind: "thread",
      threadId: "office:u-lena",
    });
    expect(resolveStaffMessagesDeepLink("?request=7", threads)).toEqual({
      kind: "request",
      requestId: 7,
      threadId: "wo:7",
      known: true,
    });
    expect(resolveStaffMessagesDeepLink("?request=99", threads)).toEqual({
      kind: "request",
      requestId: 99,
      threadId: "wo:99",
      known: false,
    });
  });

  it("allows unknown office thread ids only for admins or the thread owner", () => {
    expect(
      resolveStaffMessagesDeepLink("?thread=office:brand-new", threads, { isAdmin: true }),
    ).toEqual({
      kind: "thread",
      threadId: "office:brand-new",
    });
    expect(
      resolveStaffMessagesDeepLink("?thread=office:brand-new", threads, {
        currentUserId: "brand-new",
      }),
    ).toEqual({
      kind: "thread",
      threadId: "office:brand-new",
    });
    expect(
      resolveStaffMessagesDeepLink("?thread=office:brand-new", threads, {
        currentUserId: "someone-else",
      }),
    ).toEqual({
      kind: "not-found",
      raw: "office:brand-new",
    });
  });
});

describe("officeMessageSenderLabel", () => {
  it("marks outgoing by author_user_id, not shared admin role", async () => {
    const { officeMessageSenderLabel } = await import("../../src/client/lib/messages");
    const mine = officeMessageSenderLabel(
      {
        id: 1,
        created_at: "2026-11-14T12:00:00.000Z",
        thread_user_id: "u-sam",
        author_user_id: "admin-a",
        author_role: "admin",
        body: "Hi",
      },
      { currentUserId: "admin-a", currentRole: "admin" },
    );
    const otherAdmin = officeMessageSenderLabel(
      {
        id: 2,
        created_at: "2026-11-14T12:01:00.000Z",
        thread_user_id: "u-sam",
        author_user_id: "admin-b",
        author_role: "admin",
        body: "Also hi",
      },
      { currentUserId: "admin-a", currentRole: "admin" },
    );
    expect(mine.outgoing).toBe(true);
    expect(otherAdmin.outgoing).toBe(false);
    expect(otherAdmin.label).toBe("Landlord Gopher office");
  });
});
