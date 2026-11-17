import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatPayDate, formatUsd, type TenantPaymentsProfile } from "../payments-model";

/**
 * ACH authorization overlay — fully mocked.
 * TODO(data-gap): Stripe Financial Connections / ACH Direct Debit not connected.
 */
export function AchOverlay({
  open,
  onOpenChange,
  amount,
  initiationDate,
  profile,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  amount: number;
  initiationDate: string;
  profile: TenantPaymentsProfile | null;
}) {
  const fee = 0;
  const merchant =
    profile?.property_name != null
      ? `${profile.property_name} Rent (example)`
      : "Property Rent (example)";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[390px] gap-5 sm:max-w-[420px]">
        <DialogHeader className="space-y-2 text-left">
          <p className="text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground">
            Payments / Method details
          </p>
          <DialogTitle className="text-2xl font-semibold leading-8">ACH bank transfer</DialogTitle>
          <DialogDescription className="text-sm text-foreground">
            Test payment · {formatUsd(amount)}
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-sm bg-muted px-4 py-4 text-sm">
          <p className="font-medium text-foreground">Connect a bank securely</p>
          <p className="mt-2 text-muted-foreground">
            Stripe-supported account connection and verification appear here when integrated.
          </p>
        </div>

        {/* TODO(data-gap): Financial Connections session. */}
        <Button type="button" disabled className="h-11 min-h-11 w-full bg-muted text-muted-foreground">
          Connect bank · unavailable
        </Button>

        <div className="space-y-3 text-sm">
          <p className="font-semibold text-foreground">One-time debit authorization</p>
          <p className="italic text-warning">
            Illustrative mandate — final terms must come from Stripe and be legally reviewed.
          </p>
          <p className="text-muted-foreground">
            By authorizing, you permit {merchant} to initiate one debit of {formatUsd(amount)} on{" "}
            {formatPayDate(initiationDate)} from your verified bank account.
          </p>
          <p className="text-muted-foreground">
            Processing fee: <span className="font-semibold text-foreground">{formatUsd(fee)}</span> ·
            test policy
          </p>
          <p className="text-muted-foreground">
            The provider supplies an estimated processing period after connection. Initiation stays
            Processing until confirmed; a return or reversal reopens the balance.
          </p>
        </div>

        {/* TODO(data-gap): ACH mandate + debit initiation. */}
        <Button type="button" disabled className="h-11 min-h-11 w-full bg-muted text-muted-foreground">
          Authorize debit · unavailable
        </Button>
        <p className="text-xs text-muted-foreground">
          No bank is connected. No mandate is collected and no debit is initiated in this design.
        </p>

        <Button type="button" variant="outline" className="h-11 min-h-11 w-full" onClick={() => onOpenChange(false)}>
          Back to payment
        </Button>
      </DialogContent>
    </Dialog>
  );
}
