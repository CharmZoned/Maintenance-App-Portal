import {
  formatDocumentDate,
  landlordDocumentRowModel,
} from "@/components/landlord";
import { BILLED_LABEL, billedSpend, billedSpendText } from "@/lib/billed-spend";
import { threadsFromWorkOrders } from "@/lib/messages";
import { formatActivityStamp, priorityLevel, requestNextStep, toRequestStatus } from "@/lib/request-status";
import { daysBetween, formatMoney, toIsoDate } from "@/lib/utils";
import type { Lease, Property, PropertyDocument, RentCharge, Unit, WorkOrder } from "@/types";

/**
 * View models for the landlord properties list and property page
 * (Figma LP / LPD). The rent-roll tab is omitted on purpose.
 *
 * Copy that needs a field we do not store (payment method, verification,
 * manager phone, common areas, direct tenant threads) is left out rather
 * than filled with the sample frame's names.
 */

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** Leases ending inside this window show on "Needs your attention". */
export const LEASE_ENDING_WITHIN_DAYS = 45;

export const PROPERTY_TABS = ["overview", "units", "requests", "messages", "documents"] as const;
export type PropertyTab = (typeof PROPERTY_TABS)[number];

export const RENT_FILTERS = [
  { value: "all", label: "Rent status: All" },
  { value: "late", label: "Rent status: Late" },
  { value: "partial", label: "Rent status: Partially paid" },
  { value: "due", label: "Rent status: Due" },
  { value: "paid", label: "Rent status: Paid" },
  { value: "none", label: "Rent status: None due" },
] as const;

export type RentFilter = (typeof RENT_FILTERS)[number]["value"];
export type RentStatus = Exclude<RentFilter, "all">;
export type ChipTone = "neutral" | "warning" | "info" | "success" | "brand";

export type FactChip = { label: string; tone: ChipTone };

export const PROPERTIES_READ_ONLY_NOTE = {
  title: "Need to add or change a property?",
  body: "Landlord Gopher keeps property details up to date. Send us a message and we'll take care of it.",
  action: "Message Landlord Gopher",
} as const;

export const PROPERTIES_EMPTY = {
  title: "No properties are linked to your account yet.",
  body: "Landlord Gopher links your properties for you. Send a message and we'll take care of it.",
  action: "Message Landlord Gopher",
} as const;

export const PROPERTIES_ERROR = {
  title: "We couldn't load your properties.",
  body: "Check your connection and try again. If this keeps happening, message Landlord Gopher.",
} as const;

export const PROPERTY_ERROR = {
  title: "We couldn't load this property.",
  body: "Units, rent, requests, messages and documents will show here once it loads.",
} as const;

export const PROPERTY_UNAVAILABLE = {
  title: "This property isn't available",
  body: "It may no longer be linked to your account.",
} as const;

export type PropertyCardModel = {
  id: number;
  name: string;
  address: string;
  unreadLabel: string | null;
  chips: FactChip[];
  facts: { label: string; value: string }[];
  footer: string;
  /** Null when portfolio detail rows have not loaded successfully. */
  rentStatus: RentStatus | null;
  searchText: string;
};

export type AttentionItem = {
  id: string;
  kind: "rent" | "lease";
  title: string;
  detail: string;
  badge?: FactChip;
};

export type RentRowModel = {
  id: string;
  title: string;
  detail: string;
  badge: FactChip;
};

export type RentPanelModel = {
  title: string;
  headline: string;
  percent: number | null;
  caption: string;
  rows: RentRowModel[];
};

export type RequestRowModel = {
  id: number;
  title: string;
  meta: string;
  next: string;
  status: ReturnType<typeof toRequestStatus>;
  open: boolean;
};

export type UnitCardModel = {
  id: number;
  name: string;
  badge: FactChip | null;
  initials: string | null;
  person: string;
  personLine: string;
  leaseLine: string | null;
  leaseBadge: FactChip | null;
  rentLabel: string;
  rentLine: string;
  requestsLine: string;
  requestBadge: FactChip | null;
};

