import { Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatMessageTime, type MessageThread } from "@/lib/messages";

/** Figma `Message thread row` — unread dot, optional wrench, title + preview + time. */
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
  const accessibleName = thread.unread
    ? `${thread.title}, unread. ${thread.preview}. ${time}`
    : `${thread.title}. ${thread.preview}. ${time}`;

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
            ) : null}
            <span className="truncate text-sm font-semibold text-foreground">{thread.title}</span>
          </div>
          <span className="shrink-0 text-xs text-muted-foreground">{time}</span>
        </div>
        <p className="mt-1 truncate text-[13px] text-muted-foreground">{thread.preview}</p>
      </div>
    </button>
  );
}
