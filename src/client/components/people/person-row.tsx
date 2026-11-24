import { cn } from "@/lib/utils";
import { PortalStatus, type PortalStatusKind } from "./portal-status";

/** Figma `Person row` — name, meta, portal status. */
export function PersonRow({
  name,
  meta,
  status,
  onClick,
  className,
}: {
  name: string;
  meta: string;
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
        "flex h-[100px] w-full items-center justify-between gap-4 border-b border-border bg-card px-4 py-3 text-left",
        onClick && "hover:bg-muted/50",
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{name}</p>
        <p className="truncate text-xs text-muted-foreground">{meta}</p>
      </div>
      {status ? <PortalStatus status={status} /> : null}
    </Comp>
  );
}
