import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { CommentVisibility } from "@/types";

/** Figma `Message composer` — field + Send (+ staff visibility, matching WO dialog). */
export function MessageComposer({
  disabled,
  placeholder = "Write a message…",
  showVisibility = false,
  visibility = "internal",
  onVisibilityChange,
  onSend,
  className,
  /** Active conversation id — draft clears whenever this changes (thread switch / deep-link). */
  resetKey = null,
  initialValue = "",
}: {
  disabled?: boolean;
  placeholder?: string;
  /** Staff/admin: Internal vs Tenant visible (default Internal). */
  showVisibility?: boolean;
  visibility?: CommentVisibility;
  onVisibilityChange?: (v: CommentVisibility) => void;
  onSend?: (body: string, visibility: CommentVisibility) => Promise<void> | void;
  className?: string;
  resetKey?: string | number | null;
  /** Text the draft starts with whenever `resetKey` changes, e.g. "About: Maple Court". */
  initialValue?: string;
}) {
  const [value, setValue] = useState(initialValue);
  const [busy, setBusy] = useState(false);
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setValue(initialValue);
    setBusy(false);
    // A prefilled draft ("About: Maple Court") is an invitation to write:
    // put the cursor after it.
    if (!initialValue) return;
    const frame = requestAnimationFrame(() => {
      const field = fieldRef.current;
      if (!field || field.disabled) return;
      field.focus();
      field.setSelectionRange(field.value.length, field.value.length);
    });
    return () => cancelAnimationFrame(frame);
  }, [resetKey, initialValue]);

  const body = value.trim();
  // Only the prefill (e.g. just the "About:" line) is nothing to send yet.
  const nothingToSend = !body || (initialValue.trim() !== "" && body === initialValue.trim());

  async function submit() {
    if (nothingToSend || disabled || busy || !onSend) return;
    setBusy(true);
    try {
      await onSend(body, showVisibility ? visibility : "tenant_visible");
      setValue("");
    } catch {
      // Keep draft; caller reports via setError banner.
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-2 border-t border-border bg-card px-4 py-3",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <textarea
          ref={fieldRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          disabled={disabled || busy}
          rows={2}
          className="min-h-11 min-w-0 flex-1 resize-none rounded-md border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:opacity-50"
          aria-label={placeholder}
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
          className="min-h-11 min-w-16 rounded-md px-3.5"
          disabled={disabled || busy || nothingToSend}
          onClick={() => void submit()}
        >
          Send
        </Button>
      </div>
      {showVisibility ? (
        <div className="flex items-center gap-2">
          <Select
            value={visibility}
            onValueChange={(v) => onVisibilityChange?.(v as CommentVisibility)}
            disabled={disabled || busy}
          >
            <SelectTrigger className="h-7 w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="internal">Internal</SelectItem>
              <SelectItem value="tenant_visible">Visible to tenant</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">
            {visibility === "internal"
              ? "Staff only — tenants and landlords will not see this."
              : "Visible to the tenant (and landlord) on this request."}
          </p>
        </div>
      ) : null}
    </div>
  );
}
