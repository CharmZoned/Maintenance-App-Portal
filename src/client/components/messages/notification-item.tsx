import { cn } from "@/lib/utils";
import type { NotificationItemData } from "@/lib/messages";

/** Figma `Notification item`. Landlord rows match LN Notifications (`2037:1742`). */
export function NotificationItem({
  item,
  onClick,
  variant = "default",
}: {
  item: NotificationItemData;
  onClick?: () => void;
  variant?: "default" | "landlord";
}) {
  const Comp = onClick ? "button" : "div";
  const landlord = variant === "landlord";
  return (
    <Comp
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "flex w-full items-start gap-3 border-b border-border bg-card px-4 py-3.5 text-left",
        landlord && "min-h-[108px]",
        onClick && "hover:bg-muted/50",
      )}
    >
      <div
        className={cn(
          "flex h-3.5 w-2 shrink-0 justify-center",
          landlord ? "items-center" : "pt-1",
        )}
      >
        {item.unread ? (
          <span
            className={cn("size-2 rounded-full", landlord ? "bg-foreground" : "bg-brand")}
            aria-hidden
          />
        ) : null}
      </div>
      <div className={cn("min-w-0 flex-1", landlord && "flex flex-col gap-1")}>
        <p className={cn("text-sm text-foreground", landlord && "leading-normal")}>{item.sentence}</p>
        <p className={cn("text-xs text-muted-foreground", landlord ? "leading-normal" : "mt-1")}>
          {item.time}
        </p>
      </div>
    </Comp>
  );
}
