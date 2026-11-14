import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/** In-place list/page error with Retry (Figma Patterns / Error + Retry). */
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
      className={cn(
        "flex flex-col items-start gap-3 rounded-md bg-destructive-tint px-4 py-6",
        className,
      )}
    >
      <p className="text-sm text-destructive">{message}</p>
      {onRetry ? (
        <Button
          variant="outline"
          className="border-destructive text-destructive hover:bg-destructive-tint"
          onClick={onRetry}
        >
          Retry
        </Button>
      ) : null}
    </div>
  );
}
