import { RefreshCw, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * In-place list/page error with Retry (Figma Patterns / Error + Retry; spec §3, §6.3):
 * a triangle-alert icon, the message, then a secondary Retry with refresh-cw.
 */
export function ErrorRetry({
  message = "We couldn't load this list. Check your connection and try again.",
  onRetry,
  className,
}: {
  message?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn("flex flex-col items-center gap-3 px-4 py-10 text-center", className)}
    >
      <TriangleAlert className="size-6 text-destructive" aria-hidden />
      <p className="max-w-[420px] text-sm leading-5 text-muted-foreground">{message}</p>
      {onRetry ? (
        <Button variant="secondary" onClick={onRetry}>
          <RefreshCw aria-hidden />
          Retry
        </Button>
      ) : null}
    </div>
  );
}
