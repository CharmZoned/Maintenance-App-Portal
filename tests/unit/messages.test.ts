import { describe, expect, it } from "vitest";
import type { InboxConversation, InboxLastMessage } from "../../src/client/lib/inbox";
import {
  adminInboxThreads,
  formatMessageTime,
  personLabelForUser,
  mergeMessageThreads,
  officeThreadId,
  officeThreadTitleFromAccount,
  parseOfficeThreadId,
  parseWorkOrderThreadId,
  portalInboxThreads,
  resolvePortalMessagesLink,
  resolveStaffMessagesDeepLink,
  threadsFromOfficeSummaries,
  threadsFromWorkOrders,
  workOrderThreadId,
  workOrderThreadTitle,
} from "../../src/client/lib/messages";
import type { Landlord, Tenant, WorkOrder } from "../../src/client/types";

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

const last = (partial: Partial<InboxLastMessage> & Pick<InboxLastMessage, "at">): InboxLastMessage => ({
  body: "Hello",
  authorRole: "admin",
  authorUserId: "u-admin",
  authorTenantId: null,
  authorStaffId: null,
  ...partial,
});

const requestConversation = (
  requestId: number,
  message: InboxLastMessage,
  unread = false,
): InboxConversation => ({ key: `wo:${requestId}`, kind: "request", requestId, last: message, unread });

describe("threadsFromWorkOrders", () => {
  it("never invents unread or dates: without messages a request is an empty row dated by its report", () => {
    const threads = threadsFromWorkOrders([
      // A visit booked for the future must not date (or sort) the thread.
      wo({ id: 1, title: "Tap", created_at: "2026-11-10T12:00:00.000Z", scheduled_at: "2026-11-26T09:00:00.000Z" }),
      wo({ id: 2, title: "Leaking tap", request_number: "WO-1842", created_at: "2026-11-14T11:00:00.000Z" }),
    ]);
    expect(threads.map((t) => t.id)).toEqual(["wo:2", "wo:1"]);
    expect(threads.every((t) => t.empty && !t.unread)).toBe(true);
    expect(threads[1]?.updatedAt).toBe("2026-11-10T12:00:00.000Z");
    expect(threads[0]?.title).toBe("WO-1842 · Leaking tap");
  });

  it("dates, previews, orders and flags threads by their last visible message", () => {
    const threads = threadsFromWorkOrders(
      [
        wo({ id: 1, title: "Old report, new reply", created_at: "2026-11-01T12:00:00.000Z" }),
        wo({ id: 2, title: "New report, no messages", created_at: "2026-11-14T11:00:00.000Z" }),
      ],
      {
        inbox: [requestConversation(1, last({ at: "2026-11-14T15:00:00.000Z", body: "Booked for Thursday" }), true)],
        viewer: { role: "tenant", userId: "u-tina" },
      },
    );
    expect(threads[0]).toMatchObject({
      id: "wo:1",
      updatedAt: "2026-11-14T15:00:00.000Z",
      preview: "Landlord Gopher: Booked for Thursday",
      unread: true,
    });
    expect(threads[0]?.empty).toBeFalsy();
    // Conversations with messages come before empty rows, whatever the dates.
    expect(threads[1]).toMatchObject({ id: "wo:2", empty: true, unread: false });
  });
});

