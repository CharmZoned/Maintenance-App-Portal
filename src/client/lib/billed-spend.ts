import { formatMoney } from "@/lib/utils";
import type { WorkOrder } from "@/types";

/**
 * What an owner has been billed for maintenance: the one figure Home, the
 * property page and the Maintenance page all show (audit N2).
 *
 * Source: `landlord_price` (MaintenanceRequestLandlordPrices), the same amount
 * the request page shows the owner. Only completed requests count, dated by
 * when they were completed. A price on an open request is a quote, not a bill,
 * so it is left out; so is a request with no price.
 */
export type BilledSpend = {
  month: number;
  year: number;
};

export const BILLED_LABEL = "Billed";

type BilledOrder = Pick<WorkOrder, "status" | "landlord_price" | "completed_at" | "created_at">;

/** What a billed-spend read returns: just enough to sum and to scope by property. */
export type BilledRow = BilledOrder & Pick<WorkOrder, "id" | "property_id">;

export function billedAmount(order: BilledOrder): number | null {
  if (order.status !== "closed") return null;
  const price = order.landlord_price;
  if (price == null) return null;
  const amount = Number(price);
  return Number.isFinite(amount) ? amount : null;
}

export function billedSpend(orders: readonly BilledOrder[], now: Date): BilledSpend {
  let month = 0;
  let year = 0;
  for (const order of orders) {
    const amount = billedAmount(order);
    if (amount == null) continue;
    const when = parseWhen(order.completed_at || order.created_at);
    if (!when || when.getFullYear() !== now.getFullYear()) continue;
    year += amount;
    if (when.getMonth() === now.getMonth()) month += amount;
  }
  return { month, year };
}

function parseWhen(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  // A bare date is a calendar day in local time, not UTC midnight.
  const when = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T00:00:00`) : new Date(iso);
  return Number.isNaN(when.getTime()) ? null : when;
}

export type BilledSpendText = {
  /** "$120 this month" */
  month: string;
  /** "$120" */
  monthAmount: string;
  /** "$120 this year" */
  year: string;
  /** "$120" */
  yearAmount: string;
  /** "$120 this month · $120 this year" */
  both: string;
  /** "Billed: $120 this month · $120 this year" */
  line: string;
};

export function billedSpendText(spend: BilledSpend, currency?: string): BilledSpendText {
  const monthAmount = formatMoney(spend.month, currency);
  const yearAmount = formatMoney(spend.year, currency);
  const month = `${monthAmount} this month`;
  const year = `${yearAmount} this year`;
  const both = `${month} · ${year}`;
  return { month, monthAmount, year, yearAmount, both, line: `${BILLED_LABEL}: ${both}` };
}

/** Start of the current year as an ISO instant, for loading this year's completed requests. */
export function billedYearStart(now: Date): string {
  return new Date(now.getFullYear(), 0, 1).toISOString();
}
