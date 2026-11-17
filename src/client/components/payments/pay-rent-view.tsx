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
  parseCustomAmount,
  payMethodLabel,
  type BalanceSummary,
  type TenantPayMethod,
  type TenantPaymentsProfile,
} from "./payments-model";

const METHOD_PREVIEW = "Not connected — no debit will be sent.";

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

  const customParsed = useMemo(
    () => parseCustomAmount(customAmount, summary.outstanding),
    [customAmount, summary.outstanding],
  );

  const selectedAmount = useMemo(() => {
    if (amountMode === "full") return summary.outstanding;
    return customParsed.value ?? 0;
  }, [amountMode, customParsed.value, summary.outstanding]);

  const customError =
    amountMode === "custom" ? customParsed.error : null;

  const initiationDate = summary.asOf;
  const fee = 0;
  const total = selectedAmount + fee;
  const paymentReference = demoPaymentReference(profile);
  const homeLabel =
    [profile?.property_name, profile?.unit_label].filter(Boolean).join(" · ") || "—";

  function onCustomChange(raw: string) {
    setAmountMode("custom");
    // Reject a second decimal point while typing.
    if ((raw.match(/\./g) ?? []).length > 1) return;
    // Allow intermediate "12." while typing; strip illegal chars.
    const cleaned = raw.replace(/[^\d.]/g, "");
    const parts = cleaned.split(".");
    const next =
      parts.length <= 1
        ? cleaned
        : `${parts[0]}.${parts.slice(1).join("").slice(0, 2)}`;
    setCustomAmount(next);
  }

  return (
    <div className="space-y-6">
      <BalanceSummaryCard summary={summary} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <section className="rounded-lg border border-border bg-card p-5">
            <h2 className="text-lg font-semibold leading-7 text-foreground">1. Choose an amount</h2>
            <div role="radiogroup" aria-label="Payment amount" className="mt-4 space-y-3">
              <button
                type="button"
                role="radio"
                aria-checked={amountMode === "full"}
                aria-pressed={amountMode === "full"}
                onClick={() => setAmountMode("full")}
                className={cn(
                  "flex min-h-14 w-full items-center justify-between rounded-sm px-4 py-3 text-left text-sm font-medium",
                  amountMode === "full"
                    ? "bg-brand-tint text-brand-text"
                    : "bg-muted text-brand-text",
                )}
              >
                <span>
                  {amountMode === "full" ? "Selected · full outstanding balance" : "Full outstanding balance"}
                </span>
                <span className="tabular-nums">{formatUsd(summary.outstanding)}</span>
              </button>

              <div
                className={cn(
                  "rounded-sm px-4 py-3",
                  amountMode === "custom" ? "bg-brand-tint" : "bg-muted",
                )}
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={amountMode === "custom"}
                  aria-pressed={amountMode === "custom"}
                  className="text-left text-sm font-medium text-foreground"
                  onClick={() => setAmountMode("custom")}
                >
                  {amountMode === "custom" ? "Selected · custom amount" : "Custom amount"}
                </button>
                <div className="relative mt-2 w-full sm:max-w-[300px]">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                    $
                  </span>
                  <Input
                    className="h-11 pl-7"
                    inputMode="decimal"
                    placeholder="Enter amount"
                    value={customAmount}
                    onFocus={() => setAmountMode("custom")}
                    onChange={(e) => onCustomChange(e.target.value)}
                    aria-label="Custom payment amount"
                    aria-invalid={customError != null}
                    aria-describedby={customError ? "custom-amount-error" : undefined}
                  />
                </div>
                {customError ? (
                  <p id="custom-amount-error" className="mt-2 text-xs text-destructive" role="alert">
                    {customError}
                  </p>
                ) : null}
              </div>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Partial payments allowed in this test policy.
            </p>

            <dl className="mt-5 space-y-2 text-sm">
              <BreakdownRow label="Rent remaining" value={formatUsd(summary.rentRemaining)} />
              {summary.otherRemaining > 0 ? (
                <BreakdownRow label="Other open charges" value={formatUsd(summary.otherRemaining)} />
              ) : null}
              {summary.lateFeeAssessed != null && summary.lateFeeAssessed > 0 ? (
                <BreakdownRow label="Late fee" value={formatUsd(summary.lateFeeAssessed)} />
              ) : null}
              {summary.accountCredit > 0 ? (
                <BreakdownRow
                  label="Account credit"
                  value={`−${formatUsd(summary.accountCredit)}`}
                  tone="success"
                />
              ) : (
                <BreakdownRow label="Account credit" value="—" tone="success" />
              )}
            </dl>
            {summary.lateFeePolicy != null && summary.lateFeePolicy > 0 && summary.lateFeeAssessed == null ? (
              <p className="mt-3 text-xs text-muted-foreground">
                Late fee policy {formatUsd(summary.lateFeePolicy)} · not assessed on this balance.
              </p>
            ) : null}
            <p className="mt-2 text-xs text-muted-foreground">
              Breakdown sums to outstanding {formatUsd(summary.outstanding)}.
            </p>
          </section>

          <section className="rounded-lg border border-border bg-card p-5">
            <h2 className="text-lg font-semibold leading-7 text-foreground">
              2. Choose a payment method
            </h2>
            <div
              role="radiogroup"
              aria-label="Payment method"
              className="mt-4 space-y-3"
            >
              <MethodRow
                title="Zelle"
                description={
                  method === "zelle" ? `Selected · ${METHOD_PREVIEW}` : METHOD_PREVIEW
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
                  method === "card" ? `Selected · ${METHOD_PREVIEW}` : METHOD_PREVIEW
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
                  method === "ach" ? `Selected · ${METHOD_PREVIEW}` : METHOD_PREVIEW
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
            <p className="font-medium text-foreground">Payment preview</p>
            <p className="mt-2 text-muted-foreground">
              {/* TODO(data-gap): processors not connected. */}
              {METHOD_PREVIEW}
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
          <p className="mt-4 text-sm text-muted-foreground">{METHOD_PREVIEW}</p>
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
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        aria-pressed={selected}
        className="min-w-0 flex-1 text-left"
        onClick={onSelect}
      >
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
