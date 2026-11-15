import { cn } from "@/lib/utils";
import type { NotificationItemData } from "@/lib/messages";

/** Figma `Notification item`. */
export function NotificationItem({
  item,
  onClick,
}: {
  item: NotificationItemData;
  onClick?: () => void;
}) {
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "flex w-full items-start gap-3 border-b border-border bg-card px-4 py-3.5 text-left",
        onClick && "hover:bg-muted/50",
      )}
    >
      <div className="flex h-3.5 w-2 shrink-0 justify-center pt-1">
        {item.unread ? <span className="size-2 rounded-full bg-brand" aria-hidden /> : null}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-foreground">{item.sentence}</p>
        <p className="mt-1 text-xs text-muted-foreground">{item.time}</p>
      </div>
    </Comp>
  );
}
