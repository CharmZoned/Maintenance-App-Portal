import { useRef, useState } from "react";
import { ImageIcon, Upload, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { requestStatusFromDb } from "@/lib/request-status";
import { formatDate } from "@/lib/utils";
import type {
  CommentVisibility,
  MaintenanceComment,
  MaintenancePhoto,
  MaintenanceStatusEvent,
} from "@/types";
import { PhotoLightbox } from "./request/photo-lightbox";
import { MAX_MAINTENANCE_PHOTOS, takePhotoFiles } from "./work-order-status";

interface PhotoPreview {
  file: File;
  url: string;
}

export interface WorkOrderMediaPanelProps {
  detailLoading: boolean;
  photos: MaintenancePhoto[];
  history: MaintenanceStatusEvent[];
  comments: MaintenanceComment[];
  photoFiles: File[];
  photoPreviews: PhotoPreview[];
  /** How many more photos may be added (cap minus existing). */
  remainingPhotoSlots?: number;
  onPhotoFilesChange: (files: File[]) => void;
  onUploadPhotos: () => void;
  commentBody: string;
  onCommentBodyChange: (body: string) => void;
  commentVisibility: CommentVisibility;
  onCommentVisibilityChange: (v: CommentVisibility) => void;
  onPostComment: () => void;
  isTenant: boolean;
  isLandlord: boolean;
}

/**
 * Photos, status history, and comments inside the legacy work-order dialog.
 * Photos: 72px thumbnails that open the shared PhotoLightbox, and a styled
 * "Add photos" button over a hidden file input (no raw browser picker); picked
 * files are staged with a remove "x" until "Upload n photos".
 */
export function WorkOrderMediaPanel({
  detailLoading,
  photos,
  history,
  comments,
  photoFiles,
  photoPreviews,
  remainingPhotoSlots = MAX_MAINTENANCE_PHOTOS,
  onPhotoFilesChange,
  onUploadPhotos,
  commentBody,
  onCommentBodyChange,
  commentVisibility,
  onCommentVisibilityChange,
  onPostComment,
  isTenant,
  isLandlord,
}: WorkOrderMediaPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const thumbRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  return (
    <>
      <div className="border-t pt-3">
        <div className="flex items-center justify-between gap-2">
          <Label>Photos</Label>
          {!detailLoading && (
            <span className="text-xs text-muted-foreground">
              {isLandlord
                ? `${photos.length} ${photos.length === 1 ? "photo" : "photos"}`
                : remainingPhotoSlots > 0
                  ? `${MAX_MAINTENANCE_PHOTOS - remainingPhotoSlots} of ${MAX_MAINTENANCE_PHOTOS} · ${remainingPhotoSlots} more can be added`
                  : `${MAX_MAINTENANCE_PHOTOS} of ${MAX_MAINTENANCE_PHOTOS}`}
            </span>
          )}
        </div>
        {detailLoading ? (
          <div className="mt-2 flex gap-2" aria-hidden>
            <div className="size-[72px] rounded-sm bg-muted" />
            <div className="size-[72px] rounded-sm bg-muted" />
          </div>
        ) : photos.length === 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">No photos yet.</p>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-2">
            {photos.map((p, index) => (
              <li key={p.id}>
                <button
                  ref={(el) => {
                    thumbRefs.current[index] = el;
                  }}
                  type="button"
                  onClick={() => setOpenIndex(index)}
                  className="relative block size-[72px] overflow-hidden rounded-sm border border-border bg-muted outline-none hover:opacity-90 focus-visible:ring-[3px] focus-visible:ring-ring/40"
                  aria-label={`Open photo ${index + 1} of ${photos.length}`}
                >
                  <span className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                    <ImageIcon className="size-5" aria-hidden />
                  </span>
                  {p.url ? (
                    <img
                      src={p.url}
                      alt={p.caption || "Maintenance photo"}
                      loading="lazy"
                      className="absolute inset-0 size-full object-cover"
                      onError={(e) => {
                        e.currentTarget.style.display = "none";
                      }}
                    />
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        )}
        <PhotoLightbox
          photos={photos}
          index={openIndex}
          onIndexChange={setOpenIndex}
          returnFocusTo={(index) => thumbRefs.current[index]}
        />
        {!isLandlord && remainingPhotoSlots > 0 && (
          <div className="mt-2 space-y-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              tabIndex={-1}
              aria-hidden
              className="sr-only"
              data-testid="work-order-photos-input"
              onChange={(e) => {
                onPhotoFilesChange(takePhotoFiles([...photoFiles, ...Array.from(e.target.files ?? [])], remainingPhotoSlots));
                e.target.value = "";
              }}
            />
            {photoPreviews.length > 0 && (
              <ul className="flex flex-wrap gap-2">
                {photoPreviews.map((p) => (
                  <li key={p.url} className="relative">
                    <img
                      src={p.url}
                      alt={p.file.name}
                      className="size-16 rounded-sm border border-border object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => onPhotoFilesChange(photoFiles.filter((f) => f !== p.file))}
                      className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-raised hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 outline-none"
                      aria-label={`Remove ${p.file.name}`}
                    >
                      <X className="size-3" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {photoFiles.length < remainingPhotoSlots && (
                <Button type="button" size="sm" variant="secondary" onClick={() => fileInputRef.current?.click()}>
                  <Upload aria-hidden />
                  Add photos
                </Button>
              )}
              {photoFiles.length > 0 && (
                <Button type="button" size="sm" variant="secondary" onClick={() => onUploadPhotos()}>
                  Upload {photoFiles.length} photo{photoFiles.length === 1 ? "" : "s"}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="border-t pt-3">
        <Label>Status history</Label>
        {history.length === 0 ? (
          <p className="text-xs text-muted-foreground">No status changes yet.</p>
        ) : (
          <ul className="mt-2 space-y-1.5 text-xs">
            {history.map((h) => (
              <li key={h.id} className="flex flex-wrap gap-x-2 text-muted-foreground">
                <span className="font-medium text-foreground">
                  {h.from_status
                    ? `${requestStatusFromDb(h.from_status)} → ${requestStatusFromDb(h.to_status)}`
                    : requestStatusFromDb(h.to_status)}
                </span>
                <span>{formatDate(h.created_at)}</span>
                {h.changed_by_role && <span>· {h.changed_by_role}</span>}
                {h.note && <span>· {h.note}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-t pt-3">
        <Label>Comments</Label>
        {comments.length === 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">No comments yet.</p>
        ) : (
          <ul className="mt-2 space-y-2 text-sm">
            {comments.map((c) => (
              <li key={c.id} className="rounded border px-3 py-2">
                <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  <span>{c.author_role ?? "user"}</span>
                  {!isTenant && (
                    <Badge variant="outline">
                      {c.visibility === "internal" ? "Internal" : "Tenant visible"}
                    </Badge>
                  )}
                  <span>{formatDate(c.created_at)}</span>
                </div>
                <p className="whitespace-pre-wrap">{c.body}</p>
              </li>
            ))}
          </ul>
        )}
        {!isLandlord && (
          <div className="mt-2 grid gap-2">
            <Textarea
              value={commentBody}
              onChange={(e) => onCommentBodyChange(e.target.value)}
              rows={2}
              placeholder={isTenant ? "Message staff…" : "Add a comment…"}
            />
            <div className="flex flex-wrap items-center gap-2">
              {!isTenant && (
                <Select
                  value={commentVisibility}
                  onValueChange={(v) => onCommentVisibilityChange(v as CommentVisibility)}
                >
                  <SelectTrigger className="w-[180px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="tenant_visible">Tenant visible</SelectItem>
                    <SelectItem value="internal">Internal</SelectItem>
                  </SelectContent>
                </Select>
              )}
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => onPostComment()}
                disabled={!commentBody.trim()}
              >
                {isTenant ? "Send message" : "Post comment"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
