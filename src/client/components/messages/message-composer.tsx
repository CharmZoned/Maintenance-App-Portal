import { useState } from "react";
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
}: {
  disabled?: boolean;
  placeholder?: string;
  /** Staff/admin: Internal vs Tenant visible (default Internal). */
  showVisibility?: boolean;
  visibility?: CommentVisibility;
  onVisibilityChange?: (v: CommentVisibility) => void;
  onSend?: (body: string, visibility: CommentVisibility) => Promise<void> | void;
  className?: string;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    const body = value.trim();
    if (!body || disabled || busy || !onSend) return;
    setBusy(true);
    try {
      await onSend(body, showVisibility ? visibility : "tenant_visible");
      setValue("");
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
