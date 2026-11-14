import { cn } from "@/lib/utils";

/** Figma `Message bubble` — Incoming (muted) / Outgoing (brand-tint). */
export function MessageBubble({
  sender,
  body,
  time,
  side = "incoming",
}: {
  sender: string;
  body: string;
  time: string;
  side?: "incoming" | "outgoing";
}) {
  const outgoing = side === "outgoing";
  return (
    <div
      className={cn(
        "flex max-w-[280px] flex-col gap-1 rounded-md px-3 py-2.5",
        outgoing ? "bg-brand-tint" : "bg-muted",
      )}
    >
      <p
        className={cn(
          "text-[11px] font-medium",
          outgoing ? "text-brand-text" : "text-muted-foreground",
        )}
      >
        {sender}
      </p>
      <p className="text-sm text-foreground whitespace-pre-wrap">{body}</p>
      <p className="text-[11px] text-muted-foreground">{time}</p>
    </div>
  );
}
