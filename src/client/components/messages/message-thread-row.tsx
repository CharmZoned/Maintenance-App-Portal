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
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex min-h-[7.375rem] w-full items-center gap-3 border-b border-border bg-card px-4 py-3.5 text-left transition-colors",
        selected ? "bg-brand-tint" : "hover:bg-muted/50",
      )}
    >
      <div className="flex h-full w-2 shrink-0 items-center justify-center">
        {thread.unread ? (
          <span className="size-2 rounded-full bg-brand" aria-label="Unread" />
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            {thread.kind === "request" ? (
              <Wrench className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            ) : null}
            <span className="truncate text-sm font-semibold text-foreground">{thread.title}</span>
          </div>
          <span className="shrink-0 text-xs text-muted-foreground">
            {formatMessageTime(thread.updatedAt, now)}
          </span>
        </div>
        <p className="mt-1 truncate text-[13px] text-muted-foreground">{thread.preview}</p>
      </div>
    </button>
  );
}