export type MessageRowModel = {
  id: string;
  requestId: number | null;
  title: string;
  preview: string;
  meta: string;
  time: string;
  unread: boolean;
};

export type PropertyDetailModel = {
  eyebrow: string;
  title: string;
  description: string;
  tabs: { id: PropertyTab; label: string }[];
  kpis: { label: string; value: string; caption: string }[];
  attention: AttentionItem[];
  rent: RentPanelModel;
  details: { label: string; value: string }[];
  maintenance: {
    summary: string;
    /** "Billed this year" — the shared figure from lib/billed-spend. */
    spendLabel: string;
    spendValue: string;
    spendCaption: string;
    rows: RequestRowModel[];
  };
  unitsHeading: string;
  units: UnitCardModel[];
  openRequests: RequestRowModel[];
  completedRequests: RequestRowModel[];
  messages: MessageRowModel[];
  documentCount: number;
};

type PortfolioInput = {
  properties: Property[];
  units: Unit[];
  charges: RentCharge[];
  workOrders: WorkOrder[];
  documents: PropertyDocument[];
  currency?: string;
  now?: Date;
  /**
   * False while unit/charge/request rows are still loading or after a detail
   * load failure. Fall back to property counts and unavailable rent/request copy.
   */
  unitsLoaded?: boolean;
};

type DetailInput = {
  property: Property;
  units: Unit[];
  charges: RentCharge[];
  leases: Lease[];
  workOrders: WorkOrder[];
  documents: PropertyDocument[];
  currency?: string;
  now?: Date;
};

export function portfolioDescription(counts: {
  properties: number;
  units: number;
  occupied: number;
}): string {
  if (counts.properties === 0) return "0 properties";
  const pct = counts.units === 0 ? 0 : Math.round((counts.occupied / counts.units) * 100);
  return `${plural(counts.properties, "property")} · ${plural(counts.units, "unit")} · ${pct}% occupied. Open a property to see its units, rent, requests, messages and documents.`;
}

export function showingPropertiesLabel(shown: number, total: number): string {
  const noun = total === 1 ? "property" : "properties";
  return `Showing ${shown} of ${total} ${noun}`;
}

export function isMissingPropertyError(message: string): boolean {
  const text = message.toLowerCase();
  return (
    text.includes("0 rows") ||
    text.includes("no rows") ||
    text.includes("not found") ||
    text.includes("multiple (or no) rows") ||
    text.includes("cannot coerce") ||
    text.includes("pgrst116")
  );
}

export function buildPortfolioCards(input: PortfolioInput): PropertyCardModel[] {
  const now = input.now ?? new Date();
  const unitsLoaded = input.unitsLoaded !== false;
  return input.properties
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id)
    .map((property) =>
      buildPropertyCardModel({
        property,
        units: input.units.filter((unit) => unit.property_id === property.id),
        charges: input.charges.filter((charge) => charge.property_id === property.id),
        workOrders: input.workOrders.filter((order) => order.property_id === property.id),
        documents: input.documents.filter((doc) => doc.property_id === property.id),
        currency: input.currency,
        now,
        unitsLoaded,
      }),
    );
}

export function filterPropertyCards(
  cards: PropertyCardModel[],
  opts: { query: string; rent: RentFilter },
): PropertyCardModel[] {
  const query = opts.query.trim().toLowerCase();
  return cards.filter((card) => {
    if (opts.rent !== "all" && card.rentStatus !== opts.rent) return false;
    if (!query) return true;
    return card.searchText.includes(query);
  });
}

