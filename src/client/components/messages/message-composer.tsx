import { useEffect, useId, useState } from "react";
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
  maxLength,
  showSendError = false,
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
  /**
   * Longest message the thread accepts, in characters. Over the limit the
   * draft is kept, Send is off, and a line under the field says why.
   */
  maxLength?: number;
  /** Show a failed send under the field (draft kept) instead of leaving it to the caller's banner. */
  showSendError?: boolean;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const hintId = useId();

  useEffect(() => {
    setValue("");
    setBusy(false);
    setSendError(null);
  }, [resetKey]);

  // Counted the way the database counts (characters, not UTF-16 units), after trimming.
  const length = maxLength == null ? 0 : Array.from(value.trim()).length;
  const over = maxLength != null && length > maxLength;
  const nearLimit = maxLength != null && length >= Math.floor(maxLength * 0.9);
  const limitHint =
    maxLength == null || !nearLimit
      ? null
      : over
        ? `Messages can be up to ${maxLength.toLocaleString("en-US")} characters. Shorten this one by ${(length - maxLength).toLocaleString("en-US")} to send it.`
        : `${length.toLocaleString("en-US")} of ${maxLength.toLocaleString("en-US")} characters.`;

  async function submit() {
    const body = value.trim();
    if (!body || disabled || busy || over || !onSend) return;
    setBusy(true);
    setSendError(null);
    try {
      await onSend(body, showVisibility ? visibility : "tenant_visible");
      setValue("");
    } catch (err) {
      // Keep draft; shown below when showSendError, else the caller's banner reports it.
      if (showSendError) setSendError((err as Error)?.message || "Something went wrong.");
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
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (sendError) setSendError(null);
          }}
          placeholder={placeholder}
          disabled={disabled || busy}
          rows={2}
          className="min-h-11 min-w-0 flex-1 resize-none rounded-md border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:opacity-50"
          aria-label={placeholder}
          aria-invalid={over || undefined}
          aria-describedby={limitHint ? hintId : undefined}
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
          disabled={disabled || busy || over || !value.trim()}
          onClick={() => void submit()}
        >
          Send
        </Button>
      </div>
      {limitHint ? (
        <p
          id={hintId}
          aria-live="polite"
          className={cn("text-xs", over ? "text-destructive" : "text-muted-foreground")}
        >
          {limitHint}
        </p>
      ) : null}
      {sendError ? (
        <p role="alert" className="text-xs text-destructive">
          Not sent — your message is still here, so you can try again. {sendError}
        </p>
      ) : null}
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
