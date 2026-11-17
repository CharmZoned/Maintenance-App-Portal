import type { ChargeStatus, Payment, RentCharge } from "@/types";
import { toIsoDate } from "@/lib/utils";

/** Tenant payment method selection (processors mocked). */
export type TenantPayMethod = "zelle" | "card" | "ach";

export type LedgerKind = "charge" | "payment";

export type LedgerStatus =
  | "Paid"
  | "Overdue"
  | "Open"
  | "Partial"
  | "Waived"
  | "Applied"
  | "Failed"
  | "Processing";

export type LedgerFilter = "all" | "charges" | "payments" | "outstanding";

export interface TenantPaymentsProfile {
  tenant_id: number;
  tenant_name: string | null;
  unit_id: number | null;
  unit_label: string | null;
  property_id: number | null;
  property_name: string | null;
  street_address: string | null;
  /** Lease late-fee policy rate — not an assessed charge. */
  late_fee_policy: number | null;
}

export interface BalanceSummary {
  outstanding: number;
  pastDue: number;
  /**
   * Processor-pending amount. `null` = not tracked (no Stripe/ACH/Zelle state).
   * Never display a hard-coded `$0.00` as if nothing is in flight.
   */
  pending: number | null;
  nextDueDate: string | null;
  statusLine: string | null;
  statusTone: "destructive" | "warning" | "muted" | "success";
  asOf: string;
  /**
   * Remaining on the oldest open charge (component of outstanding).
   * Not the full lease rent / charge amount.
   */
  rentRemaining: number;
  /** Sum of remaining on other open charges (multi-month / extras). */
  otherRemaining: number;
  /**
   * Assessed late-fee amount owed. `null` = none assessed (omit row).
   * Policy rate lives on `lateFeePolicy` separately.
   */
  lateFeeAssessed: number | null;
  lateFeePolicy: number | null;
  /**
   * Unapplied overpayment credit (`amount_paid − amount` when positive).
   * `null` only when intentionally untracked; otherwise a real cents value (may be 0).
   */
  accountCredit: number;
}

export interface LedgerEntry {
  id: string;
  kind: LedgerKind;
  date: string;
  description: string;
  amount: number;
  /** Signed display amount: charges positive, payments/credits/waivers negative or zero. */
  signedAmount: number;
  status: LedgerStatus;
  balanceAfter: number;
  /** Remaining on the charge after postings (charges only); used by Outstanding filter. */
  remaining: number | null;
  chargeId: number | null;
  paymentId: number | null;
  method: string | null;
  reference: string | null;
  notes: string | null;
  period: string | null;
}

export interface DateRange {
  from: string | null;
  to: string | null;
  label: string;
}

/** Round to cents for money math / comparisons. */
export function roundCents(n: number): number {
  return Math.round(n * 100) / 100;
}