export function buildPropertyDetailModel(input: DetailInput): PropertyDetailModel {
  const now = input.now ?? new Date();
  const month = monthName(now);
  const currency = input.currency ?? "USD";
  const units = input.units.slice().sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
  const charges = input.charges.filter((charge) => charge.property_id === input.property.id);
  const orders = input.workOrders
    .filter((order) => order.property_id === input.property.id)
    .slice()
    .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  const openOrders = orders.filter((order) => order.status !== "closed");
  const closedOrders = orders.filter((order) => order.status === "closed");
  const billedText = billedSpendText(billedSpend(closedOrders, now), currency);
  const onHold = openOrders.filter((order) => order.status === "on_hold").length;
  const occupied = units.filter((unit) => unit.status === "occupied").length;
  const rent = rentSummary(charges, units, month, currency, now);
  const breakdown = requestBreakdown(openOrders);
  const threads = threadsFromWorkOrders(orders, { now });
  const unread = threads.filter((thread) => thread.unread).length;

  const tabs: PropertyDetailModel["tabs"] = [
    { id: "overview", label: "Overview" },
    { id: "units", label: units.length ? `Units · ${units.length}` : "Units" },
    { id: "requests", label: openOrders.length ? `Requests · ${openOrders.length}` : "Requests" },
    { id: "messages", label: unread ? `Messages · ${unread}` : threads.length ? `Messages · ${threads.length}` : "Messages" },
    {
      id: "documents",
      label: input.documents.length ? `Documents · ${input.documents.length}` : "Documents",
    },
  ];

  return {
    eyebrow: `Property · ${plural(units.length, "unit")}`,
    title: input.property.name,
    description: propertyDescription(input.property),
    tabs,
    kpis: [
      {
        label: "Units",
        value: String(units.length),
        caption: units.length ? units.map((unit) => unit.name).join(" · ") : "No units",
      },
      {
        label: "Occupied",
        value: `${occupied} of ${units.length}`,
        caption: `${units.length ? Math.round((occupied / units.length) * 100) : 0}% occupancy`,
      },
      {
        label: `Collected · ${SHORT_MONTHS[now.getMonth()].toUpperCase()}`,
        value: rent.percent == null ? "—" : `${rent.percent}%`,
        caption: rent.collectedCaption,
      },
      {
        label: "Open requests",
        value: String(openOrders.length),
        caption: breakdown.caption,
      },
    ],
    attention: attentionItems({ charges, leases: input.leases, units, currency, now }),
    rent: {
      title: `Rent · ${month}`,
      headline: rent.headline,
      percent: rent.percent,
      caption: rent.caption,
      rows: rent.rows,
    },
    details: propertyDetailFields(input.property, units),
    maintenance: {
      summary: `${openOrders.length} open · ${onHold} on hold`,
      spendLabel: `${BILLED_LABEL} this year`,
      spendValue: billedText.yearAmount,
      spendCaption: billedText.month,
      rows: openOrders.slice(0, 3).map((order) => requestRow(order)),
    },
    unitsHeading: `${plural(units.length, "unit")} · ${occupied} occupied`,
    units: units.map((unit) =>
      unitCard({
        unit,
        charge: charges.find((charge) => charge.unit_id === unit.id) ?? null,
        lease: activeLease(input.leases, unit.id),
        orders,
        month,
        currency,
        now,
      }),
    ),
    openRequests: openOrders.map(requestRow),
    completedRequests: closedOrders.map(requestRow),
    messages: threads.map((thread) => ({
      id: thread.id,
      requestId: thread.requestId ?? null,
      title: thread.title,
      preview: thread.preview,
      meta: "Request thread",
      time: formatActivityStamp(thread.updatedAt),
      unread: thread.unread,
    })),
    documentCount: input.documents.length,
  };
}

