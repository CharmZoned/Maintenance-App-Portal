import { cn } from "@/lib/utils";
import { PortalStatus, type PortalStatusKind } from "./portal-status";

/** Figma `Team row` — name, title/contact, open jobs stub, alerts flag, status. */
export function TeamRow({
  name,
  meta,
  openJobs,
  alerts,
  status,
  className,
}: {
  name: string;
  meta: string;
  openJobs?: string;
  alerts?: boolean;
  status: PortalStatusKind;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-[100px] w-full flex-wrap items-center justify-between gap-4 border-b border-border bg-card px-4 py-3",
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{name}</p>
        <p className="truncate text-xs text-muted-foreground">{meta}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        {openJobs ? <span>{openJobs}</span> : null}
        {alerts != null ? (
          <span>{alerts ? "Gets new-request alerts" : "Alerts off"}</span>
        ) : null}
        <PortalStatus status={status} />
      </div>
    </div>
  );
}
