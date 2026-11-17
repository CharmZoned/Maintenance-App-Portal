import { useEffect, useState } from "react";
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
import { cn } from "@/lib/utils";
import type { DateRange } from "../payments-model";

function monthBounds(year: number, monthIndex: number): { from: string; to: string; label: string } {
  const from = new Date(year, monthIndex, 1);
  const to = new Date(year, monthIndex + 1, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  const label = from.toLocaleDateString("en-US", { month: "long" });
  return {
    from: `${from.getFullYear()}-${pad(from.getMonth() + 1)}-${pad(from.getDate())}`,
    to: `${to.getFullYear()}-${pad(to.getMonth() + 1)}-${pad(to.getDate())}`,
    label,
  };
}

/** Quick ranges: All / previous month / current month (client-side filter on live ledger). */
export function buildQuickRanges(now = new Date()): {
  all: DateRange;
  previous: DateRange;
  current: DateRange;
} {
  const prev = monthBounds(now.getFullYear(), now.getMonth() - 1);
  const cur = monthBounds(now.getFullYear(), now.getMonth());
  return {
    all: { from: null, to: null, label: "All dates" },
    previous: { from: prev.from, to: prev.to, label: prev.label },
    current: { from: cur.from, to: cur.to, label: cur.label },
  };
}

export function DateRangeFilterDialog({
  open,
  onOpenChange,
  value,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: DateRange;
  onApply: (range: DateRange) => void;
}) {
  const quick = buildQuickRanges();
  const [from, setFrom] = useState(value.from ?? "");
  const [to, setTo] = useState(value.to ?? "");

  useEffect(() => {
    if (open) {
      setFrom(value.from ?? "");
      setTo(value.to ?? "");
    }
  }, [open, value.from, value.to]);

  function selectQuick(range: DateRange) {
    onApply(range);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[390px] gap-5 sm:max-w-[420px]">
        <DialogHeader className="space-y-1 text-left">
          <DialogTitle className="text-xl font-semibold">Filter by date</DialogTitle>
          <DialogDescription className="text-xs font-medium uppercase tracking-wide text-warning">
            Test preview · Quick ranges are selectable.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="space-y-2">
            <Label htmlFor="ledger-from">From</Label>
            <Input
              id="ledger-from"
              className="h-11"
              value={from || value.from || "—"}
              readOnly
              aria-readonly
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ledger-to">To</Label>
            <Input
              id="ledger-to"
              className="h-11"
              value={to || value.to || "—"}
              readOnly
              aria-readonly
            />
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold text-foreground">Choose a range</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {[quick.all, quick.previous, quick.current].map((r) => {
              const selected =
                (value.from ?? null) === (r.from ?? null) && (value.to ?? null) === (r.to ?? null);
              return (
                <Button
                  key={r.label}
                  type="button"
                  variant="outline"
                  className={cn(
                    "h-11 min-h-11 px-3",
                    selected && "bg-brand-tint text-brand-text shadow-none",
                  )}
                  onClick={() => selectQuick(r)}
                >
                  {r.label === "All dates" ? "All dates" : r.label}
                </Button>
              );
            })}
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          These fixed test ranges preview filtering. Custom date entry requires the connected
          application.
        </p>

        <Button type="button" variant="outline" className="h-11 min-h-11 w-full" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
      </DialogContent>
    </Dialog>
  );
}