function buildPropertyCardModel(input: {
  property: Property;
  units: Unit[];
  charges: RentCharge[];
  workOrders: WorkOrder[];
  documents: PropertyDocument[];
  currency?: string;
  now: Date;
  unitsLoaded: boolean;
}): PropertyCardModel {
  const currency = input.currency ?? "USD";
  const month = monthName(input.now);
  const units = input.units.slice().sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
  const unitCount = input.unitsLoaded ? units.length : (input.property.unit_count ?? 0);
  const occupied = input.unitsLoaded
    ? units.filter((unit) => unit.status === "occupied").length
    : (input.property.occupied_count ?? 0);
  const detailsReady = input.unitsLoaded;
  const openOrders = detailsReady
    ? input.workOrders.filter((order) => order.status !== "closed")
    : [];
  const rent = detailsReady ? classifyRent(input.charges, input.now) : null;
  const unread = detailsReady
    ? threadsFromWorkOrders(input.workOrders, { now: input.now }).filter((thread) => thread.unread).length
    : 0;
  const address = propertyAddress(input.property);
  const occupancyValue = occupancyFact(occupied, unitCount);
  const allVacant = unitCount > 0 && occupied === 0;
  const unavailable = "Details didn't load";

  return {
    id: input.property.id,
    name: input.property.name,
    address: address || "Address not on file",
    unreadLabel: unread === 0 ? null : unread === 1 ? "1 unread message" : `${unread} unread messages`,
    chips: [
      { label: plural(unitCount, "unit"), tone: "neutral" },
      occupancyChip(occupied, unitCount, detailsReady ? units : []),
      detailsReady && rent ? rentChip(rent) : { label: "Rent: unavailable", tone: "neutral" },
      detailsReady ? requestsChip(openOrders) : { label: "Requests unavailable", tone: "neutral" },
    ],
    facts: [
      { label: "Occupancy", value: occupancyValue },
      {
        label: `Rent · ${month}`,
        value: detailsReady && rent ? rentFact(rent, currency, allVacant) : unavailable,
      },
      { label: "Open requests", value: detailsReady ? requestFact(openOrders) : unavailable },
      {
        label: "Last activity",
        value: detailsReady ? lastActivity(input.workOrders, input.documents, input.now) : unavailable,
      },
    ],
    footer: unitFooter(units, input.unitsLoaded, unitCount),
    rentStatus: rent?.status ?? null,
    searchText: [input.property.name, address, input.property.city, input.property.state, ...units.map((unit) => unit.name)]
      .filter(Boolean)
      .join(" ")
      .toLowerCase(),
  };
}

function propertyDescription(property: Property): string {
  const address = propertyAddress(property);
  const managed = "Managed by Landlord Gopher";
  return address ? `${address} · ${managed}` : managed;
}

function propertyAddress(property: Pick<Property, "address" | "city" | "state" | "zip">): string {
  const cityLine = [property.address, property.city].filter(Boolean).join(", ");
  const region = [property.state, property.zip].filter(Boolean).join(" ");
  return [cityLine, region].filter(Boolean).join(", ");
}

function propertyDetailFields(property: Property, units: Unit[]): { label: string; value: string }[] {
  const fields: { label: string; value: string }[] = [];
  const address = propertyAddress(property);
  if (address) fields.push({ label: "Address", value: address });
  fields.push({
    label: "Units",
    value: units.length
      ? units
          .map((unit) => {
            const who = unit.status === "occupied" ? unit.active_tenant_name?.trim() : "vacant";
            return who ? `Unit ${unit.name} · ${who}` : `Unit ${unit.name}`;
          })
          .join("  ·  ")
      : "No units yet",
  });
  fields.push({ label: "Managed by", value: "Landlord Gopher" });
  const notes = property.notes?.trim();
  if (notes) fields.push({ label: "Notes", value: notes });
  return fields;
}

type RentClass = {
  status: RentStatus;
  lateCount: number;
  partialCount: number;
  collected: number;
  total: number;
  lateBalance: number;
  outstanding: number;
};

function classifyRent(charges: RentCharge[], now: Date): RentClass {
  const today = toIsoDate(now);
  const active = charges.filter((charge) => charge.status !== "waived");
  let lateCount = 0;
  let partialCount = 0;
  let openCount = 0;
  let paidCount = 0;
  let collected = 0;
  let total = 0;
  let lateBalance = 0;
  let outstanding = 0;
  for (const charge of active) {
    const balance = Math.max(0, charge.amount - charge.amount_paid);
    collected += charge.amount_paid;
    total += charge.amount;
    outstanding += balance;
    const late = isLate(charge, today);
    if (late) {
      lateCount += 1;
      lateBalance += balance;
    } else if (charge.status === "partial") {
      partialCount += 1;
    } else if (charge.status === "paid" || balance <= 0) {
      paidCount += 1;
    } else if (charge.status === "open") {
      openCount += 1;
    }
  }
  let status: RentStatus = "none";
  if (lateCount > 0) status = "late";
  else if (partialCount > 0) status = "partial";
  else if (openCount > 0) status = "due";
  else if (paidCount > 0) status = "paid";
  return { status, lateCount, partialCount, collected, total, lateBalance, outstanding };
}