describe("portalInboxThreads — tenant, landlord and technician inbox", () => {
  const tina = { role: "tenant" as const, userId: "u-tina" };

  it("always lists the user's own office thread, with no date when it is empty", () => {
    const threads = portalInboxThreads({ viewer: tina, workOrders: [], inbox: [] });
    expect(threads).toHaveLength(1);
    expect(threads[0]).toMatchObject({ id: "office:u-tina", kind: "direct", empty: true, unread: false, updatedAt: "" });
    expect(formatMessageTime(threads[0]!.updatedAt)).toBe("");
  });

  it("names who wrote last from the reader's side, and says You for their own words", () => {
    const threads = portalInboxThreads({
      viewer: tina,
      workOrders: [wo({ id: 5, title: "Radiator", tenant_id: 7, tenant_first_name: "Tina" })],
      inbox: [
        {
          key: "office:u-tina",
          kind: "office",
          threadUserId: "u-tina",
          last: last({ at: "2026-11-14T10:00:00.000Z", body: "Thanks!", authorRole: "tenant", authorUserId: "u-tina" }),
          unread: false,
        },
        requestConversation(
          5,
          last({ at: "2026-11-14T12:00:00.000Z", body: "On my way", authorRole: "maintenance", authorUserId: "u-sam" }),
          true,
        ),
      ],
    });
    expect(threads.map((t) => [t.id, t.preview, t.unread])).toEqual([
      ["wo:5", "Technician: On my way", true],
      ["office:u-tina", "You: Thanks!", false],
    ]);
  });

  it("leaves closed requests nobody wrote on out, but keeps open ones to start a conversation", () => {
    const threads = portalInboxThreads({
      viewer: tina,
      workOrders: [wo({ id: 1, title: "Done, silent", status: "closed" }), wo({ id: 2, title: "Open, silent" })],
      inbox: [],
    });
    expect(threads.map((t) => t.id)).toEqual(["office:u-tina", "wo:2"]);
  });

  it("lists a request conversation past the loaded list so every unread one can be opened", () => {
    const threads = portalInboxThreads({
      viewer: { role: "maintenance", userId: "u-sam" },
      workOrders: [],
      inbox: [requestConversation(40, last({ at: "2026-11-14T12:00:00.000Z" }), true)],
    });
    expect(threads.find((t) => t.id === "wo:40")).toMatchObject({ unread: true, title: "Request 40" });
  });

  it("gives landlords their office thread only", () => {
    const threads = portalInboxThreads({
      viewer: { role: "landlord", userId: "u-lena" },
      workOrders: [wo({ id: 2, title: "Boiler" })],
      inbox: [requestConversation(2, last({ at: "2026-11-14T12:00:00.000Z" }), true)],
    });
    expect(threads.map((t) => t.id)).toEqual(["office:u-lena"]);
  });
});

describe("resolvePortalMessagesLink", () => {
  const tina = { role: "tenant" as const, userId: "u-tina" };
  const threads = portalInboxThreads({ viewer: tina, workOrders: [wo({ id: 7, title: "Heater" })], inbox: [] });

  it("opens the user's own threads", () => {
    expect(resolvePortalMessagesLink("?thread=wo:7", threads, tina)).toEqual({ kind: "open", threadId: "wo:7", draft: null });
    expect(resolvePortalMessagesLink("?request=7", threads, tina)).toEqual({ kind: "open", threadId: "wo:7", draft: null });
  });

  it("says a request or office thread that is not theirs is unavailable — never a stand-in thread", () => {
    expect(resolvePortalMessagesLink("?thread=wo:2", threads, tina)).toEqual({ kind: "unavailable" });
    expect(resolvePortalMessagesLink("?request=2", threads, tina)).toEqual({ kind: "unavailable" });
    expect(resolvePortalMessagesLink("?thread=office:someone-else", threads, tina)).toEqual({ kind: "unavailable" });
    expect(resolvePortalMessagesLink("?thread=nonsense", threads, tina)).toEqual({ kind: "unavailable" });
  });

  it("applies the office-message helper's draft to the user's own thread", () => {
    expect(resolvePortalMessagesLink("?office=me&about=Maple%20Court", threads, tina)).toEqual({
      kind: "open",
      threadId: "office:u-tina",
      draft: "About: Maple Court\n\n",
    });
  });

  it("sends landlords' request links to the request page", () => {
    const lena = { role: "landlord" as const, userId: "u-lena" };
    const own = portalInboxThreads({ viewer: lena, workOrders: [], inbox: [] });
    expect(resolvePortalMessagesLink("?thread=wo:9", own, lena)).toEqual({ kind: "redirect", to: "/maintenance/9" });
    expect(resolvePortalMessagesLink("?request=9", own, lena)).toEqual({ kind: "redirect", to: "/maintenance/9" });
    expect(resolvePortalMessagesLink("?thread=office:u-lena", own, lena)).toMatchObject({ kind: "open" });
  });
});

describe("workOrderThreadTitle", () => {
  it("falls back to WO-id", () => {
    expect(workOrderThreadTitle(wo({ id: 42, title: "Gate" }))).toBe("WO-42 · Gate");
  });
});

