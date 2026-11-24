import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ShellChromeProvider } from "@/components/chrome/shell-chrome-context";
import { AppContext } from "@/context";
import type { AppStateValue } from "@/hooks/use-app-state";
import { formatMoney } from "@/lib/utils";
import type { Lease, Property, PropertyDocument, RentCharge, Unit, WorkOrder } from "@/types";
import {
  LandlordHomePage,
  ReadyHome,
  buildReadyHome,
  greetingTitle,
  portfolioSubtitle,
} from "./landlord-home-page";

const now = new Date(2026, 10, 16, 9, 30);
const monthYear = now.toLocaleDateString(undefined, { month: "long", year: "numeric" });
const month = now.toLocaleDateString(undefined, { month: "long" });

function property(partial: Partial<Property> & Pick<Property, "id" | "name">): Property {
  return {
    type: "multi_family",
    address: "12 Maple Street",
    city: "Town",
    state: null,
    zip: null,
    year_built: null,
    notes: null,
    color: "#355",
    landlord_id: 1,
    created_at: "2026-01-01T00:00:00Z",
    unit_count: 2,
    occupied_count: 2,
    ...partial,
  };
}

function unit(partial: Partial<Unit> & Pick<Unit, "id" | "property_id" | "name" | "status">): Unit {
  return {
    bedrooms: 1,
    bathrooms: 1,
    sqft: null,
    market_rent: 900,
    readiness_status: "ready",
    notes: null,
    created_at: "2026-01-01T00:00:00Z",
    ...partial,
  };
}

function charge(partial: Partial<RentCharge> & Pick<RentCharge, "id" | "status" | "amount" | "amount_paid">): RentCharge {
  return {
    lease_id: 1,
    period: "2026-11",
    due_date: "2026-11-01",
    notes: null,
    created_at: "2026-11-01T00:00:00Z",
    property_id: 1,
    ...partial,
  };
}

function lease(partial: Partial<Lease> & Pick<Lease, "id" | "end_date">): Lease {
  return {
    unit_id: 1,
    primary_tenant_id: 1,
    start_date: "2025-12-15",
    monthly_rent: 900,
    deposit: 900,
    rent_due_day: 1,
    late_fee: 0,
    status: "active",
    notes: null,
    created_at: "2025-12-01T00:00:00Z",
    property_id: 1,
    ...partial,
  };
}

function order(partial: Partial<WorkOrder> & Pick<WorkOrder, "id" | "title" | "status" | "created_at">): WorkOrder {
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
    ...partial,
  };
}

function documentRow(
  partial: Partial<PropertyDocument> & Pick<PropertyDocument, "id" | "title" | "created_at">,
): PropertyDocument {
  return {
    property_id: 2,
    unit_id: null,
    file_name: "report.pdf",
    content_type: "application/pdf",
    byte_size: 1200,
    storage_path: "docs/report.pdf",
    visibility: "landlord",
    uploaded_by_role: "admin",
    notes: null,
    ...partial,
  };
}

const maple = property({ id: 1, name: "Maple Court" });
const birch = property({
  id: 2,
  name: "Birch House",
  address: "4 Birch Lane",
  unit_count: 2,
  occupied_count: 1,
});

function renderReady(model: ReturnType<typeof buildReadyHome>) {
  return renderToStaticMarkup(
    createElement(ReadyHome, {
      model,
      navigate: () => undefined,
      onDownload: () => undefined,
      downloadingId: null,
      onRetry: () => undefined,
    }),
  );
}

function renderPage(state: Partial<AppStateValue>) {
  return renderToStaticMarkup(
    createElement(AppContext.Provider, {
      value: state as AppStateValue,
      children: createElement(ShellChromeProvider, {
        value: {
          email: "lena@example.com",
          role: "landlord",
          displayName: "Lena Owner",
          onSignOut: () => undefined,
        },
        children: createElement(LandlordHomePage, { navigate: () => undefined }),
      }),
    }),
  );
}

