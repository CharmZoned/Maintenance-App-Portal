import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { formatMoney } from "@/lib/utils";
import type { WorkOrder } from "@/types";
import { LandlordMaintenanceView } from "./landlord-maintenance-page";
import { buildLandlordQueue, queueDate, type LandlordQueueProperty } from "./landlord-queue";

const now = new Date(2026, 10, 16);

const properties: LandlordQueueProperty[] = [
  { id: 1, name: "Maple Court", address: "12 Maple St", city: "Baltimore" },
  { id: 2, name: "Birch House", address: "48 Birch Ave", city: null },
];

function order(partial: Partial<WorkOrder> & Pick<WorkOrder, "id" | "title" | "status">): WorkOrder {
  return {
    property_id: 1,
    unit_id: null,
    tenant_id: null,
    vendor_id: null,
    description: null,
    category: "General repair",
    priority: "normal",
    permission_to_enter: false,
    scheduled_at: null,
    completed_at: null,
    worker_price: null,
    landlord_price: null,
    notes: null,
    created_at: "2026-11-14",
    ...partial,
  };
}

const kitchen = order({
  id: 1000,
  request_number: "MR-001000",
  title: "Kitchen faucet leaking",
  priority: "high",
  status: "open",
  assigned_staff_id: 9,
  unit_id: 11,
  unit_name: "1A",
  tenant_first_name: "Tina",
  tenant_last_name: "Renter",
  created_at: "2026-11-14",
  scheduled_at: "2026-11-17",
});

const hallway = order({
  id: 998,
  request_number: "MR-000998",
  title: "Hallway light out",
  status: "in_progress",
  unit_name: "Common area",
  created_at: "2026-11-16",
  scheduled_at: "2026-11-16",
});

const boiler = order({
  id: 995,
  request_number: "MR-000995",
  title: "Boiler making noise",
  status: "on_hold",
  property_id: 2,
  hold_reason: "Waiting for part",
  next_follow_up_date: "2026-11-20",
  created_at: "2026-11-10",
});

const fan = order({
  id: 990,
  request_number: "MR-000990",
  title: "Bathroom fan",
  status: "closed",
  unit_id: 12,
  unit_name: "1B",
  tenant_first_name: "Raj",
  tenant_last_name: "Patel",
  created_at: "2026-11-01",
  completed_at: "2026-11-13",
  landlord_price: 180,
  vendor_name: "Harbor Electric",
});

const sample = [kitchen, hallway, boiler, fan];

describe("landlord maintenance queue", () => {
  it("formats a near-future visit with the shared weekday date", () => {
    expect(queueDate("2026-11-17", now)).toBe("Tue 17 Nov");
    expect(queueDate("2026-11-20", now)).toBe("Fri 20 Nov");
    expect(queueDate("2026-11-14", now)).toBe("Sat 14 Nov");
    expect(queueDate("2026-11-01", now)).toBe("1 Nov");
  });

  it("builds the open queue from the maintenance frames", () => {
    const model = buildLandlordQueue({ orders: sample, properties, tab: "open", propertyId: "all", now });
    expect(model.counts).toEqual({ open: 3, onHold: 1, completed: 1, all: 4, emergency: 0 });
    expect(model.openDetail).toBe("0 emergency · 1 on hold");
    expect(model.onHoldDetail).toBe("Boiler · follow-up Fri 20 Nov");
    expect(model.onHoldDetailCompact).toBe("Follow-up Fri 20 Nov");
    expect(model.spendMonthLabel).toBe(`${formatMoney(180)} this month`);
    expect(model.spendYearLabel).toBe(`${formatMoney(180)} this year`);
    expect(model.phoneHeadline).toBe("3 open · 0 emergency · 1 on hold");
    expect(model.empty).toBeNull();
    expect(model.groups.map((group) => group.name)).toEqual(["Birch House", "Maple Court"]);

    const birch = model.groups[0];
    expect(birch.subtitle).toBe("48 Birch Ave · 1 on hold");
    expect(birch.rows[0]).toMatchObject({
      title: "Boiler making noise",
      priority: null,
      context: "#MR-000995 · Whole property · Birch House · Tue 10 Nov",
      status: "On hold",
      statusDetail: "Waiting for part · follow-up Fri 20 Nov",
    });

    const maple = model.groups[1];
    expect(maple.subtitle).toBe("12 Maple St, Baltimore · 2 open");
    expect(maple.rows.map((row) => row.title)).toEqual(["Kitchen faucet leaking", "Hallway light out"]);
    expect(maple.rows[0]).toMatchObject({
      priority: "High priority",
      context: "#MR-001000 · Unit 1A · Reported by Tina Renter · Sat 14 Nov",
      status: "Assigned",
      statusDetail: "Visit Tue 17 Nov",
    });
    expect(maple.rows[1]).toMatchObject({
      context: "#MR-000998 · Common area · Maple Court · Mon 16 Nov",
      status: "In progress",
      statusDetail: "Started today",
    });
    expect(model.openFooter).toEqual({
      desktop: "1 request completed this month. See the Completed tab for cost and vendor.",
      phone: "1 completed this month · see Completed tab",
    });
  });

  it("lists completed cost and the property with nothing finished this month", () => {
    const model = buildLandlordQueue({
      orders: sample,
      properties,
      tab: "completed",
      propertyId: "all",
      now,
    });
    expect(model.groups).toHaveLength(1);
    expect(model.groups[0].name).toBe("Maple Court");
    expect(model.groups[0].subtitle).toBe("12 Maple St, Baltimore · 1 completed");
    expect(model.groups[0].rows[0]).toMatchObject({
      title: "Bathroom fan",
      status: "Completed",
      statusDetail: `Completed Fri 13 Nov · ${formatMoney(180)} · Harbor Electric`,
      context: "#MR-000990 · Unit 1B · Reported by Raj Patel · 1 Nov",
    });
    expect(model.completedNotes).toEqual(["Birch House has no completed requests this month."]);
    expect(model.completedSpendLine).toBe(`Spend: ${formatMoney(180)} this month · ${formatMoney(180)} this year`);
  });

  it("names the property when a tab filter matches nothing", () => {
    const model = buildLandlordQueue({
      orders: sample,
      properties,
      tab: "completed",
      propertyId: 2,
      now,
    });
    expect(model.counts).toEqual({ open: 1, onHold: 1, completed: 0, all: 1, emergency: 0 });
    expect(model.empty).toEqual({
      kind: "filtered",
      title: "No completed requests for Birch House.",
      body: "Try another property, or look in the All tab.",
    });
  });

  it("uses the first-run empty copy when there are no requests", () => {
    const model = buildLandlordQueue({ orders: [], properties, tab: "open", propertyId: "all", now });
    expect(model.empty).toEqual({
      kind: "none",
      title: "No maintenance requests yet.",
      body: "When you or your tenants report an issue, it shows up here with its status and next step.",
    });
    expect(model.counts.all).toBe(0);
  });

  it("counts an open emergency separately from high priority", () => {
    const model = buildLandlordQueue({
      orders: [order({ id: 1, title: "No heat", status: "open", priority: "urgent", property_id: 1 })],
      properties,
      tab: "open",
      propertyId: "all",
      now,
    });
    expect(model.counts.emergency).toBe(1);
    expect(model.groups[0].rows[0].priority).toBe("Emergency");
    expect(model.openDetail).toBe("1 emergency · 0 on hold");
  });
});

