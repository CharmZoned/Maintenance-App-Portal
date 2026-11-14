import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Figma `Message composer` — field + Send. */
export function MessageComposer({
  disabled,
  placeholder = "Write a message…",
  onSend,
  className,
}: {
  disabled?: boolean;
  placeholder?: string;
  onSend?: (body: string) => Promise<void> | void;
  className?: string;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    const body = value.trim();
    if (!body || disabled || busy || !onSend) return;
    setBusy(true);
    try {
      await onSend(body);
      setValue("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={cn(
        "flex h-[100px] items-center gap-2 border-t border-border bg-card px-4 py-3",
        className,
      )}
    >
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        disabled={disabled || busy}
        rows={2}
        className="min-h-11 min-w-0 flex-1 resize-none rounded-md border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:opacity-50"
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void submit();
          }
        }}
      />
      <Button
        type="button"
        size="lg"
        className="min-h-11 min-w-16 px-3.5"
        disabled={disabled || busy || !value.trim()}
        onClick={() => void submit()}
      >
        Send
      </Button>
    </div>
  );
}
