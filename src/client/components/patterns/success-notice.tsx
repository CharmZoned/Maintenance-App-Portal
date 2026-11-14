import { cn } from "@/lib/utils";

/**
 * Success flash — prefer NoticeBanner for global toasts; use this when embedding
 * a success strip in a page (Figma Patterns / Success notice).
 */
export function SuccessNotice({
  message,
  className,
}: {
  message: string;
  className?: string;
}) {
  return (
    <div
      role="status"
      className={cn(
        "flex items-center rounded-sm bg-success-tint px-3 py-2.5 text-sm font-medium text-success",
        className,
      )}
    >
      {message}
    </div>
  );
}
