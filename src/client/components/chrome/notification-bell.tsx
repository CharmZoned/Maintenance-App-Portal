import { Bell } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Header notification control (Figma Bell). Wire to Messages later —
 * `unread` draws the red dot only.
 *
 * `size="touch"` is the admin workspace header variant: a 44px target with a
 * 24px bell. The default (36px / 16px) is unchanged for the other shells.
 */
export function NotificationBell({
  unread = false,
  onClick,
  size = "default",
  className,
}: {
  unread?: boolean;
  onClick?: () => void;
  size?: "default" | "touch";
  className?: string;
}) {
  const touch = size === "touch";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={unread ? "Notifications, unread" : "Notifications"}
      className={cn(
        "relative flex shrink-0 items-center justify-center rounded-sm text-foreground hover:bg-muted",
        touch ? "size-11" : "size-9",
        className,
      )}
    >
      <Bell className={touch ? "size-6" : "size-4"} strokeWidth={touch ? 2 : 1.75} aria-hidden />
      {unread ? (
        <span
          className={cn(
            "absolute size-2 rounded-full bg-destructive-solid",
            touch ? "right-2.5 top-2.5" : "right-1.5 top-1.5",
          )}
          aria-hidden
        />
      ) : null}
    </button>
  );
}
