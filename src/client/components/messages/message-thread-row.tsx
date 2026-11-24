import { MessageSquare, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatMessageTime, type MessageThread } from "@/lib/messages";

/**
 * Figma `Message thread row` — unread dot, kind icon, title + preview + time.
 * Unread is carried three ways: the dot, a heavier title, and ", unread" in
 * the row's accessible name.
 */
export function MessageThreadRow({
  thread,
  selected,
  onSelect,
  now,
}: {
  thread: MessageThread;
  selected?: boolean;
  onSelect?: () => void;
  now?: Date;
}) {
  const time = formatMessageTime(thread.updatedAt, now);
  const accessibleName = [
    thread.unread ? `${thread.title}, unread.` : `${thread.title}.`,
    /[.!?…]$/.test(thread.preview) ? thread.preview : `${thread.preview}.`,
    time,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={accessibleName}
      aria-current={selected ? "true" : undefined}
      className={cn(
        // Staff/landlord inbox: keep original 100px + muted selection tint.
        // Tenant portal rows live in tenant-messages-page (taller + brand-tint).
        "flex h-[100px] w-full items-center gap-3 border-b border-border bg-card px-4 py-3.5 text-left transition-colors",
        selected ? "bg-muted/70" : "hover:bg-muted/50",
      )}
    >
      <div className="flex h-full w-2 shrink-0 items-center justify-center">
        {thread.unread ? (
          <span className="size-2 rounded-full bg-brand" aria-hidden />
        ) : null}
      </div>
      <div className="min-w-0 flex-1" aria-hidden>
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            {thread.kind === "request" ? (
              <Wrench className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            ) : thread.kind === "office" ? (
              <MessageSquare className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            ) : null}
            <span
              className={cn(
                "truncate text-sm text-foreground",
                // Unread reads heavier than read, on top of the dot.
                thread.unread ? "font-semibold" : "font-medium",
              )}
            >
              {thread.title}
            </span>
          </div>
          {time ? <span className="shrink-0 text-xs text-muted-foreground">{time}</span> : null}
        </div>
        <p className="mt-1 truncate text-[13px] text-muted-foreground">{thread.preview}</p>
      </div>
    </button>
  );
}
