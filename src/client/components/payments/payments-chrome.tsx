import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export function PaymentsTestBanner({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-sm bg-warning-tint px-3 py-2 text-xs font-semibold uppercase tracking-wide text-warning",
        className,
      )}
      role="status"
    >
      Test data · no money moves
    </div>
  );
}

export function PaymentsTabToggle({
  active,
  onPay,
  onLedger,
  className,
}: {
  active: "pay" | "ledger";
  onPay: () => void;
  onLedger: () => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap gap-3", className)}>
      <Button
        type="button"
        variant={active === "pay" ? "brand" : "outline"}
        className="h-11 min-h-11 px-4"
        aria-current={active === "pay" ? "page" : undefined}
        onClick={onPay}
      >
        Pay rent
      </Button>
      <Button
        type="button"
        variant={active === "ledger" ? "brand" : "outline"}
        className="h-11 min-h-11 px-4"
        aria-current={active === "ledger" ? "page" : undefined}
        onClick={onLedger}
      >
        Payment ledger
      </Button>
    </div>
  );
}

export function PaymentsBackLink({ onBack }: { onBack: () => void }) {
  return (
    <button
      type="button"
      onClick={onBack}
      className="inline-flex min-h-11 items-center text-sm font-medium text-brand-text hover:underline"
    >
      ← Back to Home
    </button>
  );
}