function isLate(charge: RentCharge, today: string): boolean {
  if (charge.status === "paid" || charge.status === "waived") return false;
  if (charge.status === "overdue") return true;
  return Boolean(charge.due_date) && charge.due_date < today && charge.amount_paid < charge.amount;
}

function rentChip(rent: RentClass): FactChip {
  if (rent.status === "late") {
    return { label: rent.lateCount === 1 ? "Rent: 1 late" : `Rent: ${rent.lateCount} late`, tone: "warning" };
  }
  if (rent.status === "partial") {
    return {
      label: rent.partialCount === 1 ? "Rent: 1 partial" : `Rent: ${rent.partialCount} partial`,
      tone: "warning",
    };
  }
  if (rent.status === "due") return { label: "Rent: due", tone: "info" };
  if (rent.status === "paid") return { label: "Rent: paid", tone: "success" };
  return { label: "Rent: none due", tone: "neutral" };
}

function rentFact(rent: RentClass, currency: string, allVacant: boolean): string {
  if (rent.status === "none") {
    return allVacant ? "No rent due · unit vacant" : "No rent recorded this month";
  }
  const collected = `${formatMoney(rent.collected, currency)} of ${formatMoney(rent.total, currency)} collected`;
  if (rent.lateBalance > 0) return `${collected} · ${formatMoney(rent.lateBalance, currency)} late`;
  if (rent.outstanding > 0) return `${collected} · ${formatMoney(rent.outstanding, currency)} outstanding`;
  return collected;
}

function rentSummary(
  charges: RentCharge[],
  units: Unit[],
  month: string,
  currency: string,
  now: Date,
): RentPanelModel & { collectedCaption: string } {
  const rent = classifyRent(charges, now);
  const rows = charges
    .filter((charge) => charge.status !== "waived")
    .slice()
    .sort((a, b) => (a.unit_name || "").localeCompare(b.unit_name || ""));
  if (rent.status === "none") {
    const vacant = units.length > 0 && units.every((unit) => unit.status !== "occupied");
    const headline = vacant ? "No rent due · unit vacant" : "No rent recorded this month";
    return {
      title: `Rent · ${month}`,
      headline,
      percent: null,
      caption: headline,
      collectedCaption: "No charges this month",
      rows: [],
    };
  }
  const percent = rent.total > 0 ? Math.round((rent.collected / rent.total) * 100) : 0;
  const bits = [`${percent}% collected`];
  if (rent.outstanding > 0) bits.push(`${formatMoney(rent.outstanding, currency)} outstanding`);
  return {
    title: `Rent · ${month}`,
    headline: `${formatMoney(rent.collected, currency)} of ${formatMoney(rent.total, currency)} collected`,
    percent,
    caption: bits.join(" · "),
    collectedCaption: `${formatMoney(rent.collected, currency)} of ${formatMoney(rent.total, currency)}`,
    rows: rows.map((charge) => chargeRow(charge, currency, now)),
  };
}

function chargeRow(charge: RentCharge, currency: string, now: Date): RentRowModel {
  const today = toIsoDate(now);
  const who = personName(charge.tenant_first_name, charge.tenant_last_name);
  const unit = charge.unit_name?.trim();
  const title = [unit ? `Unit ${unit}` : "Unit", who].filter(Boolean).join(" · ");
  const paid = `${formatMoney(charge.amount_paid, currency)} of ${formatMoney(charge.amount, currency)}`;
  if (isLate(charge, today)) {
    const days = Math.max(1, daysBetween(charge.due_date, today));
    return {
      id: `charge-${charge.id}`,
      title,
      detail: paid,
      badge: { label: `Late · ${plural(days, "day")}`, tone: "warning" },
    };
  }
  if (charge.status === "partial") {
    return { id: `charge-${charge.id}`, title, detail: `${paid} paid`, badge: { label: "Partial", tone: "warning" } };
  }
  if (charge.status === "paid" || charge.amount_paid >= charge.amount) {
    return { id: `charge-${charge.id}`, title, detail: paid, badge: { label: "Paid", tone: "success" } };
  }
  return { id: `charge-${charge.id}`, title, detail: paid, badge: { label: "Due", tone: "info" } };
}

