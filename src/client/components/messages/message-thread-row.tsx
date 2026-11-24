import { MessageSquare, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatMessageTime, type MessageThread } from "@/lib/messages";

/**
 * Figma `Message thread row` — unread dot, optional wrench, title + preview + time.
 * With `thread.counterpart` (admin inbox) the row leads with who the
 * conversation is with; the request reference / thread kind moves to a second
 * line above the preview.
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
  // An empty thread has no message to date it by.
  const time = thread.empty ? "" : formatMessageTime(thread.updatedAt, now);
  const heading = thread.counterpart ? `${thread.counterpart} — ${thread.title}` : thread.title;
  const when = time ? `. ${time}` : "";
  const accessibleName = thread.unread
    ? `${heading}, unread. ${thread.preview}${when}`
    : `${heading}. ${thread.preview}${when}`;

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
      {thread.counterpart ? (
        <div className="min-w-0 flex-1" aria-hidden>
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-sm font-semibold text-foreground">{thread.counterpart}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{time}</span>
          </div>
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[13px] text-foreground/80">
            {thread.kind === "request" ? (
              <Wrench className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            ) : (
              <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            )}
            <span className="truncate">{thread.title}</span>
          </div>
          <p className="mt-0.5 truncate text-[13px] text-muted-foreground">{thread.preview}</p>
        </div>
      ) : (
        <div className="min-w-0 flex-1" aria-hidden>
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5">
              {thread.kind === "request" ? (
                <Wrench className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              ) : null}
              <span className="truncate text-sm font-semibold text-foreground">{thread.title}</span>
            </div>
            {time ? <span className="shrink-0 text-xs text-muted-foreground">{time}</span> : null}
          </div>
          <p
            className={cn(
              "mt-1 truncate text-[13px]",
              thread.empty ? "italic text-muted-foreground/80" : "text-muted-foreground",
            )}
          >
            {thread.preview}
          </p>
        </div>
      )}
    </button>
  );
}
