import { Building2, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatMessageTime, type MessageThread } from "@/lib/messages";

/**
 * Figma `Message thread row` — unread dot, a wrench (request thread) or an
 * office tile (the pinned Landlord Gopher conversation), title + preview + time.
 */
export function MessageThreadRow({
  thread,
  selected,
  onSelect,
  now,
  pinned = false,
}: {
  thread: MessageThread;
  selected?: boolean;
  onSelect?: () => void;
  now?: Date;
  /** The landlord's / worker's pinned office conversation. */
  pinned?: boolean;
}) {
  const time = thread.updatedAt ? formatMessageTime(thread.updatedAt, now) : "";
  const accessibleName = [
    thread.unread ? `${thread.title}, unread.` : `${thread.title}.`,
    thread.preview ? `${thread.preview}.` : "",
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
      data-thread-id={thread.id}
      className={cn(
        // Staff/landlord inbox: keep original 100px + muted selection tint.
        // Tenant portal rows live in tenant-messages-page (taller + brand-tint).
        "flex w-full items-center gap-3 border-b border-border bg-card px-4 py-3.5 text-left transition-colors",
        pinned ? "min-h-[88px]" : "h-[100px]",
        selected ? "bg-muted/70" : "hover:bg-muted/50",
      )}
    >
      <div className="flex h-full w-2 shrink-0 items-center justify-center">
        {thread.unread ? <span className="size-2 rounded-full bg-brand" aria-hidden /> : null}
      </div>
      {pinned ? (
        <div
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-tint text-brand-text"
          aria-hidden
        >
          <Building2 className="size-5" />
        </div>
      ) : null}
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
        <p className="mt-1 truncate text-[13px] text-muted-foreground">{thread.preview}</p>
      </div>
    </button>
  );
}
