import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PropertyCard } from "@/components/properties/landlord-properties-page";
import {
  PROPERTIES_EMPTY,
  PROPERTIES_READ_ONLY_NOTE,
  PROPERTY_TABS,
  buildPortfolioCards,
  buildPropertyDetailModel,
  filterPropertyCards,
  isMissingPropertyError,
  portfolioDescription,
  showingPropertiesLabel,
} from "@/lib/landlord-properties";
import type { Lease, Property, PropertyDocument, RentCharge, Unit, WorkOrder } from "@/types";

const now = new Date(2026, 10, 23);

function property(patch: Partial<Property> = {}): Property {
  return {
    id: 1,
    name: "Maple Court",
    type: "multi_family",
    address: "12 Maple St",
    city: "Baltimore",
    state: null,
    zip: null,
    year_built: null,
    notes: null,
    color: "sky",
    landlord_id: 1,
    created_at: "2026-01-01T00:00:00Z",
    ...patch,
  };
}

function unit(patch: Partial<Unit> = {}): Unit {
  return {
    id: 10,
    property_id: 1,
    name: "1A",
    bedrooms: 2,
    bathrooms: 1,
    sqft: null,
    market_rent: 1450,
    status: "occupied",
    readiness_status: "ready",
    notes: null,
    created_at: "2026-01-01T00:00:00Z",
    active_tenant_name: "Tina Renter",
    ...patch,
  };
}

function charge(patch: Partial<RentCharge> = {}): RentCharge {
  return {
    id: 1,
    lease_id: 1,
    period: "2026-11",
    due_date: "2026-11-01",
    amount: 1450,
    amount_paid: 1450,
    status: "paid",
    notes: null,
    created_at: "2026-11-01T00:00:00Z",
    unit_id: 10,
    unit_name: "1A",
    property_id: 1,
    tenant_first_name: "Tina",
    tenant_last_name: "Renter",
    ...patch,
  };
}

function order(patch: Partial<WorkOrder> = {}): WorkOrder {
  return {
    id: 1000,
    request_number: "MR-001000",
    property_id: 1,
    unit_id: 10,
    tenant_id: null,
    vendor_id: null,
    title: "Kitchen faucet leaking",
    description: null,
    category: "Plumbing",
    priority: "high",
    status: "scheduled",
    permission_to_enter: false,
    assigned_staff_id: 4,
    scheduled_at: "2026-11-17T15:00:00Z",
    completed_at: null,
    worker_price: null,
    landlord_price: null,
    notes: null,
    created_at: "2026-11-16T12:00:00Z",
    unit_name: "1A",
    vendor_name: "Sam Fixit",
    ...patch,
  };
}

