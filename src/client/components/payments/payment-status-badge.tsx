import { cn } from "@/lib/utils";
import { ledgerStatusTone, type LedgerStatus } from "./payments-model";

export function PaymentStatusBadge({
  status,
  className,
}: {
  status: LedgerStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-sm px-2 py-0.5 text-xs font-semibold",
        ledgerStatusTone(status),
        className,
      )}
    >
      {status}
    </span>
  );
}
