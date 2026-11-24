import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { formatDayShort, relativeDayLabel, toDay } from "@/lib/admin-dates";
import { cn, formatMoney, formatPeriod } from "@/lib/utils";
import {
  confirmZellePayment,
  listReportedZellePayments,
  type ReportedZellePayment,
} from "@/lib/zelle-payments";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ErrorRetry } from "@/components/patterns/error-retry";

/**
 * What a deep link asked for: one reported payment (`/rent?verify=<intentId>`)
 * or everything waiting in one period (`/rent?period=YYYY-MM`).
 */
export interface VerificationFocus {
  intentId: number | null;
  period: string | null;
}

/** Whole amounts read "$725"; anything else keeps its cents — never rounded. */
function exactMoney(amount: number, currency: string): string {
  if (Number.isInteger(amount)) return formatMoney(amount, currency);
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/** "Unit 1A" — unless the label already says "Unit". */
function unitWord(label: string): string {
  return /^unit\b/i.test(label.trim()) ? label.trim() : `Unit ${label.trim()}`;
}

/** "Maple Court · Unit 1B" */
function placeOf(payment: ReportedZellePayment): string | null {
  const charge = payment.charge;
  const parts = [charge?.property_name?.trim(), charge?.unit_name ? unitWord(charge.unit_name) : null].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** "November 2026 rent" */
function rentOf(payment: ReportedZellePayment): string | null {
  const period = payment.charge?.period;
  return period && /^\d{4}-\d{2}$/.test(period) ? `${formatPeriod(period)} rent` : null;
}

/** ["3 days ago", "Sat 21 Nov 2026"] for the moment the tenant reported it. */
function reportedParts(iso: string): { relative: string; absolute: string } | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const day = toDay(date);
  return { relative: relativeDayLabel(day, toDay(new Date())), absolute: formatDayShort(day) };
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/** "Recorded $725 from Raj Patel for November 2026 rent." — the success notice. */
export function verifiedNotice(payment: ReportedZellePayment, currency: string): string {
  const from = payment.payer_name ? ` from ${payment.payer_name}` : "";
  const rent = rentOf(payment);
  return `Recorded ${exactMoney(payment.amount, currency)}${from}${rent ? ` for ${rent}` : ""}.`;
}

function isFocused(payment: ReportedZellePayment, focus: VerificationFocus | null): boolean {
  if (!focus) return false;
  if (focus.intentId != null) return payment.id === focus.intentId;
  return focus.period != null && payment.charge?.period === focus.period;
}

const rowDomId = (intentId: number) => `zelle-payment-${intentId}`;

/**
 * How many rows the last load found, kept for the session so the loading
 * state reserves the right amount of room: nothing when nothing was waiting.
 */
let lastKnownCount: number | null = null;

/**
 * "Awaiting verification" on the admin Rent page: every Zelle payment a tenant
 * reported that the office has not confirmed, across all periods. Renders
 * nothing when there is nothing to verify.
 */
export function AwaitingVerificationSection({
  currency,
  canVerify,
  focus = null,
  refreshKey = 0,
  onLocated,
  onVerified,
}: {
  currency: string;
  /** Admins only — the database refuses everyone else regardless. */
  canVerify: boolean;
  focus?: VerificationFocus | null;
  /** Bump to re-read the list quietly (e.g. after a payment is recorded by hand). */
  refreshKey?: number;
  /** The payment a `verify` deep link named is in the list. */
  onLocated?: (payment: ReportedZellePayment) => void;
  /** A payment was confirmed and is now on the ledger. */
  onVerified?: (payment: ReportedZellePayment) => void;
}) {
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [payments, setPayments] = useState<ReportedZellePayment[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<ReportedZellePayment | null>(null);
  const request = useRef(0);

  const load = useCallback(async (opts?: { quiet?: boolean }) => {
    const mine = ++request.current;
    if (!opts?.quiet) {
      setLoading(true);
      setError(null);
    }
    try {
      const list = await listReportedZellePayments();
      if (mine !== request.current) return;
      lastKnownCount = list.length;
      setPayments(list);
      setError(null);
    } catch (err) {
      if (mine !== request.current) return;
      // A quiet refresh that fails keeps what is on screen.
      if (!opts?.quiet) setError((err as Error).message || "Supabase request failed");
    } finally {
      if (mine === request.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    return () => {
      request.current += 1;
    };
  }, [load]);

  useEffect(() => {
    if (refreshKey > 0) void load({ quiet: true });
  }, [refreshKey, load]);

  // Deep link: once the list is in, bring the named payment into view.
  const handledFocus = useRef<VerificationFocus | null>(null);
  const onLocatedRef = useRef(onLocated);
  onLocatedRef.current = onLocated;
  useEffect(() => {
    if (!focus || payments === null || handledFocus.current === focus) return;
    handledFocus.current = focus;
    if (focus.intentId == null) return;
    const match = payments.find((p) => p.id === focus.intentId);
    if (!match) return;
    onLocatedRef.current?.(match);
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    document
      .getElementById(rowDomId(match.id))
      ?.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
  }, [focus, payments]);

  function closeDialog(afterFailure: boolean) {
    setTarget(null);
    // The server refused: the payment may have changed under us, so re-read it.
    if (afterFailure) void load({ quiet: true });
  }

  function handleConfirmed(payment: ReportedZellePayment) {
    setTarget(null);
    setPayments((prev) => prev?.filter((p) => p.id !== payment.id) ?? prev);
    if (lastKnownCount != null && lastKnownCount > 0) lastKnownCount -= 1;
    // The row (and its Verify button) is gone; keep keyboard focus in the section.
    window.setTimeout(() => headingRef.current?.focus(), 0);
    onVerified?.(payment);
    void load({ quiet: true });
  }

  const heading = (count?: number) => (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <h2 id={headingId} ref={headingRef} tabIndex={-1} className="text-sm font-semibold outline-none">
        Awaiting verification
      </h2>
      {count ? (
        <span className="badge-tone tone-warning tabular-nums" aria-label={`${count} waiting`}>
          {count}
        </span>
      ) : null}
    </div>
  );

  if (payments === null) {
    if (error) {
      return (
        <section aria-labelledby={headingId} className="space-y-2">
          {heading()}
          <ErrorRetry
            className="py-4"
            message={`Could not load the Zelle payments awaiting verification. ${error}`}
            onRetry={() => void load()}
          />
        </section>
      );
    }
    // First visit shows one row; after that, as many as were waiting last time.
    const rows = focus?.intentId != null ? Math.max(1, lastKnownCount ?? 1) : (lastKnownCount ?? 1);
    if (!loading || rows === 0) return null;
    return (
      <section aria-labelledby={headingId} className="space-y-2">
        {heading()}
        <Card
          className="divide-y divide-border overflow-hidden"
          role="status"
          aria-label="Loading payments awaiting verification"
        >
          {Array.from({ length: Math.min(rows, 3) }, (_, i) => (
            <div key={i} className="flex h-16 items-center gap-4 px-4" aria-hidden>
              <div className="space-y-2">
                <div className="h-2.5 w-48 animate-pulse rounded-full bg-muted" />
                <div className="h-2.5 w-32 animate-pulse rounded-full bg-muted" />
              </div>
              <div className="ml-auto h-2.5 w-12 animate-pulse rounded-full bg-muted" />
            </div>
          ))}
        </Card>
      </section>
    );
  }

  const missing = focus?.intentId != null && !payments.some((p) => p.id === focus.intentId);

  if (payments.length === 0) {
    // Nothing to verify: say nothing — unless a link pointed at a payment that is no longer here.
    if (!missing) return null;
    return (
      <p role="status" className="text-sm text-muted-foreground">
        That Zelle payment is no longer awaiting verification. It may already have been verified.
      </p>
    );
  }

  return (
    <section aria-labelledby={headingId} className="space-y-2">
      <div className="space-y-1">
        {heading(payments.length)}
        <p className="text-sm text-muted-foreground">
          Zelle payments tenants say they sent. A balance changes only after the payment is verified.
        </p>
        {missing ? (
          <p role="status" className="text-sm text-muted-foreground">
            The payment you opened is no longer awaiting verification. It may already have been verified.
          </p>
        ) : null}
      </div>
      <Card className="overflow-hidden">
        <ul className="divide-y divide-border">
          {payments.map((payment) => {
            const amount = exactMoney(payment.amount, currency);
            const payer = payment.payer_name;
            const place = placeOf(payment);
            const rent = rentOf(payment);
            const reported = reportedParts(payment.reported_at);
            const focused = isFocused(payment, focus);
            return (
              <li
                key={payment.id}
                id={rowDomId(payment.id)}
                aria-current={focused ? "true" : undefined}
                className={cn(
                  "flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:gap-4",
                  focused && "bg-info-tint",
                )}
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-sm">
                    <span className="font-semibold tabular-nums">{amount}</span> Zelle from{" "}
                    <span className="font-medium">{payer ? `${payer}, tenant` : "a tenant"}</span>
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {[place, rent].filter(Boolean).join(" · ") || "Rent charge unavailable"}
                  </p>
                  <p className="text-[0.8125rem] text-muted-foreground">
                    {reported ? (
                      <>
                        Reported{" "}
                        <time dateTime={payment.reported_at}>
                          {lowerFirst(reported.relative)} · {reported.absolute}
                        </time>
                      </>
                    ) : (
                      "Report date unavailable"
                    )}
                  </p>
                  <ReferenceLine payment={payment} />
                </div>
                {canVerify ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="self-start max-sm:h-9 max-sm:px-3 sm:self-center"
                    onClick={() => setTarget(payment)}
                    aria-label={`Verify ${amount} Zelle from ${payer ?? "a tenant"}`}
                  >
                    Verify
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      </Card>

      {target ? (
        <VerifyZelleDialog
          key={target.id}
          payment={target}
          currency={currency}
          onClose={closeDialog}
          onConfirmed={handleConfirmed}
        />
      ) : null}
    </section>
  );
}

/** "Memo reference LG-12-3 · Bank confirmation BANK-8841" — what the tenant gave the office to match. */
function ReferenceLine({ payment, className }: { payment: ReportedZellePayment; className?: string }) {
  if (!payment.client_reference && !payment.bank_confirmation_ref) return null;
  return (
    <p className={cn("break-words text-[0.8125rem] text-muted-foreground", className)}>
      {payment.client_reference ? (
        <>
          Memo reference <span className="font-medium text-foreground">{payment.client_reference}</span>
        </>
      ) : null}
      {payment.client_reference && payment.bank_confirmation_ref ? " · " : null}
      {payment.bank_confirmation_ref ? (
        <>
          Bank confirmation <span className="font-medium text-foreground">{payment.bank_confirmation_ref}</span>
        </>
      ) : null}
    </p>
  );
}

/**
 * The confirm before money is put on the ledger. Stays open while the request
 * runs and when the server refuses, so its message is read where it happened.
 */
function VerifyZelleDialog({
  payment,
  currency,
  onClose,
  onConfirmed,
}: {
  payment: ReportedZellePayment;
  currency: string;
  /** `afterFailure` is true when the server refused at least once. */
  onClose: (afterFailure: boolean) => void;
  onConfirmed: (payment: ReportedZellePayment) => void;
}) {
  const notesId = useId();
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amount = exactMoney(payment.amount, currency);
  const rent = rentOf(payment);
  const place = placeOf(payment);
  const charge = payment.charge;
  const owed = charge ? Math.max(0, (charge.amount ?? 0) - (charge.amount_paid ?? 0)) : null;
  const after = owed == null ? null : owed - payment.amount;

  async function confirm() {
    setSaving(true);
    setError(null);
    try {
      await confirmZellePayment(payment.id, notes);
    } catch (err) {
      setError((err as Error).message || "The server did not say why.");
      setSaving(false);
      return;
    }
    onConfirmed(payment);
  }

  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose(error !== null);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Record {amount} as received{payment.payer_name ? ` from ${payment.payer_name}` : ""}
            {rent ? ` for ${rent}` : ""}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            This adds a {amount} Zelle payment to the ledger{place ? ` for ${place}` : ""}
            {owed != null && after != null && after >= 0
              ? `, taking the balance from ${exactMoney(owed, currency)} to ${exactMoney(after, currency)}`
              : ""}
            . Confirm only once the money shows in the bank account.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {owed != null && after != null && after < 0 ? (
          <p className="rounded-sm bg-warning-tint px-3 py-2 text-sm text-warning">
            Only {exactMoney(owed, currency)} is still owed on this charge, less than this payment. The ledger
            will refuse it until that is corrected.
          </p>
        ) : null}

        <ReferenceLine payment={payment} />

        <div className="grid gap-1.5">
          <Label htmlFor={notesId}>Note for the ledger (optional)</Label>
          <Textarea
            id={notesId}
            rows={2}
            maxLength={500}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={saving}
            placeholder="For example: matched the deposit on the bank statement"
          />
        </div>

        {error ? (
          <p role="alert" className="rounded-sm bg-destructive-tint px-3 py-2 text-sm text-destructive">
            The payment was not recorded. {error}
          </p>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
          <Button type="button" onClick={() => void confirm()} disabled={saving} aria-busy={saving}>
            {saving ? (
              <>
                <Loader2 className="animate-spin" aria-hidden /> Recording…
              </>
            ) : error ? (
              "Try again"
            ) : (
              "Confirm payment"
            )}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
