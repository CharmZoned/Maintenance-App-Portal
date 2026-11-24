import { useId } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Note } from "./complete-job-dialog";

/**
 * A short dialog that needs one written reason before its action runs:
 * worker "Release job" and tenant "Still a problem". The save error shows in
 * the dialog (role=alert) so it is read where the person is looking.
 */
export const NOTE_MAX = 1000;

export function NoteDialog({
  open,
  onOpenChange,
  title,
  description,
  label,
  hint,
  placeholder,
  value,
  onChange,
  primaryLabel,
  primaryVariant = "default",
  error,
  busy,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  label: string;
  hint?: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  primaryLabel: string;
  primaryVariant?: "default" | "destructive";
  error: string | null;
  busy: boolean;
  onSubmit: () => void;
}) {
  const fieldId = useId();
  const hintId = useId();
  const errorId = useId();
  const ready = value.trim().length > 0 && value.trim().length <= NOTE_MAX;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[420px] max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:max-w-none max-md:rounded-b-none">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (ready && !busy) onSubmit();
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor={fieldId}>{label}</Label>
            <Textarea
              id={fieldId}
              rows={3}
              maxLength={NOTE_MAX}
              value={value}
              placeholder={placeholder}
              onChange={(e) => onChange(e.target.value)}
              aria-describedby={[hint ? hintId : "", error ? errorId : ""].filter(Boolean).join(" ") || undefined}
            />
            {hint ? (
              <p id={hintId} className="text-xs leading-4 text-muted-foreground">
                {hint}
              </p>
            ) : null}
          </div>
          {error ? (
            <div id={errorId} role="alert">
              <Note tone="error">{error}</Note>
            </div>
          ) : null}
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="ghost"
              size="touch"
              className="w-full md:h-7 md:w-auto md:px-2"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant={primaryVariant}
              size="touch"
              className="w-full md:h-7 md:w-auto md:px-2"
              disabled={!ready || busy}
            >
              {busy ? "Saving…" : primaryLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