export function formatUsd(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

/** Figma-style "1 Nov 2026". */
export function formatPayDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** Local calendar YYYY-MM-DD for datetimes; passes through date-only strings. */
export function toLocalCalendarDate(iso: string | Date): string {
  if (typeof iso === "string" && iso.length <= 10) return iso;
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return toIsoDate(d);
}

export function chargeRemaining(c: RentCharge): number {
  if (c.status === "waived") return 0;
  return roundCents(Math.max(0, Number(c.amount) - Number(c.amount_paid)));
}

/** Unapplied overpayment on a charge (amount_paid may exceed amount). */
export function chargeOverpayment(c: RentCharge): number {
  if (c.status === "waived") return 0;
  return roundCents(Math.max(0, Number(c.amount_paid) - Number(c.amount)));
}

export function chargeStatusLabel(status: ChargeStatus): LedgerStatus {
  switch (status) {
    case "paid":
      return "Paid";
    case "overdue":
      return "Overdue";
    case "partial":
      return "Partial";
    case "waived":
      return "Waived";
    default:
      return "Open";
  }
}

export function paymentMethodLabel(method: string | null | undefined): string {
  switch (method) {
    case "ach":
      return "ACH";
    case "credit":
      return "Card";
    case "check":
      return "Check";
    case "cash":
      return "Cash";
    case "other":
      return "Other";
    default:
      return method?.trim() ? method : "Payment";
  }
}

export function payMethodLabel(method: TenantPayMethod): string {
  switch (method) {
    case "zelle":
      return "Zelle";
    case "card":
      return "Credit / debit card";
    case "ach":
      return "ACH bank transfer";
  }
}

export function placeContextLine(profile: TenantPaymentsProfile | null): string {
  if (!profile) return "Shared unit account";
  const parts = [
    profile.property_name,
    profile.street_address,
    profile.unit_label ? `Unit ${profile.unit_label.replace(/^Unit\s+/i, "")}` : null,
    profile.tenant_name,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Shared unit account";
}

export function ledgerPlaceLine(profile: TenantPaymentsProfile | null): string {
  if (!profile) return "Shared unit account";
  const parts = [
    profile.property_name,
    profile.street_address,
    profile.unit_label
      ? `Unit ${profile.unit_label.replace(/^Unit\s+/i, "")} · Shared unit account`
      : "Shared unit account",
  ].filter(Boolean);
  return parts.join(" · ");
}

function periodLabel(period: string | null | undefined): string {
  if (!period) return "Rent";
  return new Date(`${period}-01T00:00:00`).toLocaleDateString("en-US", { month: "long" });
}

/**
 * Parse a custom amount string: at most one decimal point, max 2 fraction digits,
 * round to cents, clamp to [0, max]. Returns null when empty / invalid / zero.
 */
export function parseCustomAmount(
  raw: string,
  max: number,
): { value: number | null; error: string | null; display: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { value: null, error: "Enter an amount.", display: "" };
  }
  if ((trimmed.match(/\./g) ?? []).length > 1) {
    return { value: null, error: "Use at most one decimal point.", display: trimmed };
  }
  if (!/^\d+(\.\d{0,2})?$/.test(trimmed)) {
    return {
      value: null,
      error: "Enter a valid dollar amount (cents only).",
      display: trimmed,
    };
  }
  const n = roundCents(Number.parseFloat(trimmed));
  if (!Number.isFinite(n) || n <= 0) {
    return { value: null, error: "Enter an amount greater than zero.", display: trimmed };
  }
  const cap = roundCents(Math.max(0, max));
  if (n > cap) {
    return {
      value: null,
      error: `Amount cannot exceed the outstanding balance (${formatUsd(cap)}).`,
      display: trimmed,
    };
  }
  return { value: n, error: null, display: trimmed };
}

export function buildBalanceSummary(
  charges: RentCharge[],
  profile: TenantPaymentsProfile | null,
  asOf = new Date(),
): BalanceSummary {
  const asOfIso = toIsoDate(asOf);
  let outstanding = 0;
  let pastDue = 0;
  let accountCredit = 0;

  const withRemaining = charges
    .map((c) => ({ c, rem: chargeRemaining(c), over: chargeOverpayment(c) }))
    .filter(({ c }) => c.status !== "waived");

  for (const { c, rem, over } of withRemaining) {
    outstanding = roundCents(outstanding + rem);
    accountCredit = roundCents(accountCredit + over);
    if (rem > 0 && (c.status === "overdue" || c.due_date < asOfIso)) {
      pastDue = roundCents(pastDue + rem);
    }
  }

  // Breakdown = components of outstanding only (remaining on open charges).
  const openOrdered = withRemaining
    .filter(({ rem }) => rem > 0)
    .sort((a, b) => (a.c.due_date < b.c.due_date ? -1 : 1));
  const rentRemaining = openOrdered[0]?.rem ?? 0;
  const otherRemaining = roundCents(
    openOrdered.slice(1).reduce((sum, row) => sum + row.rem, 0),
  );

  const nextOpen = openOrdered.find(({ c }) => c.due_date >= asOfIso)?.c ?? null;
  const oldestDue = openOrdered[0]?.c ?? null;

  let statusLine: string | null = null;
  let statusTone: BalanceSummary["statusTone"] = "muted";
  if (outstanding <= 0) {
    statusLine = accountCredit > 0 ? "Paid in full · credit on account" : "Paid in full";
    statusTone = "success";
  } else if (pastDue > 0 && oldestDue) {
    statusLine = `Overdue · due ${formatPayDate(oldestDue.due_date)}`;
    statusTone = "destructive";
  } else if (oldestDue) {
    statusLine = `Due ${formatPayDate(oldestDue.due_date)}`;
    statusTone = "warning";
  }

  return {
    outstanding,
    pastDue,
    // TODO(data-gap): pending processor payments are not tracked until Stripe/ACH/Zelle land.
    pending: null,
    nextDueDate: nextOpen?.due_date ?? null,
    statusLine,
    statusTone,
    asOf: asOfIso,
    rentRemaining,
    otherRemaining,
    // No assessed late-fee charge type yet — omit owed row; surface policy separately.
    lateFeeAssessed: null,
    lateFeePolicy: profile?.late_fee_policy != null ? Number(profile.late_fee_policy) : null,
    accountCredit,
  };
}

/**
 * Build chronological ledger rows from charges + payments, with running balance
 * (newest first for display — balanceAfter computed chronologically ascending).
 *
 * Ordering rules:
 * - Calendar dates (local) for payment timestamps — not UTC slice.
 * - Each charge posts before payments allocated to it (pay-before-due never goes negative).
 * - Waived charges post at signed amount 0 (no balance impact).
 */
export function buildLedgerEntries(
  charges: RentCharge[],
  paymentsByCharge: Map<number, Payment[]>,
): LedgerEntry[] {
  type Raw = {
    /** Primary chronological key (calendar date). */
    sortAt: string;
    /** Charge id grouping so a charge always precedes its payments. */
    chargeGroup: number;
    /** 0 = charge/waiver, 1+ = payment order. */
    withinCharge: number;
    entry: Omit<LedgerEntry, "balanceAfter">;
  };

  const raw: Raw[] = [];

  for (const c of charges) {
    const label = periodLabel(c.period);
    const waived = c.status === "waived";
    const rem = chargeRemaining(c);
    const chargeAmount = roundCents(Number(c.amount));

    raw.push({
      sortAt: c.due_date,
      chargeGroup: c.id,
      withinCharge: 0,
      entry: {
        id: `charge-${c.id}`,
        kind: "charge",
        date: c.due_date,
        description: `${label} rent`,
        amount: chargeAmount,
        // Waived: post 0 so Outstanding ($0) matches final ledger balance.
        signedAmount: waived ? 0 : chargeAmount,
        status: chargeStatusLabel(c.status),
        remaining: rem,
        chargeId: c.id,
        paymentId: null,
        method: null,
        reference: null,
        notes: c.notes,
        period: c.period,
      },
    });

    const payments = [...(paymentsByCharge.get(c.id) ?? [])].sort((a, b) =>
      a.paid_at < b.paid_at ? -1 : 1,
    );
    let payIdx = 1;
    for (const p of payments) {
      const method = paymentMethodLabel(p.method);
      const paidDate = toLocalCalendarDate(p.paid_at);
      // Never sort a payment before its charge: use max(paidDate, due_date) for order.
      const sortAt = paidDate < c.due_date ? c.due_date : paidDate;
      raw.push({
        sortAt,
        chargeGroup: c.id,
        withinCharge: payIdx++,
        entry: {
          id: `payment-${p.id}`,
          kind: "payment",
          date: paidDate,
          description: `${method} payment${c.period ? ` · ${label}` : ""}`,
          amount: roundCents(Number(p.amount)),
          signedAmount: -roundCents(Number(p.amount)),
          status: "Paid",
          remaining: null,
          chargeId: c.id,
          paymentId: p.id,
          method: p.method,
          reference: p.reference,
          notes: p.notes,
          period: c.period,
        },
      });
    }
  }

  raw.sort((a, b) => {
    if (a.sortAt !== b.sortAt) return a.sortAt < b.sortAt ? -1 : 1;
    if (a.chargeGroup !== b.chargeGroup) return a.chargeGroup - b.chargeGroup;
    if (a.withinCharge !== b.withinCharge) return a.withinCharge - b.withinCharge;
    return 0;
  });

  let running = 0;
  const withBalance: LedgerEntry[] = raw.map(({ entry }) => {
    running = roundCents(running + entry.signedAmount);
    return { ...entry, balanceAfter: running };
  });

  return withBalance.reverse();
}

export function filterLedgerEntries(
  entries: LedgerEntry[],
  filter: LedgerFilter,
  range: DateRange | null,
): LedgerEntry[] {
  return entries.filter((e) => {
    if (filter === "charges" && e.kind !== "charge") return false;
    if (filter === "payments" && e.kind !== "payment") return false;
    if (filter === "outstanding") {
      // Match summary: remaining balance, not status label.
      if (e.kind !== "charge") return false;
      if (e.remaining == null || e.remaining <= 0) return false;
    }
    if (range?.from && e.date < range.from) return false;
    if (range?.to && e.date > range.to) return false;
    return true;
  });
}

export function ledgerStatusTone(status: LedgerStatus): string {
  switch (status) {
    case "Paid":
    case "Applied":
    case "Waived":
      return "bg-success-tint text-success";
    case "Overdue":
    case "Failed":
      return "bg-destructive-tint text-destructive";
    case "Processing":
    case "Partial":
    case "Open":
      return "bg-warning-tint text-warning";
    default:
      return "bg-muted text-muted-foreground";
  }
}

export function demoPaymentReference(profile: TenantPaymentsProfile | null): string {
  const unit = (profile?.unit_label ?? "UNIT").replace(/\s+/g, "").toUpperCase();
  const prop = (profile?.property_name ?? "PROP")
    .split(/\s+/)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase()
    .slice(0, 4);
  const period = new Date()
    .toLocaleDateString("en-US", { month: "short", year: "2-digit" })
    .replace(" ", "");
  return `${prop || "LG"}-${unit}-${period}-DEMO`.toUpperCase();
}
