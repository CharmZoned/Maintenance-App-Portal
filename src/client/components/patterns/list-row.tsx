import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Clickable list row — title, one context line, status slot on the right
 * (Figma Patterns / List row). Prefer this over ad-hoc table rows for queues.
 */
export function ListRow({
  title,
  context,
  status,
  priority,
  onClick,
  className,
}: {
  title: ReactNode;
  context?: ReactNode;
  status?: ReactNode;
  priority?: ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  const interactive = Boolean(onClick);
  const Comp = interactive ? "button" : "div";
  return (
    <Comp
      type={interactive ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "flex w-full items-center justify-between gap-4 border-b border-border bg-background px-4 py-3 text-left transition-colors admin:bg-card",
        interactive && "hover:bg-muted/60 focus-visible:bg-muted/60",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-2">
        {priority ? <div className="shrink-0 pt-0.5">{priority}</div> : null}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-foreground">{title}</div>
          {context ? <div className="truncate text-xs text-muted-foreground">{context}</div> : null}
        </div>
      </div>
      {status ? <div className="shrink-0">{status}</div> : null}
    </Comp>
  );
}
