import { ChevronLeft } from "lucide-react";
import { PriorityChip, StatusChip } from "@/components/patterns";
import type { PriorityLevel, RequestStatus } from "@/lib/request-status";

/**
 * Request head (Figma "UPGRADED — Request", admin frame 25:987; spec §2.1).
 *
 * The page header (PageShell) carries the request TITLE with the number beside
 * it. This block sits at the top of the content:
 *   ‹ Maintenance                                  ← back link
 *   [Assigned] Tue 17 Nov · Sam Fixit [High]       ← summary line (pill never floats)
 *   Unit 1A · Maple Court · Reported by Tina Renter, Sat 14 Nov
 * On phone the title moves into the content (22/28) under the back link,
 * because the phone header shows the parent label instead.
 */
export interface RequestHeaderProps {
  title: string;
  /** "MR-001006" (shown as "#MR-001006"); falls back to "#<id>" upstream. */
  requestNumber: string;
  status: RequestStatus;
  /** Next step in words beside the status ("Tue 17 Nov · Sam Fixit"). */
  nextStep?: string;
  /** Badge only for Emergency / High — from priorityLevel(order.priority). */
  priority: PriorityLevel | null;
  /** "Unit 1A · Maple Court" (or "Common area · Maple Court"). */
  location: string;
  /** "Tina Renter" / "You". */
  reportedBy: string;
  /** Already formatted, e.g. "Sat 14 Nov". */
  reportedWhen: string;
  /**
   * Assigned person's NAME (never "Assigned (staff)"); null when unassigned.
   * Used in the summary line only when no nextStep is given (New / Assigned).
   */
  assigneeName: string | null;
  backLabel: string;
  onBack: () => void;
  /** Hide the phone-only title (e.g. when a caller already renders it). */
  hidePhoneTitle?: boolean;
}

/**
 * The words beside the status pill. Uses the given next step; without one the
 * fallback depends on the status: New / Assigned say who has it (or that
 * nobody / no date yet), In progress names the worker when known, and On hold
 * / Completed (or In progress with nobody named) show no step rather than a
 * misleading "Not assigned yet".
 */
export function headerNextStep(
  status: RequestStatus,
  nextStep: string | undefined,
  assigneeName: string | null,
): string | null {
  const given = nextStep?.trim();
  if (given) return given;
  switch (status) {
    case "New":
      return assigneeName ? `Assigned to ${assigneeName}` : "Not assigned yet";
    case "Assigned":
      return assigneeName ? `Assigned to ${assigneeName}` : "Not scheduled yet";
    case "In progress":
      return assigneeName ? `Assigned to ${assigneeName}` : null;
    default:
      return null;
  }
}

export function RequestBackLink({ label, onBack }: { label: string; onBack: () => void }) {
  return (
    <button
      type="button"
      onClick={onBack}
      className="-ml-1 inline-flex min-h-11 items-center gap-1 self-start rounded-sm px-1 text-sm font-medium leading-5 text-foreground outline-none hover:text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 md:min-h-7"
    >
      <ChevronLeft className="size-4" aria-hidden />
      {label}
    </button>
  );
}

export function RequestHeader({
  title,
  requestNumber,
  status,
  nextStep,
  priority,
  location,
  reportedBy,
  reportedWhen,
  assigneeName,
  backLabel,
  onBack,
  hidePhoneTitle = false,
}: RequestHeaderProps) {
  const number = requestNumber.startsWith("#") ? requestNumber : `#${requestNumber}`;
  const step = headerNextStep(status, nextStep, assigneeName);
  const reported = reportedBy
    ? `Reported by ${reportedBy}${reportedWhen ? `, ${reportedWhen}` : ""}`
    : reportedWhen
      ? `Reported ${reportedWhen}`
      : "";
  const locationLine = [location, reported].filter(Boolean).join(" · ");

  return (
    <div className="flex flex-col gap-2.5">
      {/* Phone: the header bar carries the back button, so the link shows from tablet up. */}
      <div className="hidden md:flex">
        <RequestBackLink label={backLabel} onBack={onBack} />
      </div>
      {hidePhoneTitle ? null : (
        // Phone: the header bar holds the back button (with the chrome), so the title and number live here.
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 md:hidden">
          <h2 className="text-[22px] font-semibold leading-7 tracking-[-0.01em] text-foreground">{title}</h2>
          <span className="text-sm leading-5 text-muted-foreground">{number}</span>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <StatusChip status={status} />
        {step ? <span className="text-sm leading-5 text-muted-foreground">{step}</span> : null}
        {priority ? <PriorityChip level={priority} /> : null}
      </div>
      {locationLine ? <p className="text-sm leading-5 text-muted-foreground">{locationLine}</p> : null}
    </div>
  );
}