function attentionItems(input: {
  charges: RentCharge[];
  leases: Lease[];
  units: Unit[];
  currency: string;
  now: Date;
}): AttentionItem[] {
  const today = toIsoDate(input.now);
  const items: AttentionItem[] = [];
  for (const charge of input.charges) {
    if (!isLate(charge, today)) continue;
    const days = Math.max(1, daysBetween(charge.due_date, today));
    const who = personName(charge.tenant_first_name, charge.tenant_last_name);
    const unit = charge.unit_name?.trim();
    const where = [unit ? `Unit ${unit}` : null, who].filter(Boolean).join(" · ");
    const remaining = Math.max(0, charge.amount - charge.amount_paid);
    items.push({
      id: `rent-${charge.id}`,
      kind: "rent",
      title: [`Rent ${plural(days, "day")} late`, where].filter(Boolean).join(" · "),
      detail: `${formatMoney(charge.amount_paid, input.currency)} paid · ${formatMoney(remaining, input.currency)} still due`,
      badge: { label: `Late · ${plural(days, "day")}`, tone: "warning" },
    });
  }
  const unitIds = new Set(input.units.map((unit) => unit.id));
  for (const lease of input.leases) {
    if (lease.status !== "active" || !unitIds.has(lease.unit_id)) continue;
    const days = daysBetween(today, lease.end_date);
    if (days < 0 || days > LEASE_ENDING_WITHIN_DAYS) continue;
    const unit = input.units.find((row) => row.id === lease.unit_id);
    const who = personName(lease.tenant_first_name, lease.tenant_last_name) || unit?.active_tenant_name?.trim() || "";
    const where = [unit ? `Unit ${unit.name}` : null, who].filter(Boolean).join(" · ");
    const when = days === 0 ? "today" : `in ${plural(days, "day")}`;
    items.push({
      id: `lease-${lease.id}`,
      kind: "lease",
      title: [`Lease ends ${when}`, where].filter(Boolean).join(" · "),
      detail: `Lease ends ${weekdayDate(lease.end_date)}. Ask Landlord Gopher about a renewal.`,
    });
  }
  return items;
}

function occupancyChip(occupied: number, unitCount: number, units: Unit[]): FactChip {
  if (unitCount === 0) return { label: "No units", tone: "neutral" };
  if (occupied === 0 && unitCount === 1) {
    const readiness = units[0]?.readiness_status;
    return {
      label: readiness === "ready" ? "Vacant · ready" : "Vacant",
      tone: "neutral",
    };
  }
  if (occupied === 0) return { label: "Vacant", tone: "neutral" };
  return { label: `${occupied} of ${unitCount} occupied`, tone: "neutral" };
}

function occupancyFact(occupied: number, unitCount: number): string {
  if (unitCount === 0) return "No units yet";
  const pct = Math.round((occupied / unitCount) * 100);
  const noun = unitCount === 1 ? "unit" : "units";
  return `${pct}% · ${occupied} of ${unitCount} ${noun} occupied`;
}

function requestsChip(openOrders: WorkOrder[]): FactChip {
  if (openOrders.length === 0) return { label: "No open requests", tone: "neutral" };
  const onHold = openOrders.filter((order) => order.status === "on_hold").length;
  if (onHold === openOrders.length) {
    const noun = openOrders.length === 1 ? "1 open request · on hold" : `${openOrders.length} open requests · on hold`;
    return { label: noun, tone: "warning" };
  }
  return {
    label: openOrders.length === 1 ? "1 open request" : `${openOrders.length} open requests`,
    tone: "info",
  };
}

function requestFact(openOrders: WorkOrder[]): string {
  if (openOrders.length === 0) return "None open";
  const breakdown = requestBreakdown(openOrders);
  const reason =
    openOrders.length === 1 && openOrders[0].status === "on_hold" ? openOrders[0].hold_reason?.trim() : "";
  return reason ? `${breakdown.fact}, ${reason}` : breakdown.fact;
}

