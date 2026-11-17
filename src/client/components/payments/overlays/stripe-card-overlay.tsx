import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatPayDate, formatUsd } from "../payments-model";

/**
 * Stripe card review overlay — fully mocked.
 * TODO(data-gap): Stripe Checkout / Elements not connected.
 */
export function StripeCardOverlay({
  open,
  onOpenChange,
  amount,
  initiationDate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  amount: number;
  initiationDate: string;
}) {
  const fee = 0;
  const total = amount + fee;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[390px] gap-5 sm:max-w-[420px]">
        <DialogHeader className="space-y-2 text-left">
          <p className="text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground">
            Payments / Method details
          </p>
          <DialogTitle className="text-2xl font-semibold leading-8">Credit / debit card</DialogTitle>
          <DialogDescription className="text-sm text-foreground">
            Test payment · {formatUsd(amount)}
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-sm bg-muted px-4 py-4 text-sm">
          <p className="font-medium text-foreground">Stripe secure payment interface</p>
          <p className="mt-1 text-foreground">Not connected</p>
          <p className="mt-2 text-muted-foreground">
            Demo card options: Visa, Mastercard, Amex. Enabled brands depend on the property’s Stripe
            setup.
          </p>
          <p className="mt-3 font-medium text-destructive">
            Never enter card details into this design.
          </p>
        </div>

        <dl className="space-y-2 text-sm">
          <Row label="Amount" value={formatUsd(amount)} />
          <Row label="Processing fee" value={formatUsd(fee)} />
          <Row label="Total to charge" value={formatUsd(total)} strong />
          <Row label="Initiation date" value={formatPayDate(initiationDate)} strong />
        </dl>
        <p className="text-xs text-muted-foreground">
          The property absorbs fees in this test policy. Real fees must be shown before confirmation
          and comply with policy and law.
        </p>

        {/* TODO(data-gap): Stripe PaymentIntent / Checkout Session. */}
        <Button type="button" disabled className="h-11 min-h-11 w-full bg-muted text-muted-foreground">
          Pay {formatUsd(total)} · unavailable
        </Button>
        <p className="text-xs text-muted-foreground">
          Card numbers and CVVs remain with Stripe. Only authenticated payment events can confirm
          success.
        </p>

        <Button type="button" variant="outline" className="h-11 min-h-11 w-full" onClick={() => onOpenChange(false)}>
          Back to payment
        </Button>
      </DialogContent>
    </Dialog>
  );
}

function Row({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={strong ? "font-semibold tabular-nums text-foreground" : "font-medium tabular-nums text-foreground"}>
        {value}
      </dd>
    </div>
  );
}
