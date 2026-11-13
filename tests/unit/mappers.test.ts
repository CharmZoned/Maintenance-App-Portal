import { describe, expect, test } from "vitest";
import {
  mapApplication,
  mapUnit,
  mapWorkOrder,
  propertyToInsert,
  unitStatusToDb,
  workOrderPriorityToDb,
  workOrderStatusToDb,
} from "@/lib/mappers";
import type { Tables } from "@/types.supabase";

const mr = (over: Partial<Tables<"MaintenanceRequests">> = {}) =>
  ({
    id: 7,
    request_number: "MR-001007",
    title: "Leaking tap",
    description: "Drips all night",
    category: "Plumbing",
    priority: "Normal",
    status: "Open",
    property_id: 1,
    unit_id: 2,
    submitted_by_tenant_id: 3,
    vendor_id: null,
    assigned_staff_id: null,
    scheduled_for: null,
    closed_at: null,
    cost: null,
    notes: null,
    resolution_notes: null,
    hold_reason: null,
    next_follow_up_date: null,
    permission_to_enter: true,
    created_at: "2026-11-01T10:00:00+00:00",
    ...over,
  }) as Tables<"MaintenanceRequests">;

describe("[R4] work order field mapping (database ↔ screen)", () => {
  test.each([
    ["Open", "open"],
    ["Scheduled", "scheduled"],
    ["In Progress", "in_progress"],
    ["On Hold", "on_hold"],
    ["Closed", "closed"],
  ] as const)("database status %s shows as %s and saves back unchanged", (db, ui) => {
    expect(mapWorkOrder(mr({ status: db })).status).toBe(ui);
    expect(workOrderStatusToDb(ui)).toBe(db);
  });

  test("retired status words from the old database still display sensibly", () => {
    // "Assigned" shows as open (not scheduled) so a staff save cannot trip the admin-only schedule rule.
    expect(mapWorkOrder(mr({ status: "assigned" })).status).toBe("open");
    expect(mapWorkOrder(mr({ status: "completed" })).status).toBe("closed");
    expect(mapWorkOrder(mr({ status: "cancelled" })).status).toBe("closed");
  });

  test("retired or misspelled statuses are refused before they reach the database", () => {
    expect(() => workOrderStatusToDb("assigned")).toThrow(/invalid work order status/i);
    expect(() => workOrderStatusToDb("done")).toThrow(/invalid work order status/i);
  });

  test("an unknown status falls back to open rather than crashing", () => {
    expect(mapWorkOrder(mr({ status: "Mystery" })).status).toBe("open");
  });

  test.each([
    ["Low", "low"],
    ["Normal", "normal"],
    ["High", "high"],
    ["Urgent", "urgent"],
  ] as const)("priority %s round-trips", (db, ui) => {
    expect(mapWorkOrder(mr({ priority: db })).priority).toBe(ui);
    expect(workOrderPriorityToDb(ui)).toBe(db);
  });

  test("renames database columns to the names the screens use", () => {
    const wo = mapWorkOrder(
      mr({ scheduled_for: "2026-11-20T12:00:00+00:00", closed_at: "2026-11-21T09:00:00+00:00", cost: 120 }),
      { tenant_first_name: "Tina", unit_name: "1A" },
    );
    expect(wo).toMatchObject({
      tenant_id: 3,
      scheduled_at: "2026-11-20T12:00:00+00:00",
      completed_at: "2026-11-21T09:00:00+00:00",
      cost: 120,
      permission_to_enter: true,
      tenant_first_name: "Tina",
      unit_name: "1A",
      request_number: "MR-001007",
    });
  });
});

describe("[R3] property and unit field mapping", () => {
  test("a new property gets placeholder address fields the database will accept", () => {
    const row = propertyToInsert({ name: "Maple Court", landlord_id: 4 });
    expect(row).toMatchObject({ property_name: "Maple Court", landlord_id: 4, color: "sky" });
    expect(row.state).toMatch(/^[A-Z]{2}$/);
    expect(row.zip).toMatch(/^[0-9]{5}$/);
    expect(row.street_address.length).toBeGreaterThan(0);
  });

  test("unit status words map to the database's capitalised words", () => {
    expect(unitStatusToDb("vacant")).toBe("Vacant");
    expect(unitStatusToDb("occupied")).toBe("Occupied");
  });

  test("a unit row is shaped for the screens", () => {
    const unit = mapUnit({
      id: 1,
      property_id: 9,
      unit_label: "1A",
      bedrooms: null,
      bathrooms: "1.5",
      sqft: 700,
      market_rent: "1450",
      status: "Occupied",
      notes: null,
      created_at: "2026-11-01T10:00:00+00:00",
    } as unknown as Tables<"Units">);
    expect(unit).toMatchObject({ name: "1A", bedrooms: 0, bathrooms: 1.5, market_rent: 1450, status: "occupied" });
  });
});

describe("[R8] rental application mapping", () => {
  test("an unknown application status displays as new", () => {
    const app = mapApplication({
      id: 1,
      first_name: "A",
      last_name: "B",
      status: "???",
      monthly_income: "4200",
    } as unknown as Tables<"Applications">);
    expect(app.status).toBe("new");
    expect(app.monthly_income).toBe(4200);
  });
});