describe("adminInboxThreads — who the office is talking to", () => {
  const account = (user_id: string, role: "maintenance" | "landlord" | "tenant", ids: { landlord_id?: number; tenant_id?: number; staff_id?: number }) => ({
    user_id,
    email: `${user_id}@example.com`,
    role,
    landlord_id: ids.landlord_id ?? null,
    tenant_id: ids.tenant_id ?? null,
    staff_id: ids.staff_id ?? null,
    account_status: "approved" as const,
    created_at: "2026-01-01T00:00:00.000Z",
  });
  const people = {
    accounts: [
      account("u-sam", "maintenance", { staff_id: 3 }),
      account("u-lena", "landlord", { landlord_id: 1 }),
      account("u-tina", "tenant", { tenant_id: 7 }),
    ],
    staff: [{ id: 3, first_name: "Sam", last_name: "Fixit", email: "sam@example.com", job_title: null, gets_request_alerts: true }],
    tenants: [{ id: 7, first_name: "Tina", last_name: "Renter", active_unit_name: "1A" } as Tenant],
    landlords: [{ id: 1, first_name: "Lena", last_name: "Owner", company_name: null } as Landlord],
  };
  const last = (
    at: string,
    body: string,
    authorRole: InboxLastMessage["authorRole"],
    extra: Partial<InboxLastMessage> = {},
  ): InboxLastMessage => ({ at, body, authorRole, authorUserId: null, authorTenantId: null, authorStaffId: null, ...extra });

  it("leads each row with the person (and unit), with the request reference second", () => {
    const threads = adminInboxThreads({
      workOrders: [
        wo({ id: 5, title: "Kitchen faucet dripping", request_number: "MR-001005", tenant_id: 7, tenant_first_name: "Tina", tenant_last_name: "Renter", unit_name: "1A", created_at: "2026-11-10T12:00:00.000Z" }),
        wo({ id: 6, title: "Annual furnace service", request_number: "MR-001002", property_name: "Birch House", unit_name: "Main", created_at: "2026-11-09T12:00:00.000Z" }),
        wo({ id: 8, title: "Radiator", request_number: "MR-001004", assigned_staff_id: 3, created_at: "2026-11-08T12:00:00.000Z" }),
      ],
      inbox: [
        { key: "office:u-sam", kind: "office", threadUserId: "u-sam", last: last("2026-11-14T09:00:00.000Z", "Lockbox?", "maintenance"), unread: true },
        { key: "office:u-lena", kind: "office", threadUserId: "u-lena", last: last("2026-11-13T09:00:00.000Z", "It was $120.", "admin"), unread: false },
        { key: "wo:5", kind: "request", requestId: 5, last: last("2026-11-14T10:00:00.000Z", "Getting worse.", "tenant", { authorTenantId: 7 }), unread: true },
      ],
      people,
    });
    expect(threads.map((t) => [t.id, t.counterpart, t.title, t.preview, t.unread])).toEqual([
      ["wo:5", "Tina Renter · Unit 1A", "MR-001005 · Kitchen faucet dripping", "Tina: Getting worse.", true],
      ["office:u-sam", "Sam Fixit · Team", "Direct message", "Lockbox?", true],
      ["office:u-lena", "Lena Owner · Landlord", "Direct message", "Office: It was $120.", false],
      // No messages yet: listed so the office can start, never unread, dated by when it was reported.
      ["wo:6", "Office request · Birch House · Unit Main", "MR-001002 · Annual furnace service", "Annual furnace service", false],
      ["wo:8", "Sam Fixit · Team", "MR-001004 · Radiator", "Radiator", false],
    ]);
    expect(threads.find((t) => t.id === "office:u-sam")).toMatchObject({ kind: "direct", threadUserId: "u-sam" });
    expect(threads.find((t) => t.id === "wo:6")?.updatedAt).toBe("2026-11-09T12:00:00.000Z");
  });

  it("lists a request conversation whose request is not in the loaded list, so every unread one can be opened", () => {
    const threads = adminInboxThreads({
      workOrders: [],
      inbox: [{ key: "wo:42", kind: "request", requestId: 42, last: last("2026-11-14T10:00:00.000Z", "Still dripping.", "tenant"), unread: true }],
      people,
    });
    expect(threads).toEqual([
      expect.objectContaining({ id: "wo:42", kind: "request", requestId: 42, title: "Request 42", preview: "Still dripping.", unread: true }),
    ]);
  });

  it("names a tenant's office thread by their unit", () => {
    expect(personLabelForUser("u-tina", people)).toBe("Tina Renter · Unit 1A");
    expect(personLabelForUser("u-unknown", people)).toBeNull();
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
