import { cn } from "@/lib/utils";
import {
  formatPayDate,
  formatUsd,
  type BalanceSummary,
} from "./payments-model";

export function BalanceSummaryCard({
  summary,
  layout = "desktop",
  className,
}: {
  summary: BalanceSummary;
  layout?: "desktop" | "stack";
  className?: string;
}) {
  const toneClass =
    summary.statusTone === "destructive"
      ? "text-destructive"
      : summary.statusTone === "warning"
        ? "text-warning"
        : summary.statusTone === "success"
          ? "text-success"
          : "text-muted-foreground";

  return (
    <section
      className={cn(
        "rounded-lg border border-border bg-card p-5",
        className,
      )}
      aria-label="Outstanding balance"
    >
      <div
        className={cn(
          layout === "desktop"
            ? "grid gap-6 md:grid-cols-[minmax(0,1.2fr)_repeat(3,minmax(0,1fr))]"
            : "space-y-4",
        )}
      >
        <div>
          <p className="text-sm text-muted-foreground">Outstanding balance</p>
          <p className="mt-1 text-[2.125rem] font-semibold leading-[2.625rem] tracking-[-0.02em] tabular-nums text-foreground">
            {formatUsd(summary.outstanding)}
          </p>
          {summary.statusLine ? (
            <p className={cn("mt-2 text-sm font-medium", toneClass)}>{summary.statusLine}</p>
          ) : null}
        </div>
        <Stat label="Past due" value={formatUsd(summary.pastDue)} />
        <Stat label="Pending payments" value={formatUsd(summary.pending)} />
        <Stat
          label="Next rent due"
          value={summary.nextDueDate ? formatPayDate(summary.nextDueDate) : "—"}
        />
      </div>
      <p className="mt-4 text-xs text-muted-foreground">
        As of {formatPayDate(summary.asOf)} · USD
      </p>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-2 text-lg font-semibold leading-7 tabular-nums text-foreground">{value}</p>
    </div>
  );
}
