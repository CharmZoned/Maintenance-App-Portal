import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/patterns";
import { BalanceSummaryCard } from "./balance-summary-card";
import { PaymentStatusBadge } from "./payment-status-badge";
import { DateRangeFilterDialog, buildQuickRanges } from "./overlays/date-range-filter";
import {
  filterLedgerEntries,
  formatPayDate,
  formatUsd,
  paymentMethodLabel,
  type BalanceSummary,
  type DateRange,
  type LedgerEntry,
  type LedgerFilter,
} from "./payments-model";

const FILTERS: { id: LedgerFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "charges", label: "Charges" },
  { id: "payments", label: "Payments" },
  { id: "outstanding", label: "Outstanding" },
];

export function PaymentLedgerView({
  summary,
  ledger,
}: {
  summary: BalanceSummary;
  ledger: LedgerEntry[];
}) {
  const [filter, setFilter] = useState<LedgerFilter>("all");
  const [range, setRange] = useState<DateRange>(() => buildQuickRanges().all);
  const [filterOpen, setFilterOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = useMemo(
    () => filterLedgerEntries(ledger, filter, range),
    [ledger, filter, range],
  );

  const rangeLabel =
    range.from || range.to
      ? `${range.label}${range.from && range.to ? ` · ${formatPayDate(range.from)}–${formatPayDate(range.to)}` : ""}`
      : "Choose a date range";

  return (
    <div className="space-y-6">
      <BalanceSummaryCard summary={summary} />

      <section className="rounded-lg border border-border bg-card p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold leading-7 text-foreground">All transactions</h2>
            <p className="mt-1 text-sm text-muted-foreground">Newest first · {rangeLabel}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {/* TODO(data-gap): export / receipt services disconnected. */}
            <Button
              type="button"
              variant="outline"
              className="hidden h-11 min-h-11 px-3 md:inline-flex"
              onClick={() => setFilterOpen(true)}
            >
              Date range
            </Button>
            <Button
              type="button"
              disabled
              className="h-11 min-h-11 bg-muted px-3 text-muted-foreground shadow-none"
            >
              Export · unavailable
            </Button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <Button
              key={f.id}
              type="button"
              variant="outline"
              className={cn(
                "h-11 min-h-11 px-3",
                filter === f.id && "bg-brand-tint text-brand-text shadow-none",
              )}
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </Button>
          ))}
          <Button
            type="button"
            variant="outline"
            className="h-11 min-h-11 px-3 md:hidden"
            onClick={() => setFilterOpen(true)}
          >
            Date range
          </Button>
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            className="mt-6"
            message={
              ledger.length === 0
                ? "No charges or payments yet for this unit."
                : "No transactions match this filter."
            }
            filtered={ledger.length > 0}
            onClear={() => {
              setFilter("all");
              setRange(buildQuickRanges().all);
            }}
            clearLabel="Clear filters"
          />
        ) : (
          <>
            {/* Desktop table */}
            <div className="mt-5 hidden overflow-x-auto md:block">
              <table className="w-full min-w-[720px] border-collapse text-sm">
                <thead>
                  <tr className="bg-muted text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <th className="rounded-l-sm px-3 py-3">Date</th>
                    <th className="px-3 py-3">Description</th>
                    <th className="px-3 py-3 text-right">Amount</th>
                    <th className="px-3 py-3">Status</th>
                    <th className="px-3 py-3 text-right">Balance</th>
                    <th className="rounded-r-sm px-3 py-3 text-right">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((entry) => (
                    <LedgerTableRows
                      key={entry.id}
                      entry={entry}
                      expanded={expandedId === entry.id}
                      onToggle={() =>
                        setExpandedId((id) => (id === entry.id ? null : entry.id))
                      }
                    />
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <ul className="mt-5 space-y-3 md:hidden">
              {filtered.map((entry) => (
                <li key={entry.id}>
                  <LedgerMobileCard
                    entry={entry}
                    expanded={expandedId === entry.id}
                    onToggle={() =>
                      setExpandedId((id) => (id === entry.id ? null : entry.id))
                    }
                  />
                </li>
              ))}
            </ul>
          </>
        )}

        <p className="mt-5 text-xs text-muted-foreground">
          Balance = account balance after posting. Charge status reflects current verified
          allocations.
        </p>
      </section>

      <footer className="space-y-1 text-sm text-muted-foreground">
        <p>
          Shared ledger, private payment details. Only active, authorized unit members can access
          this account.
        </p>
        <p className="text-xs">
          Live ledger from RentCharges / Payments · Receipt and export services are disconnected.
        </p>
      </footer>

      <DateRangeFilterDialog
        open={filterOpen}
        onOpenChange={setFilterOpen}
        value={range}
        onApply={setRange}
      />
    </div>
  );
}

