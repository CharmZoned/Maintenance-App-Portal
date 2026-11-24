import { CircleCheck, CircleHelp, CircleX } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { WorkOrder } from "@/types";

/**
 * Tenant "Is it fixed?" (decided 2026-11-24). On a completed request the
 * reporting tenant answers once:
 *
 *   Is it fixed?
 *   Sam Fixit marked this completed today. Let us know if the problem is gone.
 *   [Yes, it's fixed]  [Still a problem]
 *
 * Yes → confirm_maintenance_request_fixed (the card turns into the confirmed
 * line). Still a problem → a short note, then reopen_maintenance_request_not_fixed
 * reopens the request (the page shows it open again).
 */

export type TenantFixState = "ask" | "confirmed" | "not_fixed";

/** What the card shows for a request, or null when it should not show at all (not completed). */
export function tenantFixState(order: Pick<WorkOrder, "status" | "tenant_fix_response">): TenantFixState | null {
  if (order.status !== "closed") return null;
  if (order.tenant_fix_response === "confirmed") return "confirmed";
  if (order.tenant_fix_response === "not_fixed") return "not_fixed";
  return "ask";
}

/** Details-card value for staff and landlords: what the tenant said. */
export function tenantFixSummary(
  order: Pick<WorkOrder, "status" | "tenant_fix_response" | "tenant_fix_responded_at">,
  day: (iso: string) => string,
): string | null {
  const state = tenantFixState(order);
  if (!state) return null;
  const when = order.tenant_fix_responded_at ? `, ${day(order.tenant_fix_responded_at)}` : "";
  switch (state) {
    case "confirmed":
      return `Tenant confirmed it’s fixed${when}`;
    case "not_fixed":
      return `Tenant says it’s not fixed${when}`;
    default:
      return "Waiting for the tenant to confirm";
  }
}

export function TenantFixCheck({
  state,
  completedBy,
  completedWhen,
  respondedWhen,
  busy,
  onConfirm,
  onStillProblem,
}: {
  state: TenantFixState;
  /** "Sam Fixit", or null when nobody is named. */
  completedBy: string | null;
  /** "today", "Tue 17 Nov" (sentence form), or "". */
  completedWhen: string;
  respondedWhen: string;
  busy: boolean;
  onConfirm: () => void;
  onStillProblem: () => void;
}) {
  if (state === "confirmed") {
    return (
      <section
        aria-label="Fix confirmed"
        className="flex items-start gap-3 rounded-md border border-border bg-success-tint p-4 text-success md:p-5"
      >
        <CircleCheck className="mt-0.5 size-5 shrink-0" aria-hidden />
        <div className="min-w-0">
          <p className="text-[15px] font-semibold leading-[22px]">You confirmed it’s fixed</p>
          <p className="text-sm leading-5">
            {respondedWhen ? `Thanks for letting us know ${respondedWhen}.` : "Thanks for letting us know."} If it
            happens again, report a new request.
          </p>
        </div>
      </section>
    );
  }
  if (state === "not_fixed") {
    return (
      <section
        aria-label="Not fixed"
        className="flex items-start gap-3 rounded-md border border-border bg-warning-tint p-4 text-warning md:p-5"
      >
        <CircleX className="mt-0.5 size-5 shrink-0" aria-hidden />
        <div className="min-w-0">
          <p className="text-[15px] font-semibold leading-[22px]">You said it’s still a problem</p>
          <p className="text-sm leading-5">The office will follow up with you.</p>
        </div>
      </section>
    );
  }
  const lead = [completedBy ? `${completedBy} marked this completed` : "This was marked completed", completedWhen]
    .filter(Boolean)
    .join(" ");
  return (
    <section
      aria-labelledby="tenant-fix-heading"
      className="flex flex-col gap-3 rounded-md border border-border bg-card p-4 md:flex-row md:items-center md:gap-4 md:p-5"
    >
      <CircleHelp className="hidden size-5 shrink-0 text-muted-foreground md:block" aria-hidden />
      <div className="min-w-0 flex-1">
        <h2 id="tenant-fix-heading" className="text-[17px] font-semibold leading-[22px] text-foreground">
          Is it fixed?
        </h2>
        <p className="text-sm leading-5 text-muted-foreground">{lead}. Let us know if the problem is gone.</p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row md:shrink-0">
        <Button size="touch" className="md:h-8 md:px-3" disabled={busy} onClick={onConfirm}>
          Yes, it’s fixed
        </Button>
        <Button size="touch" variant="secondary" className="md:h-8 md:px-3" disabled={busy} onClick={onStillProblem}>
          Still a problem
        </Button>
      </div>
    </section>
  );
}