function requestBreakdown(openOrders: WorkOrder[]): { fact: string; caption: string } {
  if (openOrders.length === 0) return { fact: "None open", caption: "None open" };
  const counts = new Map<string, number>();
  for (const order of openOrders) {
    const label = toRequestStatus(order).toLowerCase();
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const parts = [...counts.entries()].map(([label, count]) => `${count} ${label}`);
  return {
    fact: `${openOrders.length} · ${parts.join(", ")}`,
    caption: parts.join(" · "),
  };
}

function lastActivity(orders: WorkOrder[], documents: PropertyDocument[], now: Date): string {
  type Stamp = { at: number; line: string };
  const stamps: Stamp[] = [];
  for (const order of orders) {
    const iso = order.completed_at || order.scheduled_at || order.created_at;
    const at = Date.parse(iso);
    if (!Number.isFinite(at)) continue;
    const status = toRequestStatus(order).toLowerCase();
    stamps.push({ at, line: `${formatActivityStamp(iso)} · "${order.title}" ${status}` });
  }
  for (const doc of documents) {
    const at = Date.parse(doc.created_at);
    if (!Number.isFinite(at)) continue;
    const when = formatDocumentDate(doc.created_at, now);
    const title = doc.title?.trim() || doc.file_name;
    stamps.push({ at, line: `${when} · ${title} shared` });
  }
  stamps.sort((a, b) => b.at - a.at);
  return stamps[0]?.line ?? "No activity yet";
}

function unitFooter(units: Unit[], unitsLoaded: boolean, unitCount: number): string {
  if (!unitsLoaded) return unitCount ? plural(unitCount, "unit") : "No units";
  if (units.length === 0) return "No units";
  if (units.length === 1) {
    const vacant = units[0].status !== "occupied" ? " · vacant" : "";
    return `Unit ${units[0].name}${vacant}`;
  }
  return `Units ${units.map((unit) => unit.name).join(" · ")}`;
}

function unitCard(input: {
  unit: Unit;
  charge: RentCharge | null;
  lease: Lease | null;
  orders: WorkOrder[];
  month: string;
  currency: string;
  now: Date;
}): UnitCardModel {
  const today = toIsoDate(input.now);
  const tenant = input.unit.active_tenant_name?.trim()
    || (input.lease ? personName(input.lease.tenant_first_name, input.lease.tenant_last_name) : "");
  const occupied = input.unit.status === "occupied";
  const charge = input.charge;
  let badge: FactChip | null = null;
  let rentLine = "No rent recorded this month";
  if (!occupied && !charge) {
    rentLine = "No rent due · unit vacant";
  } else if (charge && charge.status !== "waived") {
    const paid = `${formatMoney(charge.amount_paid, input.currency)} of ${formatMoney(charge.amount, input.currency)}`;
    if (isLate(charge, today)) {
      const days = Math.max(1, daysBetween(charge.due_date, today));
      badge = { label: `Late · ${plural(days, "day")}`, tone: "warning" };
      rentLine = `${paid} paid`;
    } else if (charge.status === "partial") {
      badge = { label: "Partial", tone: "warning" };
      rentLine = `${paid} paid`;
    } else if (charge.status === "paid" || charge.amount_paid >= charge.amount) {
      badge = { label: "Paid", tone: "success" };
      rentLine = `${paid} paid`;
    } else {
      badge = { label: "Due", tone: "info" };
      rentLine = paid;
    }
  }

  const leaseLine = input.lease
    ? `${formatDocumentDate(input.lease.start_date, input.now)} – ${formatDocumentDate(input.lease.end_date, input.now)} · ${formatMoney(input.lease.monthly_rent, input.currency)}/mo`
    : null;
  let leaseBadge: FactChip | null = null;
  if (input.lease?.status === "active") {
    const days = daysBetween(today, input.lease.end_date);
    if (days >= 0 && days <= LEASE_ENDING_WITHIN_DAYS) {
      leaseBadge = {
        label: days === 0 ? "Lease ends today" : `Lease ends in ${plural(days, "day")}`,
        tone: "warning",
      };
    }
  }

  const unitOrders = input.orders.filter((order) => order.unit_id === input.unit.id);
  const open = unitOrders.filter((order) => order.status !== "closed");
  const latestClosed = unitOrders.find((order) => order.status === "closed");
  let requestsLine = "None open";
  let requestBadge: FactChip | null = null;
  if (open.length > 0) {
    const first = open[0];
    requestsLine = `${open.length} · ${requestNumber(first)} ${first.title}`;
    requestBadge = statusChip(toRequestStatus(first));
  } else if (latestClosed) {
    const when = formatActivityStamp(latestClosed.completed_at || latestClosed.created_at);
    requestsLine = `None open · ${latestClosed.title} completed ${when}`;
  }

  const since = input.lease ? formatDocumentDate(input.lease.start_date, input.now) : "";
  return {
    id: input.unit.id,
    name: `Unit ${input.unit.name}`,
    badge,
    initials: occupied && tenant ? initials(tenant) : null,
    person: occupied && tenant ? tenant : "Vacant",
    personLine: occupied && tenant
      ? since ? `Tenant · lease since ${since}` : "Tenant"
      : input.unit.readiness_status === "ready" ? "Ready to lease" : "No tenant",
    leaseLine,
    leaseBadge,
    rentLabel: `Rent · ${input.month}`,
    rentLine,
    requestsLine,
    requestBadge,
  };
}

function requestRow(order: WorkOrder): RequestRowModel {
  const place = order.unit_name?.trim()
    ? `Unit ${order.unit_name.trim()}`
    : "Common area";
  const priority = priorityLevel(order.priority);
  const priorityLabel = priority === "Emergency" ? "Emergency" : priority === "High" ? "High priority" : null;
  const meta = [requestNumber(order), place, priorityLabel].filter(Boolean).join(" · ");
  const next = order.status === "closed"
    ? completedLine(order)
    : requestNextStep(order, { assigneeName: order.vendor_name }) || "";
  return {
    id: order.id,
    title: order.title,
    meta,
    next,
    status: toRequestStatus(order),
    open: order.status !== "closed",
  };
}

function completedLine(order: WorkOrder): string {
  const when = formatActivityStamp(order.completed_at || order.created_at);
  const price = order.landlord_price != null ? formatMoney(order.landlord_price) : "";
  const who = order.vendor_name?.trim() || "";
  return ["Completed", when, price, who].filter(Boolean).join(" · ");
}

function statusChip(status: ReturnType<typeof toRequestStatus>): FactChip {
  if (status === "Completed") return { label: status, tone: "success" };
  if (status === "On hold") return { label: status, tone: "neutral" };
  if (status === "In progress") return { label: status, tone: "brand" };
  if (status === "Assigned") return { label: status, tone: "info" };
  return { label: status, tone: "info" };
}

function activeLease(leases: Lease[], unitId: number): Lease | null {
  return leases.find((lease) => lease.unit_id === unitId && lease.status === "active") ?? null;
}

function requestNumber(order: WorkOrder): string {
  const raw = order.request_number?.trim();
  if (!raw) return `#${order.id}`;
  return raw.startsWith("#") ? raw : `#${raw}`;
}

function personName(first?: string | null, last?: string | null): string {
  return [first, last].filter((part) => part?.trim()).join(" ").trim();
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function monthName(now: Date): string {
  return MONTHS[now.getMonth()];
}

function weekdayDate(iso: string): string {
  const day = iso.slice(0, 10);
  const date = new Date(`${day}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return `${WEEKDAYS[date.getDay()]} ${date.getDate()} ${SHORT_MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

function plural(count: number, noun: string): string {
  if (count === 1) return `1 ${noun}`;
  if (noun === "property") return `${count} properties`;
  return `${count} ${noun}s`;
}

/** Documents tab uses the shared row model; this only picks a stable title for tests. */
export function propertyDocumentTitle(doc: PropertyDocument): string {
  return landlordDocumentRowModel(doc).title;
}
