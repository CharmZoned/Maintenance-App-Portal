import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { BalanceSummaryCard } from "./balance-summary-card";
import { AchOverlay } from "./overlays/ach-overlay";
import { StripeCardOverlay } from "./overlays/stripe-card-overlay";
import { ZelleOverlay } from "./overlays/zelle-overlay";
import {
  demoPaymentReference,
  formatPayDate,
  formatUsd,
  payMethodLabel,
  type BalanceSummary,
  type TenantPayMethod,
  type TenantPaymentsProfile,
} from "./payments-model";

export function PayRentView({
  profile,
  summary,
  onViewLedger,
}: {
  profile: TenantPaymentsProfile | null;
  summary: BalanceSummary;
  onViewLedger: () => void;
}) {
  const [amountMode, setAmountMode] = useState<"full" | "custom">("full");
  const [customAmount, setCustomAmount] = useState("");
  const [method, setMethod] = useState<TenantPayMethod>("ach");
  const [overlay, setOverlay] = useState<TenantPayMethod | null>(null);

  const selectedAmount = useMemo(() => {
    if (amountMode === "full") return summary.outstanding;
    const n = Number.parseFloat(customAmount.replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) ? Math.max(0, n) : 0;
  }, [amountMode, customAmount, summary.outstanding]);

  const initiationDate = summary.asOf;
  const fee = 0;
  const total = selectedAmount + fee;
  const paymentReference = demoPaymentReference(profile);
  const homeLabel = [profile?.property_name, profile?.unit_label]
    .filter(Boolean)
    .join(" · ") || "—";

  return (
    <div className="space-y-6">
      <BalanceSummaryCard summary={summary} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <section className="rounded-lg border border-border bg-card p-5">
            <h2 className="text-lg font-semibold leading-7 text-foreground">1. Choose an amount</h2>
            <button
              type="button"
              onClick={() => setAmountMode("full")}
              className={cn(
                "mt-4 flex min-h-14 w-full items-center justify-between rounded-sm px-4 py-3 text-left text-sm font-medium",
                amountMode === "full"
                  ? "bg-brand-tint text-brand-text"
                  : "bg-muted text-brand-text",
              )}
            >
              <span>Full outstanding balance</span>
              <span className="tabular-nums">{formatUsd(summary.outstanding)}</span>
            </button>

            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <button
                type="button"
                className="text-left text-sm font-medium text-foreground"
                onClick={() => setAmountMode("custom")}
              >
                Custom amount
              </button>
              <div className="relative w-full sm:max-w-[300px]">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  $
                </span>
                <Input
                  className="h-11 pl-7"
                  inputMode="decimal"
                  placeholder="Enter amount"
                  value={customAmount}
                  onFocus={() => setAmountMode("custom")}
                  onChange={(e) => {
                    setAmountMode("custom");
                    setCustomAmount(e.target.value);
                  }}
                  aria-label="Custom payment amount"
                />
              </div>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Partial payments allowed in this test policy.
            </p>

            <dl className="mt-5 space-y-2 text-sm">
              <BreakdownRow label="Monthly rent" value={formatUsd(summary.monthlyRent)} />
              <BreakdownRow label="Late fee" value={formatUsd(summary.lateFee)} />
              <BreakdownRow label="Other charges" value={formatUsd(summary.otherCharges)} />
              <BreakdownRow
                label="Account credit"
                value={summary.accountCredit ? `−${formatUsd(Math.abs(summary.accountCredit))}` : formatUsd(0)}
                tone="success"
              />
            </dl>
          </section>

          <section className="rounded-lg border border-border bg-card p-5">
            <h2 className="text-lg font-semibold leading-7 text-foreground">
              2. Choose a payment method
            </h2>
            <div className="mt-4 space-y-3">
              <MethodRow
                title="Zelle"
                description={
                  method === "zelle"
                    ? "Selected · pay in your banking app; verify receipt separately."
                    : "Pay in your banking app; verify receipt separately."
                }
                selected={method === "zelle"}
                onSelect={() => setMethod("zelle")}
                detailsLabel="Zelle instructions"
                onDetails={() => {
                  setMethod("zelle");
                  setOverlay("zelle");
                }}
              />
              <MethodRow
                title="Credit / debit card"
                description={
                  method === "card"
                    ? "Selected · Stripe secure checkout; no card details stored here."
                    : "Stripe secure checkout; no card details stored here."
                }
                selected={method === "card"}
                onSelect={() => setMethod("card")}
                detailsLabel="Card details"
                onDetails={() => {
                  setMethod("card");
                  setOverlay("card");
                }}
              />
              <MethodRow
                title="ACH bank transfer"
                description={
                  method === "ach"
                    ? "Selected · Stripe ACH Direct Debit"
                    : "Stripe ACH Direct Debit"
                }
                selected={method === "ach"}
                onSelect={() => setMethod("ach")}
                detailsLabel="ACH details"
                onDetails={() => {
                  setMethod("ach");
                  setOverlay("ach");
                }}
              />
            </div>
          </section>
        </div>

        <section className="rounded-lg border border-border bg-card p-5 lg:self-start">
          <h2 className="text-lg font-semibold leading-7 text-foreground">3. Review your payment</h2>
          <dl className="mt-5 space-y-3 text-sm">
            <ReviewRow label="Home" value={homeLabel} />
            <ReviewRow label="Payment method" value={payMethodLabel(method)} />
            <ReviewRow label="Amount selected" value={formatUsd(selectedAmount)} />
            <ReviewRow label="Processing fee" value={formatUsd(fee)} />
          </dl>
          <div className="my-5 h-px bg-border" />
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-lg font-semibold text-foreground">Total to debit</p>
            <p className="text-2xl font-semibold tabular-nums text-foreground">{formatUsd(total)}</p>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Initiation date · {formatPayDate(initiationDate)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Property covers fees · test policy</p>

          <div className="mt-5 rounded-sm bg-muted px-4 py-4 text-sm">
            <p className="font-medium text-foreground">
              {method === "zelle"
                ? "External bank transfer"
                : method === "card"
                  ? "Secure card checkout"
                  : "Secure bank connection"}
            </p>
            <p className="mt-2 text-muted-foreground">
              {method === "zelle"
                ? // TODO(data-gap): Zelle recipient verification + mark-as-sent.
                  "Zelle is not connected. Do not send funds using the example recipient."
                : method === "card"
                  ? // TODO(data-gap): Stripe Checkout.
                    "Stripe card checkout is not connected. Card details never enter this portal."
                  : // TODO(data-gap): Stripe ACH / Financial Connections.
                    "Stripe ACH is not connected. Bank details never enter this portal directly."}
            </p>
          </div>

          {/* TODO(data-gap): Never call admin record_payment as tenant self-serve. */}
          <Button
            type="button"
            disabled
            className="mt-5 h-11 min-h-11 w-full bg-muted text-muted-foreground shadow-none"
          >
            Authorize & pay · unavailable
          </Button>
          <p className="mt-4 text-sm text-muted-foreground">
            {method === "ach"
              ? "A one-time debit mandate will be collected securely by Stripe. No bank connection or transfer is possible in this design."
              : method === "card"
                ? "Card numbers and CVVs remain with Stripe. Only authenticated payment events can confirm success."
                : "Marking a Zelle payment sent would create Awaiting Verification until independently confirmed."}
          </p>
          <Button
            type="button"
            variant="outline"
            className="mt-5 h-11 min-h-11 w-full"
            onClick={onViewLedger}
          >
            View ledger
          </Button>
        </section>
      </div>

      <footer className="space-y-1 text-sm text-muted-foreground">
        <p>Shared unit balance. Saved payment methods and personal bank details stay private.</p>
        <p className="text-xs">
          Illustrative USD account · All payment services are disconnected · No funds are sent
        </p>
      </footer>

      <ZelleOverlay
        open={overlay === "zelle"}
        onOpenChange={(o) => !o && setOverlay(null)}
        amount={selectedAmount}
        profile={profile}
        paymentReference={paymentReference}
      />
      <StripeCardOverlay
        open={overlay === "card"}
        onOpenChange={(o) => !o && setOverlay(null)}
        amount={selectedAmount}
        initiationDate={initiationDate}
      />
      <AchOverlay
        open={overlay === "ach"}
        onOpenChange={(o) => !o && setOverlay(null)}
        amount={selectedAmount}
        initiationDate={initiationDate}
        profile={profile}
      />
    </div>
  );
}

function BreakdownRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "success";
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className={tone === "success" ? "text-success" : "text-muted-foreground"}>{label}</dt>
      <dd
        className={cn(
          "font-medium tabular-nums",
          tone === "success" ? "text-success" : "text-foreground",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium text-foreground">{value}</dd>
    </div>
  );
}

function MethodRow({
  title,
  description,
  selected,
  onSelect,
  detailsLabel,
  onDetails,
}: {
  title: string;
  description: string;
  selected: boolean;
  onSelect: () => void;
  detailsLabel: string;
  onDetails: () => void;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-sm p-4 sm:flex-row sm:items-center sm:justify-between",
        selected ? "bg-brand-tint" : "bg-muted",
      )}
    >
      <button type="button" className="min-w-0 flex-1 text-left" onClick={onSelect}>
        <p className="text-sm font-medium text-brand-text">{title}</p>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </button>
      <Button
        type="button"
        variant="outline"
        className="h-11 min-h-11 shrink-0 bg-card px-3"
        onClick={onDetails}
      >
        {detailsLabel}
      </Button>
    </div>
  );
}
