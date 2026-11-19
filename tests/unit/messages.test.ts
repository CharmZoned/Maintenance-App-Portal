import { describe, expect, it } from "vitest";
import {
  formatMessageTime,
  threadsFromWorkOrders,
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
