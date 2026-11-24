import { useMemo, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { MaintenancePhoto } from "@/types";
import { PhotoLightbox } from "./photo-lightbox";
import {
  AddPhotoTile,
  FailedTile,
  PhotoImage,
  PhotoPlaceholder,
  UploadingTile,
  useSinglePhotoPicker,
  type PendingPhoto,
} from "./photo-tiles";

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
  onAdd?: (files: File[]) => void;
  /** This session's uploads still in flight or failed ("Upload failed — Retry"). */
  pending?: PendingPhoto[];
  onRetryPending?: (key: string) => void;
  onDiscardPending?: (key: string) => void;
  /**
   * A saved photo whose file never arrived (`missing`): the viewer may upload it
   * again when this returns true (their own upload). Others see "Upload failed".
   */
  canRetryMissing?: (photo: MaintenancePhoto) => boolean;
  onRetryMissing?: (photo: MaintenancePhoto, file: File) => void;
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

export function RequestPhotosCard({
  photos,
  max,
  slotsLeft,
  canAdd,
  uploading = false,
  onAdd,
  pending = [],
  onRetryPending,
  onDiscardPending,
  canRetryMissing,
  onRetryMissing,
  onOpenPhoto,
  uploaderName,
  loading = false,
  loadError = null,
  onRetry,
  className,
}: RequestPhotosCardProps) {
  const thumbRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const retryTarget = useRef<MaintenancePhoto | null>(null);
  const picker = useSinglePhotoPicker((file) => {
    if (retryTarget.current) onRetryMissing?.(retryTarget.current, file);
    retryTarget.current = null;
  });

  const showAdd = canAdd && slotsLeft > 0 && Boolean(onAdd) && !loading && !loadError;
  // A saved row whose file never arrived is not a photo anyone can open.
  const viewable = useMemo(() => photos.filter((p) => !p.missing), [photos]);
  const broken = useMemo(() => photos.filter((p) => p.missing), [photos]);
  const total = photos.length;

  function openPhoto(photo: MaintenancePhoto, index: number) {
    if (onOpenPhoto) onOpenPhoto(photo, index);
    else setOpenIndex(index);
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
      ) : total === 0 && pending.length === 0 && !showAdd ? (
        <p className="mt-4 text-sm leading-5 text-muted-foreground">No photos yet.</p>
      ) : (
        <ul className="mt-4 flex flex-wrap gap-3">
          {viewable.map((photo, index) => (
            <li key={photo.id}>
              <button
                ref={(el) => {
                  thumbRefs.current[index] = el;
                }}
                type="button"
                onClick={() => openPhoto(photo, index)}
                className="relative block size-24 overflow-hidden rounded-sm border border-border bg-muted outline-none transition-opacity duration-150 hover:opacity-90 focus-visible:ring-[3px] focus-visible:ring-ring/40"
                aria-label={`Open photo ${index + 1} of ${viewable.length}`}
                title={photo.caption?.trim() || undefined}
              >
                <PhotoPlaceholder />
                {photo.url ? <PhotoImage key={photo.url} url={photo.url} /> : null}
              </button>
            </li>
          ))}
          {broken.map((photo) => {
            const canRetry = Boolean(onRetryMissing && canRetryMissing?.(photo));
            return (
              <li key={photo.id}>
                <FailedTile
                  label={photo.caption?.trim() || "Photo"}
                  disabled={uploading}
                  onRetry={
                    canRetry
                      ? () => {
                          retryTarget.current = photo;
                          picker.open();
                        }
                      : undefined
                  }
                />
              </li>
            );
          })}
          {pending.map((item) => (
            <li key={item.key}>
              {item.status === "uploading" ? (
                <UploadingTile photo={item} />
              ) : (
                <FailedTile
                  label={item.name}
                  previewUrl={item.previewUrl}
                  onRetry={onRetryPending ? () => onRetryPending(item.key) : undefined}
                  onRemove={onDiscardPending ? () => onDiscardPending(item.key) : undefined}
                />
              )}
            </li>
          ))}
          {showAdd && onAdd ? (
            <li>
              <AddPhotoTile uploading={uploading} onFiles={onAdd} testId="request-photos-input" />
            </li>
          ) : null}
        </ul>
      )}
      {onRetryMissing && broken.some((p) => canRetryMissing?.(p)) ? picker.input : null}

      {onOpenPhoto ? null : (
        <PhotoLightbox
          photos={viewable}
          index={openIndex}
          onIndexChange={setOpenIndex}
          uploaderName={uploaderName}
          returnFocusTo={(index) => thumbRefs.current[index]}
        />
      )}
    </section>
  );
}