function amountLabel(entry: LedgerEntry): string {
  const abs = formatUsd(Math.abs(entry.signedAmount));
  if (entry.signedAmount > 0) return `+${abs}`;
  if (entry.signedAmount < 0) return `−${abs}`;
  return abs;
}

function LedgerTableRows({
  entry,
  expanded,
  onToggle,
}: {
  entry: LedgerEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr className="border-b border-border">
        <td className="px-3 py-4 whitespace-nowrap text-muted-foreground">
          {formatPayDate(entry.date)}
        </td>
        <td className="px-3 py-4 font-medium text-foreground">{entry.description}</td>
        <td className="px-3 py-4 text-right tabular-nums text-foreground">{amountLabel(entry)}</td>
        <td className="px-3 py-4">
          <PaymentStatusBadge status={entry.status} />
        </td>
        <td className="px-3 py-4 text-right tabular-nums text-foreground">
          {formatUsd(entry.balanceAfter)}
        </td>
        <td className="px-3 py-4 text-right">
          <Button
            type="button"
            variant="outline"
            className="h-11 min-h-11 px-3"
            aria-expanded={expanded}
            onClick={onToggle}
          >
            Details
          </Button>
        </td>
      </tr>
      {expanded ? (
        <tr className="border-b border-border">
          <td colSpan={6} className="px-3 pb-4">
            <LedgerDetailsPanel entry={entry} onClose={onToggle} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function LedgerMobileCard({
  entry,
  expanded,
  onToggle,
}: {
  entry: LedgerEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="rounded-sm border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-muted-foreground">{formatPayDate(entry.date)}</p>
        <PaymentStatusBadge status={entry.status} />
      </div>
      <div className="mt-2 flex items-start justify-between gap-3">
        <p className="font-medium text-foreground">{entry.description}</p>
        <Button
          type="button"
          variant="outline"
          className="h-11 min-h-11 shrink-0 px-3"
          aria-expanded={expanded}
          onClick={onToggle}
        >
          Details
        </Button>
      </div>
      <div className="mt-3 flex items-end justify-between gap-3">
        <p className="text-lg font-semibold tabular-nums text-foreground">{amountLabel(entry)}</p>
        <p className="text-sm text-muted-foreground">Balance {formatUsd(entry.balanceAfter)}</p>
      </div>
      {expanded ? (
        <div className="mt-3">
          <LedgerDetailsPanel entry={entry} onClose={onToggle} />
        </div>
      ) : null}
    </div>
  );
}

function LedgerDetailsPanel({
  entry,
  onClose,
}: {
  entry: LedgerEntry;
  onClose: () => void;
}) {
  const method = paymentMethodLabel(entry.method);
  return (
    <div className="rounded-sm bg-brand-tint px-4 py-4 text-sm text-brand-text">
      <p className="font-semibold">
        {entry.description} · transaction details
      </p>
      <p className="mt-2 text-muted-foreground">
        Posted {formatPayDate(entry.date)}
        {entry.reference ? ` · ref ${entry.reference}` : ""}
      </p>
      {entry.notes ? <p className="mt-1 text-muted-foreground">{entry.notes}</p> : null}
      <p className="mt-2 text-muted-foreground">
        {entry.kind === "payment"
          ? `${method} ${formatUsd(entry.amount)} · Fees $0.00 · Applied ${formatUsd(entry.amount)} · Balance after ${formatUsd(entry.balanceAfter)}`
          : `Charge ${formatUsd(entry.amount)} · Status ${entry.status} · Balance after ${formatUsd(entry.balanceAfter)}`}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {/* TODO(data-gap): receipt PDF / storage not available for tenants. */}
        <Button
          type="button"
          disabled
          className="h-11 min-h-11 bg-warning-tint px-3 text-warning shadow-none"
        >
          Receipt · unavailable
        </Button>
        <Button type="button" variant="outline" className="h-11 min-h-11 bg-card px-3" onClick={onClose}>
          Close details
        </Button>
      </div>
    </div>
  );
}