function visibleText(html: string): string {
  return html.replace(/&#x27;|&#39;|&apos;/g, "'");
}

describe("landlord home copy", () => {
  it("greets by time of day and falls back when the name is missing", () => {
    expect(greetingTitle(new Date(2026, 10, 16, 9), "Lena")).toBe("Good morning, Lena.");
    expect(greetingTitle(new Date(2026, 10, 16, 14), "Lena")).toBe("Good afternoon, Lena.");
    expect(greetingTitle(new Date(2026, 10, 16, 19), "Lena")).toBe("Good evening, Lena.");
    expect(greetingTitle(new Date(2026, 10, 16, 9), null)).toBe("Good morning.");
    expect(greetingTitle(new Date(2026, 10, 16, 9), "  ")).toBe("Good morning.");
  });

  it("builds the portfolio subtitle for ready, empty, and error", () => {
    expect(portfolioSubtitle("ready", { properties: 2, units: 5 }, now)).toBe(
      `2 properties · 5 units · ${monthYear}`,
    );
    expect(portfolioSubtitle("ready", { properties: 1, units: 1 }, now)).toBe(
      `1 property · 1 unit · ${monthYear}`,
    );
    expect(portfolioSubtitle("empty", { properties: 0, units: 0 }, now)).toBe(
      `No properties linked yet · ${monthYear}`,
    );
    expect(portfolioSubtitle("error", { properties: 0, units: 0 }, now)).toBe(monthYear);
  });
});

describe("buildReadyHome", () => {
  it("ranks attention by urgency and keeps the five most urgent", () => {
    const model = buildReadyHome({
      now,
      name: "Lena",
      properties: [maple, birch],
      orders: [
        order({
          id: 995,
          title: "Boiler",
          status: "on_hold",
          created_at: "2026-11-10T12:00:00",
          request_number: "MR-000995",
          property_id: 2,
          property_name: "Birch House",
          hold_reason: "waiting for part",
          next_follow_up_date: "2026-11-20",
        }),
        order({
          id: 1,
          title: "Closed tap",
          status: "closed",
          created_at: "2026-11-02T12:00:00",
          property_id: 99,
          property_name: "Someone else",
        }),
      ],
      charges: [
        charge({
          id: 10,
          status: "overdue",
          amount: 725,
          amount_paid: 0,
          due_date: "2026-11-01",
          unit_name: "1B",
          property_name: "Maple Court",
          tenant_first_name: "Raj",
          tenant_last_name: "Patel",
        }),
        charge({
          id: 11,
          status: "open",
          amount: 400,
          amount_paid: 0,
          due_date: "2026-11-15",
          unit_name: "2A",
          property_name: "Maple Court",
        }),
        charge({
          id: 99,
          status: "overdue",
          amount: 9999,
          amount_paid: 0,
          property_id: 99,
          property_name: "Someone else",
          unit_name: "9Z",
        }),
      ],
      leases: [
        lease({
          id: 4,
          end_date: "2026-12-15",
          unit_name: "1B",
          property_name: "Maple Court",
          tenant_first_name: "Raj",
          tenant_last_name: "Patel",
        }),
      ],
      units: [
        unit({ id: 1, property_id: 1, name: "1B", status: "occupied" }),
        unit({ id: 2, property_id: 2, name: "1", status: "vacant", property_name: "Birch House" }),
        unit({ id: 3, property_id: 2, name: "2", status: "occupied" }),
      ],
      documents: [
        documentRow({
          id: 7,
          title: "Boiler service report.pdf",
          created_at: "2026-11-15T15:00:00",
          property_name: "Birch House",
        }),
      ],
      pending: [{ amount: 250, method: "zelle", propertyId: 1 }],
      marketed: new Map([[2, false]]),
    });

    expect(model.attention.map((item) => item.id)).toEqual([
      "rent-10",
      "rent-11",
      "lease-4",
      "hold-995",
      "vacant-2",
    ]);
    const late = model.attention[0];
    expect(late.kind).toBe("link");
    if (late.kind === "link") {
      expect(late.title).toBe(`Unit 1B rent 15 days late · ${formatMoney(725)} outstanding`);
      expect(late.context).toBe("Maple Court · Raj Patel · Late 15 days");
      expect(late.href).toBe("/properties/1");
    }
    const hold = model.attention[3];
    if (hold.kind === "link") {
      expect(hold.title).toContain("Boiler on hold · follow-up");
      expect(hold.context).toBe("#MR-000995 · Birch House · waiting for part");
      expect(hold.href).toBe("/maintenance/995");
    }
    const vacant = model.attention[4];
    if (vacant.kind === "link") {
      expect(vacant.title).toBe("Birch House 1 vacant and not marketed");
      expect(vacant.context).toBe("Vacant · Ready");
    }
    expect(model.attentionPartial).toBe(false);
    expect(model.rent.headline).toContain(formatMoney(725 + 400));
    expect(model.rent.pendingLine).toBe(`Awaiting verification ${formatMoney(250)} · Zelle`);
    expect(model.maintenance.countLine).toBe("1 open · 1 on hold");
    expect(model.maintenance.rows[0]?.title).toBe("#MR-000995 Boiler · Birch House");
    expect(model.maintenance.rows[0]?.href).toBe("/maintenance/995");
  });

  it("describes an all-clear month without inventing a verification queue", () => {
    const model = buildReadyHome({
      now,
      name: "Lena",
      properties: [property({ id: 1, name: "Maple Court", unit_count: 3, occupied_count: 2 })],
      orders: [],
      charges: [
        charge({ id: 1, status: "paid", amount: 1450, amount_paid: 1450, due_date: "2026-11-01" }),
        charge({ id: 2, status: "paid", amount: 1450, amount_paid: 1450, due_date: "2026-11-01", unit_id: 2 }),
        charge({ id: 3, status: "waived", amount: 500, amount_paid: 0, due_date: "2026-11-01" }),
      ],
      leases: [lease({ id: 1, end_date: "2027-11-01", status: "active" })],
      units: [
        unit({ id: 1, property_id: 1, name: "1A", status: "occupied" }),
        unit({ id: 2, property_id: 1, name: "1B", status: "occupied" }),
        unit({ id: 3, property_id: 1, name: "1C", status: "occupied" }),
      ],
      documents: [],
      pending: [],
      marketed: new Map(),
    });

    expect(model.attention).toEqual([]);
    expect(model.rent.title).toBe(`Rent · ${month}`);
    expect(model.rent.headline).toBe(`All ${formatMoney(2900)} collected`);
    expect(model.rent.percent).toBe(100);
    expect(model.rent.caption).toBe("Nothing outstanding");
    expect(model.rent.pendingLine).toBe("No payments awaiting verification");
    expect(model.rent.badges.map((badge) => badge.label)).toEqual(["Paid 2", "Vacant 1"]);
    expect(model.kpis.find((tile) => tile.id === "occupancy")?.value).toBe("67%");

    const html = visibleText(renderReady(model));
    expect(html).toContain("Nothing needs you right now.");
    expect(html).toContain("Late rent, leases ending soon and anything waiting on you will show up here.");
    expect(html).toContain("All clear");
    expect(html).toContain("No payments awaiting verification");
    expect(html).toContain("The rent roll isn't in this portal yet.");
    expect(html).toContain("Office phone:");
    expect(html).toContain("To be confirmed");
    expect(html).not.toContain("Document shared");
  });

  it("hides the verification line when that read fails and says the list is partial", () => {
    const model = buildReadyHome({
      now,
      name: "Lena",
      properties: [maple],
      orders: null,
      charges: null,
      leases: [],
      units: [],
      documents: [],
      pending: null,
      marketed: null,
    });
    expect(model.attentionPartial).toBe(true);
    expect(model.rent.unavailable).toBe(true);
    expect(model.rent.pendingLine).toBeNull();
    expect(model.kpis.find((tile) => tile.id === "requests")?.value).toBe("—");
    const html = visibleText(renderReady(model));
    expect(html).toContain("Some of this list couldn't be loaded.");
    expect(html).toContain("Rent totals couldn't be loaded.");
    expect(html).not.toContain("No payments awaiting verification");
    expect(html).not.toContain("Awaiting verification");
  });

  it("prefixes a new office document and keeps it off the list when it is the least urgent", () => {
    const onlyDoc = buildReadyHome({
      now,
      name: null,
      properties: [birch],
      orders: [],
      charges: [],
      leases: [],
      units: [unit({ id: 2, property_id: 2, name: "1", status: "occupied" })],
      documents: [
        documentRow({
          id: 7,
          title: "Boiler service report.pdf",
          created_at: "2026-11-15T15:00:00",
          property_name: "Birch House",
        }),
      ],
      pending: [],
      marketed: null,
    });
    const doc = onlyDoc.attention[0];
    expect(doc?.kind).toBe("document");
    if (doc?.kind === "document") {
      expect(doc.model.title).toBe("New document from Landlord Gopher · Boiler service report.pdf");
    }
    expect(
      onlyDoc.activity.days.flatMap((day) => day.items).some((item) => item.event.includes("Boiler service report.pdf")),
    ).toBe(true);
  });
});

describe("LandlordHomePage states", () => {
  it("shows the loading skeleton before the portfolio arrives", () => {
    const html = visibleText(renderPage({ loading: true, error: null, properties: [] }));
    expect(html).toContain("Loading home");
    expect(html).toContain("Good ");
    expect(html).toContain("Lena");
    expect(html).toContain("Message Landlord Gopher");
    expect(html).not.toContain("Report an issue");
  });

  it("shows the portfolio error copy and a retry", () => {
    const html = visibleText(renderPage({ loading: false, error: "offline", properties: [] }));
    expect(html).toContain(
      "We couldn't load your portfolio. Check your connection and try again. If it keeps happening, message Landlord Gopher.",
    );
    expect(html).toContain("Retry");
    expect(html).toContain(monthYear);
    expect(html).not.toContain("No properties are linked");
  });

  it("shows the empty portfolio copy without a report action", () => {
    const html = visibleText(renderPage({ loading: false, error: null, properties: [] }));
    expect(html).toContain("No properties are linked to your account yet.");
    expect(html).toContain(
      "Landlord Gopher links your properties once your management agreement is set up. Message us and we'll get you connected.",
    );
    expect(html).toContain(`No properties linked yet · ${monthYear}`);
    expect(html).not.toContain("Report an issue");
  });
});

describe("landlord home review fixes", () => {
  it("counts an unread thread that sits past the three shown", () => {
    const model = buildReadyHome({
      now,
      name: "Lena",
      properties: [maple],
      orders: [
        order({ id: 1, title: "Newest closed", status: "closed", created_at: "2026-11-16T08:00:00", property_id: 1 }),
        order({ id: 2, title: "Second closed", status: "closed", created_at: "2026-11-15T08:00:00", property_id: 1 }),
        order({ id: 3, title: "Third closed", status: "closed", created_at: "2026-11-14T08:00:00", property_id: 1 }),
        order({ id: 4, title: "Older open", status: "open", created_at: "2026-11-04T08:00:00", property_id: 1 }),
      ],
      charges: [],
      leases: [],
      units: [],
      documents: [],
      pending: [],
      marketed: null,
    });

    expect(model.messages.unavailable).toBe(false);
    expect(model.messages.unread).toBe(1);
    expect(model.messages.threads.map((thread) => thread.id)).toEqual(["wo:1", "wo:2", "wo:3"]);
    expect(model.messages.threads.every((thread) => !thread.unread)).toBe(true);
  });

  it("treats a failed request load as unavailable instead of an empty inbox", () => {
    const model = buildReadyHome({
      now,
      name: "Lena",
      properties: [maple],
      orders: null,
      charges: [],
      leases: [],
      units: [],
      documents: [],
      pending: [],
      marketed: null,
    });

    expect(model.messages.unavailable).toBe(true);
    expect(model.messages.threads).toEqual([]);
    expect(model.messages.unread).toBe(0);
    expect(model.activity.unavailable).toBe(true);
    expect(model.activity.days).toEqual([]);
    expect(model.maintenance.unavailable).toBe(true);

    const html = visibleText(renderReady(model));
    expect(html).toContain("Messages couldn't be loaded.");
    expect(html).toContain("Recent activity couldn't be loaded.");
    expect(html).not.toContain("No conversations yet.");
    expect(html).not.toContain("Nothing new across your properties.");
    expect(html).not.toContain("All read");
  });

  it("skips zero balances and dates that cannot be counted", () => {
    const model = buildReadyHome({
      now,
      name: "Lena",
      properties: [maple],
      orders: [],
      charges: [
        charge({ id: 1, status: "overdue", amount: 80, amount_paid: 80, due_date: "2026-11-01" }),
        charge({ id: 2, status: "overdue", amount: 40, amount_paid: 0, due_date: "" }),
        charge({ id: 3, status: "open", amount: 40, amount_paid: 0, due_date: "not-a-date" }),
      ],
      leases: [
        lease({ id: 8, end_date: "not-a-date" }),
        lease({ id: 9, end_date: "2026-12-01", unit_name: "1A" }),
      ],
      units: [],
      documents: [],
      pending: [],
      marketed: null,
    });

    const titles = model.attention.flatMap((item) => (item.kind === "link" ? [item.title] : []));
    expect(titles.some((title) => title.includes("NaN"))).toBe(false);
    expect(titles).toContain(`rent overdue · ${formatMoney(40)} outstanding`);
    expect(model.attention.map((item) => item.id)).toEqual(["rent-2", "lease-9"]);
    const overdue = model.attention[0];
    if (overdue.kind === "link") expect(overdue.context).not.toContain("NaN");
  });
});
