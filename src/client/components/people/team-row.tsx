import { cn } from "@/lib/utils";
import { PortalStatus, type PortalStatusKind } from "./portal-status";

/** Figma `Team row` — name, title/contact, open jobs, alerts flag, status. Opens edit when clickable. */
export function TeamRow({
  name,
  meta,
  openJobs,
  alerts,
  inactive,
  status,
  onClick,
  className,
}: {
  name: string;
  meta: string;
  openJobs?: string;
  alerts?: boolean;
  /** Office flag off: shown as a muted "Inactive" note. */
  inactive?: boolean;
  /** Omitted while account statuses are unavailable. */
  status?: PortalStatusKind;
  onClick?: () => void;
  className?: string;
}) {
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "flex min-h-[100px] w-full flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border bg-card px-4 py-3 text-left",
        onClick &&
          "transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/40",
        className,
      )}
    >
      <div className="min-w-0 flex-1 basis-48">
        <p className="truncate text-sm font-medium text-foreground">
          {name}
          {inactive ? <span className="ml-2 text-xs font-normal text-muted-foreground">Inactive</span> : null}
        </p>
        <p className="truncate text-xs text-muted-foreground">{meta}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        {openJobs ? <span>{openJobs}</span> : null}
        {alerts != null ? <span>{alerts ? "Gets new-request alerts" : "Alerts off"}</span> : null}
        {status ? <PortalStatus status={status} /> : null}
      </div>
    </Comp>
  );
}
