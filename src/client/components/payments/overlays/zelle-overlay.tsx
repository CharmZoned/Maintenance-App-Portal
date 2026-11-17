import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatUsd, type TenantPaymentsProfile } from "../payments-model";

/**
 * Zelle instructions overlay — fully mocked.
 * TODO(data-gap): no Zelle recipient entities or mark-as-sent RPC.
 */
export function ZelleOverlay({
  open,
  onOpenChange,
  amount,
  profile,
  paymentReference,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  amount: number;
  profile: TenantPaymentsProfile | null;
  paymentReference: string;
}) {
  const [copied, setCopied] = useState(false);
  const [bankRef, setBankRef] = useState("");
  const recipient =
    profile?.property_name != null
      ? `${profile.property_name} Rent (example)`
      : "Property Rent (example)";

  async function copyReference() {
    try {
      await navigator.clipboard.writeText(paymentReference);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[390px] gap-5 sm:max-w-[420px]">
        <DialogHeader className="space-y-2 text-left">
          <p className="text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground">
            Payments / Method details
          </p>
          <DialogTitle className="text-2xl font-semibold leading-8">Pay with Zelle</DialogTitle>
          <DialogDescription className="sr-only">
            Example Zelle instructions. Real transfers are unavailable.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-sm bg-warning-tint px-3 py-3 text-sm text-warning">
          <p className="font-semibold uppercase tracking-wide">Test only · do not send funds</p>
          <p className="mt-1 text-warning/90">
            The example recipient is not verified. Real Zelle payments are unavailable.
          </p>
        </div>

        <dl className="space-y-3 text-sm">
          <div>
            <dt className="text-muted-foreground">Recipient name</dt>
            <dd className="font-medium text-foreground">{recipient}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Zelle email</dt>
            <dd className="font-medium text-foreground">payments@example.com</dd>
            <p className="mt-1 text-xs text-warning">Recipient not verified</p>
          </div>
          <div>
            <dt className="text-muted-foreground">Amount</dt>
            <dd className="font-medium tabular-nums text-foreground">{formatUsd(amount)}</dd>
          </div>
        </dl>

        <div>
          <p className="text-sm font-semibold text-foreground">When enabled</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            <li>Open Zelle in your banking app.</li>
            <li>Confirm the verified recipient with your manager.</li>
            <li>Enter the approved amount and reference.</li>
          </ol>
        </div>

        <div className="space-y-2">
          <Label htmlFor="zelle-ref">Payment reference</Label>
          <div className="flex gap-2">
            <Input id="zelle-ref" readOnly value={paymentReference} className="h-11" />
            <Button type="button" variant="outline" className="h-11 min-h-11 shrink-0 px-3" onClick={copyReference}>
              {copied ? "Copied" : "Copy reference"}
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="zelle-bank-ref">Bank confirmation reference (optional)</Label>
          <Input
            id="zelle-bank-ref"
            className="h-11"
            placeholder="Enter confirmation reference"
            value={bankRef}
            onChange={(e) => setBankRef(e.target.value)}
          />
        </div>

        {/* TODO(data-gap): Mark as sent would create Awaiting Verification — no processor table. */}
        <Button type="button" disabled className="h-11 min-h-11 w-full bg-muted text-muted-foreground">
          Mark as sent · unavailable
        </Button>
        <p className="text-xs text-muted-foreground">
          Marking sent would create Awaiting Verification, not Paid. Only independently confirmed
          funds can reduce the balance.
        </p>

        <Button type="button" variant="outline" className="h-11 min-h-11 w-full" onClick={() => onOpenChange(false)}>
          Back to payment
        </Button>
      </DialogContent>
    </Dialog>
  );
}