function view(props: Partial<Parameters<typeof LandlordMaintenanceView>[0]> = {}) {
  const model = buildLandlordQueue({ orders: sample, properties, tab: "open", propertyId: "all", now });
  return renderToStaticMarkup(
    createElement(LandlordMaintenanceView, {
      model,
      phase: "ready",
      tab: "open",
      onTab: () => undefined,
      propertyId: "all",
      properties,
      onProperty: () => undefined,
      onRetry: () => undefined,
      onOpen: () => undefined,
      onClear: () => undefined,
      ...props,
    }),
  );
}

describe("landlord maintenance queue view", () => {
  it("renders the intro, summary, rows, and view action", () => {
    const html = view();
    expect(html).toContain("Care for your properties");
    expect(html).toContain("Maintenance");
    expect(html).toContain("Track repairs across your properties and report anything new to Landlord Gopher.");
    expect(html).toContain("Open requests");
    expect(html).toContain("Maintenance spend");
    expect(html).toContain("Kitchen faucet leaking");
    expect(html).toContain("High priority");
    expect(html).toContain("View Kitchen faucet leaking");
    expect(html).toContain("Open · 3");
    expect(html).toContain("1 completed this month · see Completed tab");
    expect(html).toContain("1 request completed this month. See the Completed tab for cost and vendor.");
    expect(html).not.toContain("Report an issue");
  });

  it("renders the empty, filtered, and error frames", () => {
    const empty = buildLandlordQueue({ orders: [], properties, tab: "open", propertyId: "all", now });
    const emptyHtml = view({ model: empty });
    expect(emptyHtml).toContain("No maintenance requests yet.");
    expect(emptyHtml).toContain("Open · 0");
    expect(emptyHtml).not.toContain("Report an issue");
    expect(emptyHtml).not.toContain("Clear filter");

    const filtered = buildLandlordQueue({
      orders: sample,
      properties,
      tab: "completed",
      propertyId: 2,
      now,
    });
    const filteredHtml = view({ model: filtered, tab: "completed", propertyId: 2 });
    expect(filteredHtml).toContain("No completed requests for Birch House.");
    expect(filteredHtml).toContain("Clear filter");
    expect(filteredHtml).toContain("Try another property, or look in the All tab.");

    const errorHtml = view({ phase: "error" });
    expect(errorHtml).toContain("We couldn’t load your maintenance requests.");
    expect(errorHtml).toContain("Retry");
    expect(errorHtml).toContain(">Open<");
    expect(errorHtml).not.toContain("Open · 3");
  });

  it("shows skeleton rows while the list is loading", () => {
    const html = view({ phase: "loading" });
    expect(html).toContain("Loading maintenance requests");
    expect(html).not.toContain("Kitchen faucet leaking");
    expect(html).not.toContain("Open · 3");
  });
});
