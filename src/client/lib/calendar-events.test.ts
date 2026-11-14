import { describe, expect, it } from "vitest";
import {
  buildCalendarEvents,
  buildMonthGrid,
  groupEventsByDay,
  toCalendarDay,
} from "./calendar-events";
import { toIsoDate } from "./utils";
import type { Application, Lease, RentCharge, WorkOrder } from "@/types";

function wo(partial: Partial<WorkOrder> & Pick<WorkOrder, "id" | "title">): WorkOrder {
  return {
    property_id: 1,
    unit_id: 1,
    tenant_id: null,
    vendor_id: null,
    description: null,
    category: "Plumbing",
    priority: "normal",
    status: "scheduled",
    permission_to_enter: false,
    scheduled_at: null,
    completed_at: null,
    cost: null,
    notes: null,
    created_at: "2026-01-01T00:00:00Z",
    ...partial,
  };
}

function lease(partial: Partial<Lease> & Pick<Lease, "id" | "start_date" | "end_date">): Lease {
  return {
    unit_id: 1,
    primary_tenant_id: 9,
    monthly_rent: 1000,
    deposit: 0,
    rent_due_day: 1,
    late_fee: 0,
    status: "active",
    notes: null,
    created_at: "2026-01-01T00:00:00Z",
    tenant_first_name: "Ada",
    tenant_last_name: "Lovelace",
    property_name: "Oak",
    unit_name: "1A",
    ...partial,
  };
}

describe("toCalendarDay", () => {
  it("maps timestamptz to the local calendar day", () => {
    const iso = "2026-11-15T12:00:00.000Z";
    expect(toCalendarDay(iso)).toBe(toIsoDate(new Date(iso)));
  });
  it("passes through date-only strings", () => {
    expect(toCalendarDay("2026-11-01")).toBe("2026-11-01");
  });
  it("returns null for empty", () => {
    expect(toCalendarDay(null)).toBeNull();
    expect(toCalendarDay(undefined)).toBeNull();
  });
});

describe("buildCalendarEvents", () => {
  it("aggregates WO, lease, rent, and optional application dates", () => {
    const events = buildCalendarEvents({
      workOrders: [
        wo({
          id: 1,
          title: "Leak",
          scheduled_at: "2026-11-10T12:00:00.000Z",
          next_follow_up_date: "2026-11-20",
          property_name: "Oak",
          unit_name: "1A",
        }),
      ],
      leases: [lease({ id: 2, start_date: "2026-11-01", end_date: "2027-10-31" })],
      charges: [
        {
          id: 3,
          lease_id: 2,
          period: "2026-11",
          due_date: "2026-11-05",
          amount: 1000,
          amount_paid: 0,
          status: "open",
          notes: null,
          created_at: "2026-11-01T00:00:00Z",
          tenant_first_name: "Ada",
          tenant_last_name: "Lovelace",
          property_name: "Oak",
          unit_name: "1A",
        } satisfies RentCharge,
      ],
      applications: [
        {
          id: 4,
          unit_id: 1,
          first_name: "Grace",
          last_name: "Hopper",
          email: null,
          phone: null,
          monthly_income: null,
          employer: null,
          desired_move_in: "2026-11-28",
          status: "new",
          notes: null,
          created_at: "2026-11-01T00:00:00Z",
          property_name: "Oak",
          unit_name: "2B",
        } satisfies Application,
      ],
    });

    expect(events.map((e) => e.kind).sort()).toEqual([
      "application_move_in",
      "lease_end",
      "lease_start",
      "rent_due",
      "wo_follow_up",
      "wo_scheduled",
    ]);
    expect(events.find((e) => e.kind === "wo_scheduled")?.href).toBe("/maintenance?wo=1");
    expect(events.find((e) => e.kind === "lease_start")?.href).toBe("/tenants/9");
    expect(events.find((e) => e.kind === "rent_due")?.href).toBe("/rent?period=2026-11");
    expect(events.find((e) => e.kind === "application_move_in")?.href).toBe("/applications?app=4");
  });

  it("links leases without tenant to leases query", () => {
    const events = buildCalendarEvents({
      workOrders: [],
      leases: [lease({ id: 8, primary_tenant_id: null, start_date: "2026-06-01", end_date: "2027-05-31" })],
      charges: [],
    });
    expect(events.find((e) => e.kind === "lease_start")?.href).toBe("/leases?lease=8");
  });
});

describe("buildMonthGrid / groupEventsByDay", () => {
  it("pads November 2026 (Sunday start)", () => {
    // Nov 1 2026 is Sunday → no leading pad
    const grid = buildMonthGrid(2026, 10);
    expect(grid[0]).toBe(1);
    expect(grid.filter((d) => d != null)).toHaveLength(30);
    expect(grid.length % 7).toBe(0);
  });

  it("groups only events in the viewed month", () => {
    const events = buildCalendarEvents({
      workOrders: [
        wo({ id: 1, title: "A", scheduled_at: "2026-11-10" }),
        wo({ id: 2, title: "B", scheduled_at: "2026-12-01" }),
      ],
      leases: [],
      charges: [],
    });
    const byDay = groupEventsByDay(events, 2026, 10);
    expect(byDay.get("2026-11-10")).toHaveLength(1);
    expect(byDay.has("2026-12-01")).toBe(false);
  });
});
