import { useId, type ReactNode } from "react";
import { CircleAlert, Info } from "lucide-react";
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
import type { MaintenancePhoto } from "@/types";
import { completionPhotoHint, type CompletionPhotoNeed } from "./completion-proof";
import { AddPhotoTile, FailedTile, PhotoImage, PhotoPlaceholder, UploadingTile, type PendingPhoto } from "./photo-tiles";

/**
 * Worker "Mark completed" (spec §2.5, audit UX-07).
 *
 *   Mark completed
 *   Kitchen faucet leaking · Unit 1A · Maple Court
 *
 *   Photo of the finished work
 *   ⓘ This job was reopened — add a photo of today's work.   (only when one is needed)
 *   [thumb] [Upload failed ↻] [+ Add photo]
 *
 *   What fixed it?  [............]
 *   ⚠ Couldn't mark it completed. …                          (role=alert)
 *                                   [Cancel] [Mark completed]
 *
 * "Add photo" is always offered, so a worker who was told a photo is missing
 * can fix it right here instead of hunting for the Photos card. Which photos
 * count is decided by completionProof() (the same rule as the server).
 */
export interface CompleteJobDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "Kitchen faucet leaking · Unit 1A · Maple Court". */
  context: string;
  notes: string;
  onNotesChange: (notes: string) => void;
  /** The viewer's photos that count as proof (completionProof().photos). */
  proofPhotos: MaintenancePhoto[];
  need: CompletionPhotoNeed;
  /** This session's uploads in flight or failed. */
  pending: PendingPhoto[];
  /** Worker photo slots left; the add tile hides at 0. */
  slotsLeft: number;
  uploading: boolean;
  onAddPhotos: (files: File[]) => void;
  onRetryPending: (key: string) => void;
  onDiscardPending: (key: string) => void;
  /** Why the last save failed, shown in the dialog (role=alert). */
  error: string | null;
  busy: boolean;
  onSubmit: () => void;
}

export function CompleteJobDialog({
  open,
  onOpenChange,
  context,
  notes,
  onNotesChange,
  proofPhotos,
  need,
  pending,
  slotsLeft,
  uploading,
  onAddPhotos,
  onRetryPending,
  onDiscardPending,
  error,
  busy,
  onSubmit,
}: CompleteJobDialogProps) {
  const notesId = useId();
  const photoHeadingId = useId();
  const hintId = useId();
  const errorId = useId();
  const hint = completionPhotoHint(need);
  const needsPhoto = need !== "none";
  const canSubmit = Boolean(notes.trim()) && !needsPhoto && !uploading;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[440px] max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:max-w-none max-md:rounded-b-none"
      >
        <DialogHeader>
          <DialogTitle>Mark completed</DialogTitle>
          {context ? <DialogDescription>{context}</DialogDescription> : null}
        </DialogHeader>
        <form
          className="grid gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit && !busy) onSubmit();
          }}
        >
          <section aria-labelledby={photoHeadingId} className="grid gap-2">
            <h3 id={photoHeadingId} className="text-sm font-medium leading-5 text-foreground">
              Photo of the finished work
            </h3>
            {hint ? (
              <Note id={hintId} tone={need === "first" ? "muted" : "warning"}>
                {hint}
              </Note>
            ) : null}
            <ul className="flex flex-wrap gap-3" aria-describedby={hint ? hintId : undefined}>
              {proofPhotos.map((photo, index) => (
                <li key={photo.id}>
                  <div
                    className="relative size-24 overflow-hidden rounded-sm border border-border bg-muted"
                    role="img"
                    aria-label={`Your photo ${index + 1}`}
                  >
                    <PhotoPlaceholder />
                    {photo.url ? <PhotoImage url={photo.url} /> : null}
                  </div>
                </li>
              ))}
              {pending.map((item) => (
                <li key={item.key}>
                  {item.status === "uploading" ? (
                    <UploadingTile photo={item} />
                  ) : (
                    <FailedTile
                      label={item.name}
                      previewUrl={item.previewUrl}
                      onRetry={() => onRetryPending(item.key)}
                      onRemove={() => onDiscardPending(item.key)}
                    />
                  )}
                </li>
              ))}
              {slotsLeft > 0 ? (
                <li>
                  <AddPhotoTile
                    label="Add photo"
                    uploading={uploading}
                    onFiles={onAddPhotos}
                    testId="complete-photo-input"
                  />
                </li>
              ) : null}
            </ul>
            {slotsLeft === 0 && needsPhoto ? (
              <p className="text-xs leading-4 text-muted-foreground">
                This job already has 5 work photos. Ask the office to remove one.
              </p>
            ) : null}
          </section>

          <div className="grid gap-1.5">
            <Label htmlFor={notesId}>What fixed it?</Label>
            <Textarea
              id={notesId}
              rows={3}
              value={notes}
              onChange={(e) => onNotesChange(e.target.value)}
              aria-describedby={error ? errorId : undefined}
            />
            <p className="text-xs leading-4 text-muted-foreground">Shown to the tenant and the landlord.</p>
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
              size="touch"
              className="w-full md:h-7 md:w-auto md:px-2"
              disabled={!canSubmit || busy}
            >
              {busy ? "Saving…" : "Mark completed"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** A one-line note with an icon: muted (info), warning, or error. */
export function Note({
  id,
  tone,
  children,
}: {
  id?: string;
  tone: "muted" | "warning" | "error";
  children: ReactNode;
}) {
  const Icon = tone === "muted" ? Info : CircleAlert;
  return (
    <p
      id={id}
      className={
        tone === "error"
          ? "flex items-start gap-2 rounded-sm bg-destructive-tint px-3 py-2 text-sm leading-5 text-destructive"
          : tone === "warning"
            ? "flex items-start gap-2 rounded-sm bg-warning-tint px-3 py-2 text-sm leading-5 text-warning"
            : "flex items-start gap-2 text-sm leading-5 text-muted-foreground"
      }
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span className="min-w-0">{children}</span>
    </p>
  );
}
