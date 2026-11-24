import { describe, expect, it } from "vitest";
import type { InboxLastMessage } from "../../src/client/lib/inbox";
import {
  adminInboxThreads,
  formatMessageTime,
  personLabelForUser,
  threadsFromWorkOrders,
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

  it("names a tenant's office thread by their unit", () => {
    expect(personLabelForUser("u-tina", people)).toBe("Tina Renter · Unit 1A");
    expect(personLabelForUser("u-unknown", people)).toBeNull();
  });
});