describe("landlord properties view model", () => {
  it("describes the portfolio and keeps the rent roll tab out", () => {
    expect(portfolioDescription({ properties: 2, units: 3, occupied: 2 })).toBe(
      "2 properties · 3 units · 67% occupied. Open a property to see its units, rent, requests, messages and documents.",
    );
    expect(portfolioDescription({ properties: 0, units: 0, occupied: 0 })).toBe("0 properties");
    expect(showingPropertiesLabel(1, 2)).toBe("Showing 1 of 2 properties");
    expect(PROPERTY_TABS).toEqual(["overview", "units", "requests", "messages", "documents"]);
  });

  it("builds a late property card and filters it", () => {
    const cards = buildPortfolioCards({
      now,
      unitsLoaded: true,
      properties: [property(), property({ id: 2, name: "Birch House", address: "48 Birch Ave", city: null })],
      units: [
        unit(),
        unit({ id: 11, name: "1B", active_tenant_name: "Raj Patel" }),
        unit({
          id: 20,
          property_id: 2,
          name: "1",
          status: "vacant",
          active_tenant_name: null,
          readiness_status: "ready",
        }),
      ],
      charges: [
        charge(),
        charge({
          id: 2,
          unit_id: 11,
          unit_name: "1B",
          amount: 1450,
          amount_paid: 725,
          status: "overdue",
          due_date: "2026-11-01",
          tenant_first_name: "Raj",
          tenant_last_name: "Patel",
        }),
      ],
      workOrders: [
        order(),
        order({
          id: 998,
          request_number: "MR-000998",
          unit_id: null,
          unit_name: null,
          title: "Hallway light out",
          status: "in_progress",
          priority: "normal",
          assigned_staff_id: null,
          created_at: "2026-11-23T13:00:00Z",
        }),
      ],
      documents: [],
    });

    const maple = cards.find((card) => card.name === "Maple Court");
    const birch = cards.find((card) => card.name === "Birch House");
    expect(maple?.chips.map((chip) => chip.label)).toEqual([
      "2 units",
      "2 of 2 occupied",
      "Rent: 1 late",
      "2 open requests",
    ]);
    expect(maple?.facts.find((fact) => fact.label === "Rent · November")?.value).toContain("$725 late");
    expect(maple?.footer).toBe("Units 1A · 1B");
    expect(birch?.chips.map((chip) => chip.label)).toContain("Rent: none due");
    expect(birch?.chips.map((chip) => chip.label)).toContain("Vacant · ready");
    expect(birch?.footer).toBe("Unit 1 · vacant");

    expect(filterPropertyCards(cards, { query: "birch", rent: "all" }).map((card) => card.name)).toEqual([
      "Birch House",
    ]);
    expect(filterPropertyCards(cards, { query: "", rent: "late" }).map((card) => card.name)).toEqual([
      "Maple Court",
    ]);
  });

  it("summarises one property without a rent roll", () => {
    const lease: Lease = {
      id: 7,
      unit_id: 11,
      primary_tenant_id: 3,
      start_date: "2026-02-01",
      end_date: "2026-12-15",
      monthly_rent: 1450,
      deposit: 0,
      rent_due_day: 1,
      late_fee: 0,
      status: "active",
      notes: null,
      created_at: "2026-02-01T00:00:00Z",
      tenant_first_name: "Raj",
      tenant_last_name: "Patel",
    };
    const doc: PropertyDocument = {
      id: 4,
      property_id: 1,
      unit_id: null,
      title: "House rules.pdf",
      file_name: "house-rules.pdf",
      content_type: "application/pdf",
      byte_size: 400_000,
      storage_path: "docs/house-rules.pdf",
      visibility: "tenant",
      uploaded_by_role: "admin",
      notes: null,
      created_at: "2026-02-10T00:00:00Z",
    };
    const model = buildPropertyDetailModel({
      now,
      property: property(),
      units: [unit(), unit({ id: 11, name: "1B", active_tenant_name: "Raj Patel" })],
      charges: [
        charge(),
        charge({
          id: 2,
          unit_id: 11,
          unit_name: "1B",
          amount_paid: 725,
          status: "overdue",
          due_date: "2026-11-08",
          tenant_first_name: "Raj",
          tenant_last_name: "Patel",
        }),
      ],
      leases: [lease],
      workOrders: [
        order({ landlord_price: 180, status: "closed", completed_at: "2026-11-13T12:00:00Z", title: "Bathroom fan" }),
        order({ status: "in_progress", id: 998, title: "Hallway light out", unit_id: null, unit_name: null }),
      ],
      documents: [doc],
    });

    expect(model.tabs.map((tab) => tab.id)).toEqual([...PROPERTY_TABS]);
    expect(model.tabs.some((tab) => tab.label.toLowerCase().includes("rent roll"))).toBe(false);
    expect(model.kpis.map((kpi) => kpi.label)).toEqual(["Units", "Occupied", "Collected · NOV", "Open requests"]);
    expect(model.rent.title).toBe("Rent · November");
    expect(model.rent.headline).toContain("collected");
    expect(model.attention.some((item) => item.kind === "rent" && item.title.includes("Raj Patel"))).toBe(true);
    expect(model.attention.some((item) => item.kind === "lease" && item.detail.includes("15 Dec 2026"))).toBe(true);
    expect(model.units).toHaveLength(2);
    expect(model.units[1]?.leaseBadge?.label).toMatch(/Lease ends in/);
    expect(model.maintenance.spendValue).toBe("$180");
    expect(model.openRequests.some((row) => row.title === "Hallway light out")).toBe(true);
    expect(model.details.find((field) => field.label === "Managed by")?.value).toBe("Landlord Gopher");
    expect(model.details.some((field) => field.label === "Common areas")).toBe(false);
  });

  it("treats a missing property error as unavailable", () => {
    expect(isMissingPropertyError("Cannot coerce the result to a single JSON object")).toBe(true);
    expect(isMissingPropertyError("JSON object requested, multiple (or no) rows returned")).toBe(true);
    expect(isMissingPropertyError("Failed to fetch")).toBe(false);
  });
});

describe("landlord property card", () => {
  it("renders the read-only card copy", () => {
    const [card] = buildPortfolioCards({
      now,
      properties: [property()],
      units: [unit()],
      charges: [charge()],
      workOrders: [],
      documents: [],
    });
    const html = renderToStaticMarkup(createElement(PropertyCard, { card: card!, onOpen: () => undefined }));
    expect(html).toContain("Maple Court");
    expect(html).toContain("Property photo");
    expect(html).toContain("View property ›");
    expect(html).toContain("12 Maple St, Baltimore");
    expect(html).not.toContain("Edit");
    expect(PROPERTIES_READ_ONLY_NOTE.title).toContain("Need to add or change a property?");
    expect(PROPERTIES_EMPTY.title).toContain("No properties are linked");
  });
});
