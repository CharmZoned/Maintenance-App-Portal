import { Bell } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Header notification control (Figma Bell). Wire to Messages later —
 * `unread` draws the red dot only.
 */
export function NotificationBell({
  unread = false,
  onClick,
  className,
}: {
  unread?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={unread ? "Notifications, unread" : "Notifications"}
      className={cn(
        "relative flex size-9 shrink-0 items-center justify-center rounded-sm text-foreground hover:bg-muted",
        className,
      )}
    >
      <Bell className="size-4" strokeWidth={1.75} />
      {unread ? (
        <span
          className="absolute right-1.5 top-1.5 size-2 rounded-full bg-destructive-solid"
          aria-hidden
        />
      ) : null}
    </button>
  );
}
