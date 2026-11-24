import { useRef, useState, type DragEvent } from "react";
import { CircleAlert, ImageIcon, Loader2, Plus, RotateCcw, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The 96×96 photo tiles shared by the Photos card and the Mark completed
 * dialog: an add tile, an in-flight upload, and an upload that failed.
 *
 * A failed upload is never shown as a normal photo: it reads "Upload failed"
 * with a Retry button, so nobody mistakes it for proof of the work.
 */

/** A file the viewer picked in this session that is uploading or failed to upload. */
export interface PendingPhoto {
  key: string;
  /** File name, for the accessible label. */
  name: string;
  /** Local object URL for the preview, or null. */
  previewUrl: string | null;
  status: "uploading" | "failed";
}

const TILE = "relative block size-24 shrink-0 overflow-hidden rounded-sm border";
const FOCUS = "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40";

export function PhotoImage({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className="absolute inset-0 size-full object-cover"
    />
  );
}

/** A file on its way up: preview under a spinner. */
export function UploadingTile({ photo }: { photo: PendingPhoto }) {
  return (
    <div className={cn(TILE, "border-border bg-muted")} role="status" aria-label={`Uploading ${photo.name}`}>
      {photo.previewUrl ? <PhotoImage url={photo.previewUrl} /> : null}
      <span className="absolute inset-0 flex items-center justify-center bg-background/60">
        <Loader2 className="size-5 animate-spin text-foreground motion-reduce:animate-none" aria-hidden />
      </span>
    </div>
  );
}

/**
 * "Upload failed" with Retry (and an optional remove). Used for a file that
 * failed in this session and for a saved photo whose file never arrived.
 */
export function FailedTile({
  label,
  previewUrl,
  onRetry,
  onRemove,
  retryLabel = "Retry",
  disabled,
}: {
  /** Accessible name of the photo, e.g. "photo.jpg" or "Photo 2". */
  label: string;
  previewUrl?: string | null;
  /** Omit when the viewer cannot retry (someone else's upload). */
  onRetry?: () => void;
  onRemove?: () => void;
  retryLabel?: string;
  disabled?: boolean;
}) {
  return (
    <div
      className={cn(TILE, "flex flex-col items-center justify-center gap-1 border-destructive/40 bg-destructive-tint p-1.5")}
      role="group"
      aria-label={`${label}: upload failed`}
    >
      {previewUrl ? (
        <span className="absolute inset-0 opacity-25" aria-hidden>
          <PhotoImage url={previewUrl} />
        </span>
      ) : null}
      <CircleAlert className="relative size-4 text-destructive" aria-hidden />
      <span className="relative text-center text-[11px] font-medium leading-[14px] text-destructive">Upload failed</span>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          disabled={disabled}
          className={cn(
            "relative inline-flex min-h-7 items-center gap-1 rounded-xs bg-card px-2 text-xs font-medium leading-4 text-foreground shadow-edge",
            "hover:bg-muted disabled:pointer-events-none disabled:opacity-50",
            FOCUS,
          )}
          aria-label={`${retryLabel} ${label}`}
        >
          <RotateCcw className="size-3" aria-hidden />
          {retryLabel}
        </button>
      ) : null}
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          aria-label={`Remove ${label}`}
          className={cn(
            "absolute right-0.5 top-0.5 flex size-7 items-center justify-center rounded-xs text-muted-foreground hover:text-foreground disabled:opacity-50",
            FOCUS,
          )}
        >
          <X className="size-3.5" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

/** A saved photo with no image yet (still signing): the placeholder icon. */
export function PhotoPlaceholder() {
  return (
    <span className="absolute inset-0 flex items-center justify-center text-muted-foreground">
      <ImageIcon className="size-6" aria-hidden />
    </span>
  );
}

function onlyImages(files: FileList): File[] {
  return Array.from(files).filter((file) => file.type.startsWith("image/"));
}

/** Dashed "+ Add photo(s)" tile with its hidden file input; also takes dropped images. */
export function AddPhotoTile({
  label = "Add photos",
  multiple = true,
  uploading = false,
  onFiles,
  testId,
}: {
  label?: string;
  multiple?: boolean;
  uploading?: boolean;
  onFiles: (files: File[]) => void;
  testId?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  function onDrop(e: DragEvent<HTMLButtonElement>) {
    e.preventDefault();
    setDragOver(false);
    if (uploading || !e.dataTransfer.files.length) return;
    const images = onlyImages(e.dataTransfer.files);
    if (images.length) onFiles(images);
  }

  return (
    <>
      <button
        type="button"
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          if (uploading) return;
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={cn(
          "flex size-24 flex-col items-center justify-center gap-1.5 rounded-sm border border-dashed border-input bg-card text-muted-foreground transition-colors duration-150",
          "hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-60",
          FOCUS,
          dragOver && "border-ring bg-muted text-foreground",
        )}
      >
        <Plus className="size-5" aria-hidden />
        <span className="text-xs font-medium leading-4">{uploading ? "Uploading…" : label}</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple={multiple}
        tabIndex={-1}
        aria-hidden
        className="sr-only"
        data-testid={testId}
        disabled={uploading}
        onChange={(e) => {
          if (e.target.files?.length) onFiles(Array.from(e.target.files));
          e.target.value = "";
        }}
      />
    </>
  );
}

/** Opens a picker for one image and hands it over (Retry on a saved photo whose file is missing). */
export function useSinglePhotoPicker(onFile: (file: File) => void) {
  const inputRef = useRef<HTMLInputElement>(null);
  const input = (
    <input
      ref={inputRef}
      type="file"
      accept="image/*"
      tabIndex={-1}
      aria-hidden
      className="sr-only"
      onChange={(e) => {
        const file = e.target.files?.[0];
        if (file) onFile(file);
        e.target.value = "";
      }}
    />
  );
  return { input, open: () => inputRef.current?.click() };
}
