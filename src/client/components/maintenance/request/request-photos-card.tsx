import { Plus } from "lucide-react";
import type { MaintenancePhoto } from "@/types";

/**
 * Photos card (Figma "UPGRADED — Request" Photos; brief N3 Photos).
 * Thumbnails that open full size, "2 of 5" count, add tile while slots remain.
 *
 * Data: listMaintenancePhotos(id) (signed URLs, oldest first).
 * Slots: photoSlotsLeft(photos, uploaderIsWorker) from work-order-status.ts —
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
  /** Files picked from the add tile (caller trims with takePhotoFiles). */
  onAdd?: (files: FileList) => void;
  /** Tap-to-enlarge; the lightbox itself belongs to the page. */
  onOpenPhoto?: (photo: MaintenancePhoto, index: number) => void;
}

export function RequestPhotosCard({
  photos,
  max,
  slotsLeft,
  canAdd,
  uploading = false,
  onAdd,
  onOpenPhoto,
}: RequestPhotosCardProps) {
  const showAdd = canAdd && slotsLeft > 0 && Boolean(onAdd);
  return (
    <section className="rounded-md border border-border bg-card p-4" aria-labelledby="request-photos-heading">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="request-photos-heading" className="text-sm font-semibold text-foreground">
          Photos
        </h2>
        <span className="text-xs text-muted-foreground">
          {Math.min(photos.length, max)} of {max}
        </span>
      </div>
      <ul className="mt-3 flex flex-wrap gap-2">
        {photos.map((photo, index) => (
          <li key={photo.id}>
            <button
              type="button"
              disabled={!photo.url || !onOpenPhoto}
              onClick={() => onOpenPhoto?.(photo, index)}
              className="block size-[72px] overflow-hidden rounded-md bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/40"
              aria-label={photo.caption?.trim() || `Photo ${index + 1}`}
            >
              {photo.url ? (
                <img src={photo.url} alt="" className="size-full object-cover" />
              ) : (
                <span className="text-[10px] text-muted-foreground">Photo {index + 1}</span>
              )}
            </button>
          </li>
        ))}
        {showAdd ? (
          <li>
            <label className="flex size-[72px] cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border text-xs text-muted-foreground hover:bg-muted">
              <input
                type="file"
                accept="image/*"
                multiple
                className="sr-only"
                disabled={uploading}
                onChange={(e) => {
                  if (e.target.files?.length) onAdd?.(e.target.files);
                  e.target.value = "";
                }}
              />
              <Plus className="size-4" aria-hidden />
              {uploading ? "Uploading…" : "Add"}
            </label>
          </li>
        ) : null}
      </ul>
      {photos.length === 0 && !showAdd ? (
        <p className="mt-2 text-sm text-muted-foreground">No photos yet.</p>
      ) : null}
    </section>
  );
}
