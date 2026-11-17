import type { ChargeStatus, Payment, RentCharge } from "@/types";

/** Tenant payment method selection (processors mocked). */
export type TenantPayMethod = "zelle" | "card" | "ach";

export type LedgerKind = "charge" | "payment" | "credit";

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
  late_fee: number | null;
}

export interface BalanceSummary {
  outstanding: number;
  pastDue: number;
  pending: number;
  nextDueDate: string | null;
  statusLine: string | null;
  statusTone: "destructive" | "warning" | "muted" | "success";
  asOf: string;
  /** Breakdown for pay-rent step 1 (best-effort from live charges). */
  monthlyRent: number;
  lateFee: number;
  otherCharges: number;
  accountCredit: number;
}

export interface LedgerEntry {
  id: string;
  kind: LedgerKind;
  date: string;
  description: string;
  amount: number;
  /** Signed display amount: charges positive, payments/credits negative. */
  signedAmount: number;
  status: LedgerStatus;
  balanceAfter: number;
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

export function chargeRemaining(c: RentCharge): number {
  return Math.max(0, Number(c.amount) - Number(c.amount_paid));
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

export function buildBalanceSummary(
  charges: RentCharge[],
  profile: TenantPaymentsProfile | null,
  asOf = new Date(),
): BalanceSummary {
  const asOfIso = asOf.toISOString().slice(0, 10);
  let outstanding = 0;
  let pastDue = 0;
  let monthlyRent = 0;
  let otherCharges = 0;

  const openLike = charges.filter((c) => c.status !== "waived");
  for (const c of openLike) {
    const rem = chargeRemaining(c);
    if (rem <= 0 && c.status === "paid") continue;
    if (rem > 0) {
      outstanding += rem;
      if (c.status === "overdue" || c.due_date < asOfIso) pastDue += rem;
    }
  }

  // Prefer current-period open/overdue charge as "monthly rent"; fall back to latest charge amount.
  const sorted = [...charges].sort((a, b) => (a.due_date < b.due_date ? 1 : -1));
  const primary =
    sorted.find((c) => c.status === "overdue" || c.status === "open" || c.status === "partial") ??
    sorted[0];
  if (primary) {
    monthlyRent = Number(primary.lease_rent ?? primary.amount) || Number(primary.amount) || 0;
  }

  // Anything beyond one monthly rent line on outstanding open charges → other.
  const openRem = openLike.reduce((sum, c) => sum + chargeRemaining(c), 0);
  if (openRem > monthlyRent && monthlyRent > 0) {
    otherCharges = Math.max(0, openRem - monthlyRent);
  }

  const lateFee = Number(profile?.late_fee ?? 0) || 0;
  // Credits are not a first-class ledger type — surface 0 unless notes imply overpayment.
  const accountCredit = 0;

  const nextOpen = [...charges]
    .filter((c) => chargeRemaining(c) > 0 && c.due_date >= asOfIso)
    .sort((a, b) => (a.due_date < b.due_date ? -1 : 1))[0];
  const oldestDue = [...charges]
    .filter((c) => chargeRemaining(c) > 0)
    .sort((a, b) => (a.due_date < b.due_date ? -1 : 1))[0];

  let statusLine: string | null = null;
  let statusTone: BalanceSummary["statusTone"] = "muted";
  if (outstanding <= 0) {
    statusLine = "Paid in full";
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
    pending: 0,
    nextDueDate: nextOpen?.due_date ?? null,
    statusLine,
    statusTone,
    asOf: asOfIso,
    monthlyRent,
    lateFee,
    otherCharges,
    accountCredit,
  };
}

/**
 * Build chronological ledger rows from charges + payments, with running balance
 * (newest first for display — balanceAfter computed chronologically ascending).
 */
export function buildLedgerEntries(
  charges: RentCharge[],
  paymentsByCharge: Map<number, Payment[]>,
): LedgerEntry[] {
  type Raw = {
    sortAt: string;
    tie: number;
    entry: Omit<LedgerEntry, "balanceAfter">;
  };

  const raw: Raw[] = [];
  let tie = 0;

  for (const c of charges) {
    const periodLabel = c.period
      ? new Date(`${c.period}-01T00:00:00`).toLocaleDateString("en-US", {
          month: "long",
        })
      : "Rent";
    raw.push({
      sortAt: c.due_date,
      tie: tie++,
      entry: {
        id: `charge-${c.id}`,
        kind: "charge",
        date: c.due_date,
        description: `${periodLabel} rent`,
        amount: Number(c.amount),
        signedAmount: Number(c.amount),
        status: chargeStatusLabel(c.status),
        chargeId: c.id,
        paymentId: null,
        method: null,
        reference: null,
        notes: c.notes,
        period: c.period,
      },
    });

    const payments = paymentsByCharge.get(c.id) ?? [];
    for (const p of payments) {
      const method = paymentMethodLabel(p.method);
      raw.push({
        sortAt: p.paid_at,
        tie: tie++,
        entry: {
          id: `payment-${p.id}`,
          kind: "payment",
          date: p.paid_at.slice(0, 10),
          description: `${method} payment${c.period ? ` · ${periodLabel}` : ""}`,
          amount: Number(p.amount),
          signedAmount: -Number(p.amount),
          status: "Paid",
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
    if (a.sortAt === b.sortAt) return a.tie - b.tie;
    return a.sortAt < b.sortAt ? -1 : 1;
  });

  let running = 0;
  const withBalance: LedgerEntry[] = raw.map(({ entry }) => {
    running += entry.signedAmount;
    return { ...entry, balanceAfter: running };
  });

  // Newest first for UI.
  return withBalance.reverse();
}

export function filterLedgerEntries(
  entries: LedgerEntry[],
  filter: LedgerFilter,
  range: DateRange | null,
): LedgerEntry[] {
  return entries.filter((e) => {
    if (filter === "charges" && e.kind !== "charge") return false;
    if (filter === "payments" && e.kind !== "payment" && e.kind !== "credit") return false;
    if (filter === "outstanding") {
      if (e.kind === "charge") {
        if (e.status === "Paid" || e.status === "Waived") return false;
      } else {
        return false;
      }
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
  const period = new Date().toLocaleDateString("en-US", { month: "short", year: "2-digit" }).replace(
    " ",
    "",
  );
  return `${prop || "LG"}-${unit}-${period}-DEMO`.toUpperCase();
}
