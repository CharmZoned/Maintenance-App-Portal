import { PriorityChip, StatusChip } from "@/components/patterns";
import type { PriorityLevel, RequestStatus } from "@/lib/request-status";

/**
 * Request page header (Figma "UPGRADED — Request", admin frame; brief N3 Header).
 *
 * Title is the request TITLE with the number beside it (not "Request #MR-…"),
 * and the status chip sits IN the summary line with date, assignee and priority.
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
  /** "Unit 1A · Maple Court". */
  location: string;
  /** "Tina Renter" / "You". */
  reportedBy: string;
  /** Already formatted, e.g. "14 Nov" (formatActivityStamp / formatDocumentDate). */
  reportedWhen: string;
  /** Assigned person's NAME (never "Assigned (staff)"); null when unassigned. */
  assigneeName: string | null;
  backLabel: string;
  onBack: () => void;
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
}: RequestHeaderProps) {
  const number = requestNumber.startsWith("#") ? requestNumber : `#${requestNumber}`;
  const summary = [
    location,
    reportedBy ? `Reported by ${reportedBy}${reportedWhen ? `, ${reportedWhen}` : ""}` : reportedWhen,
    assigneeName ? `Assigned to ${assigneeName}` : "Not yet assigned",
  ].filter(Boolean);

  return (
    <header className="flex flex-col gap-2">
      <button
        type="button"
        onClick={onBack}
        className="-ml-2 inline-flex h-11 items-center self-start rounded-sm px-2 text-sm font-medium text-brand-text hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/40"
      >
        ‹ {backLabel}
      </button>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-2xl font-semibold leading-8 text-foreground">{title}</h1>
        <span className="text-sm text-muted-foreground">{number}</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
        <StatusChip status={status} />
        {priority ? <PriorityChip level={priority} /> : null}
        {nextStep ? <span>{nextStep}</span> : null}
      </div>
      <p className="text-sm text-muted-foreground">{summary.join(" · ")}</p>
    </header>
  );
}
