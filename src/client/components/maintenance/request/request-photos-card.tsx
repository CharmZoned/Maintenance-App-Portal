import { useRef, useState, type DragEvent } from "react";
import { ImageIcon, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { MaintenancePhoto } from "@/types";
import { PhotoLightbox } from "./photo-lightbox";

/**
 * Photos card (Figma "UPGRADED — Request" Photos; spec §2.3).
 *
 *   Photos                                   2 of 5 · 3 more can be added
 *   [96×96] [96×96] [ + Add photos ]
 *
 * Thumbnails are buttons that open the lightbox (built in, or the page's own via
 * `onOpenPhoto`). The dashed add tile opens a hidden file input, so a raw
 * browser file picker is never shown; it also accepts dropped images.
 *
 * Data: listMaintenancePhotos(id) (signed URLs, oldest first).
 * Slots: photoSlotsLeft(photos, viewerIsWorker) from work-order-status.ts —
 * the DB caps worker photos and everyone else's photos separately at 5 each.
 */
export interface RequestPhotosCardProps {
  photos: MaintenancePhoto[];
  /** Cap shown in "n of max" — MAX_MAINTENANCE_PHOTOS. */
  max: number;
  /** Slots left for THIS viewer (photoSlotsLeft). Add tile hides at 0. */
  slotsLeft: number;
  /** From sectionsForRole(role).addPhotos. */
  canAdd: boolean;
  uploading?: boolean;
  /** Files picked from (or dropped on) the add tile; the caller trims with takePhotoFiles and uploads. */
  onAdd?: (files: FileList) => void;
  /**
   * Tap-to-enlarge handled by the page. Leave unset to use the card's own
   * lightbox (PhotoLightbox: arrows, Esc, swipe, focus back to the thumbnail).
   */
  onOpenPhoto?: (photo: MaintenancePhoto, index: number) => void;
  /** Uploader's display name for the lightbox caption ("Added by Tina Renter · Sat 14 Nov"). */
  uploaderName?: (photo: MaintenancePhoto) => string | null | undefined;
  /** Photos still loading: two bone squares instead of thumbnails. */
  loading?: boolean;
  /** Listing the photos failed; shows a short message and Retry when `onRetry` is given. */
  loadError?: string | null;
  onRetry?: () => void;
  className?: string;
}

/**
 * Counter copy (spec §2.3, adjusted after review). The first number always
 * matches the thumbnails on screen.
 *   - Viewer can add: "{total} of 5 · {left} more can be added", or "5 of 5"
 *     when full. The DB caps the worker's photos and everyone else's photos
 *     separately, so when photos from the other group are on screen the
 *     "of 5" would not add up: then it reads "{total} photos · {left} more can
 *     be added" (e.g. a tenant seeing their own photo and the worker's).
 *   - Viewer cannot add (landlord): "{total} of 5", or "{total} photos" past the cap.
 */
export function photosCounterLabel(opts: { total: number; max: number; slotsLeft: number; canAdd: boolean }): string {
  const { total, max, canAdd } = opts;
  const noun = total === 1 ? "photo" : "photos";
  if (canAdd) {
    const left = Math.max(0, Math.min(max, opts.slotsLeft));
    const fromMyGroup = max - left;
    if (left === 0) return total === max ? `${max} of ${max}` : `${total} ${noun}`;
    return total === fromMyGroup
      ? `${total} of ${max} · ${left} more can be added`
      : `${total} ${noun} · ${left} more can be added`;
  }
  return total <= max ? `${total} of ${max}` : `${total} ${noun}`;
}

function onlyImages(files: FileList): FileList | null {
  if (typeof DataTransfer === "undefined") return files;
  const dt = new DataTransfer();
  for (const file of Array.from(files)) if (file.type.startsWith("image/")) dt.items.add(file);
  return dt.files.length > 0 ? dt.files : null;
}

export function RequestPhotosCard({
  photos,
  max,
  slotsLeft,
  canAdd,
  uploading = false,
  onAdd,
  onOpenPhoto,
  uploaderName,
  loading = false,
  loadError = null,
  onRetry,
  className,
}: RequestPhotosCardProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const thumbRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const showAdd = canAdd && slotsLeft > 0 && Boolean(onAdd) && !loading && !loadError;
  const total = photos.length;

  function openPhoto(photo: MaintenancePhoto, index: number) {
    if (onOpenPhoto) onOpenPhoto(photo, index);
    else setOpenIndex(index);
  }

  function onDrop(e: DragEvent<HTMLButtonElement>) {
    e.preventDefault();
    setDragOver(false);
    if (uploading || !e.dataTransfer.files.length) return;
    const images = onlyImages(e.dataTransfer.files);
    if (images) onAdd?.(images);
  }

  return (
    <section
      className={cn("rounded-md border border-border bg-card p-4 md:p-5", className)}
      aria-labelledby="request-photos-heading"
      aria-busy={loading || uploading || undefined}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id="request-photos-heading" className="text-[17px] leading-[22px] font-semibold text-foreground">
          Photos
        </h2>
        {!loading && !loadError ? (
          <span className="text-right text-sm leading-5 text-muted-foreground">
            {photosCounterLabel({ total, max, slotsLeft, canAdd })}
          </span>
        ) : null}
      </div>

      {loading ? (
        <div className="mt-4 flex gap-3" aria-hidden>
          <div className="size-24 rounded-sm bg-muted" />
          <div className="size-24 rounded-sm bg-muted" />
        </div>
      ) : loadError ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <p className="text-sm leading-5 text-muted-foreground">We couldn&rsquo;t load the photos.</p>
          {onRetry ? (
            <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
              <RefreshCw aria-hidden />
              Retry
            </Button>
          ) : null}
        </div>
      ) : total === 0 && !showAdd ? (
        <p className="mt-4 text-sm leading-5 text-muted-foreground">No photos yet.</p>
      ) : (
        <ul className="mt-4 flex flex-wrap gap-3">
          {photos.map((photo, index) => (
            <li key={photo.id}>
              <button
                ref={(el) => {
                  thumbRefs.current[index] = el;
                }}
                type="button"
                onClick={() => openPhoto(photo, index)}
                className="relative block size-24 overflow-hidden rounded-sm border border-border bg-muted outline-none transition-opacity duration-150 hover:opacity-90 focus-visible:ring-[3px] focus-visible:ring-ring/40"
                aria-label={`Open photo ${index + 1} of ${total}`}
                title={photo.caption?.trim() || undefined}
              >
                <span className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                  <ImageIcon className="size-6" aria-hidden />
                </span>
                {photo.url ? <Thumbnail key={photo.url} url={photo.url} /> : null}
              </button>
            </li>
          ))}
          {showAdd ? (
            <li>
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
                  "flex size-24 flex-col items-center justify-center gap-1.5 rounded-sm border border-dashed border-input bg-card text-muted-foreground outline-none transition-colors duration-150",
                  "hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-60",
                  dragOver && "border-ring bg-muted text-foreground",
                )}
              >
                <Plus className="size-5" aria-hidden />
                <span className="text-xs leading-4 font-medium">{uploading ? "Uploading…" : "Add photos"}</span>
              </button>
              <input
                ref={inputRef}
                type="file"
                accept="image/*"
                multiple
                tabIndex={-1}
                aria-hidden
                className="sr-only"
                data-testid="request-photos-input"
                disabled={uploading}
                onChange={(e) => {
                  if (e.target.files?.length) onAdd?.(e.target.files);
                  e.target.value = "";
                }}
              />
            </li>
          ) : null}
        </ul>
      )}

      {onOpenPhoto ? null : (
        <PhotoLightbox
          photos={photos}
          index={openIndex}
          onIndexChange={setOpenIndex}
          uploaderName={uploaderName}
          returnFocusTo={(index) => thumbRefs.current[index]}
        />
      )}
    </section>
  );
}

/** The thumbnail image over the placeholder icon; hidden again if it fails to load. */
function Thumbnail({ url }: { url: string }) {
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
