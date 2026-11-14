import { cn } from "@/lib/utils";
import type { CommentVisibility } from "@/types";

/** Figma `Message bubble` — Incoming (muted) / Outgoing (brand-tint). */
export function MessageBubble({
  sender,
  body,
  time,
  side = "incoming",
  visibility,
  showVisibilityLabel = false,
}: {
  sender: string;
  body: string;
  time: string;
  side?: "incoming" | "outgoing";
  visibility?: CommentVisibility;
  showVisibilityLabel?: boolean;
}) {
  const outgoing = side === "outgoing";
  return (
    <div
      className={cn(
        "flex max-w-[280px] flex-col gap-1 rounded-md px-3 py-2.5",
        outgoing ? "bg-brand-tint" : "bg-muted",
      )}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <p
          className={cn(
            "text-[11px] font-medium",
            outgoing ? "text-brand-text" : "text-muted-foreground",
          )}
        >
          {sender}
        </p>
        {showVisibilityLabel && visibility ? (
          <span
            className={cn(
              "rounded-xs px-1.5 py-px text-[10px] font-medium",
              visibility === "internal"
                ? "bg-background text-muted-foreground shadow-edge"
                : "bg-brand-tint text-brand-text",
            )}
          >
            {visibility === "internal" ? "Internal" : "Tenant visible"}
          </span>
        ) : null}
      </div>
      <p className="text-sm text-foreground whitespace-pre-wrap">{body}</p>
      <p className="text-[11px] text-muted-foreground">{time}</p>
    </div>
  );
}
