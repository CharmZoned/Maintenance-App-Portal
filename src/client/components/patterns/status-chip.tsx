import { cn } from "@/lib/utils";

/** Q2 status labels only — never Open / Scheduled / Closed. */
export type RequestStatus = "New" | "Assigned" | "In progress" | "On hold" | "Completed";

const STATUS_STYLES: Record<RequestStatus, string> = {
  New: "bg-info-tint text-info",
  Assigned: "bg-brand-tint text-brand-text",
  "In progress": "bg-warning-tint text-warning",
  "On hold": "bg-muted text-muted-foreground shadow-edge",
  Completed: "bg-success-tint text-success",
};

/**
 * Status chip + optional next-step line (Figma Patterns / StatusChip).
 * Use for queues and list rows; keep next-step copy in words.
 */
export function StatusChip({
  status,
  nextStep,
  className,
}: {
  status: RequestStatus;
  nextStep?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-start gap-1", className)}>
      <span
        className={cn(
          "inline-flex shrink-0 items-center rounded-sm px-2 py-0.5 text-xs font-medium",
          STATUS_STYLES[status],
        )}
      >
        {status}
      </span>
      {nextStep ? <p className="max-w-[220px] text-xs text-muted-foreground">{nextStep}</p> : null}
    </div>
  );
}
