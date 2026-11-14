import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * Empty list / first-use or filtered-empty (Figma Patterns / Empty).
 * Filtered variant uses a text clear action, not a solid CTA.
 */
export function EmptyState({
  message,
  icon,
  actionLabel,
  onAction,
  filtered = false,
  clearLabel = "Clear filter",
  onClear,
  className,
}: {
  message: string;
  icon?: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  filtered?: boolean;
  clearLabel?: string;
  onClear?: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 px-6 py-10 text-center",
        className,
      )}
    >
      <div className="flex size-10 items-center justify-center rounded-sm bg-muted text-muted-foreground">
        {icon ?? <span className="size-5 rounded-sm bg-border" aria-hidden />}
      </div>
      <p className="max-w-sm text-sm text-muted-foreground">{message}</p>
      {!filtered && actionLabel && onAction ? (
        <Button variant="brand" size="header" onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}
      {filtered ? (
        <button
          type="button"
          onClick={onClear}
          className="text-sm font-medium text-brand-text hover:underline"
        >
          {clearLabel}
        </button>
      ) : null}
    </div>
  );
}
