import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/lib/utils";
import type {
  CommentVisibility,
  MaintenanceComment,
  MaintenancePhoto,
  MaintenanceStatusEvent,
} from "@/types";
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

/** Photos, status history, and comments — shared by staff edit and tenant/landlord detail. */
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
  return (
    <>
      <div className="border-t pt-3">
        <Label>Photos</Label>
        {detailLoading ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : photos.length === 0 ? (
          <p className="text-xs text-muted-foreground">No photos yet.</p>
        ) : (
          <div className="mt-2 grid grid-cols-3 gap-2">
            {photos.map((p) =>
              p.url ? (
                <a
                  key={p.id}
                  href={p.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block overflow-hidden rounded border"
                >
                  <img
                    src={p.url}
                    alt={p.caption || "Maintenance photo"}
                    className="aspect-square w-full object-cover"
                  />
                </a>
              ) : (
                <div
                  key={p.id}
                  className="flex aspect-square items-center justify-center rounded border bg-muted text-xs text-muted-foreground"
                >
                  Unavailable
                </div>
              ),
            )}
          </div>
        )}
        {!isLandlord && remainingPhotoSlots > 0 && (
          <div className="mt-2 space-y-2">
            <Input
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => onPhotoFilesChange(takePhotoFiles(e.target.files, remainingPhotoSlots))}
            />
            <p className="text-xs text-muted-foreground">
              Up to {remainingPhotoSlots} more (max {MAX_MAINTENANCE_PHOTOS} total).
            </p>
            {photoPreviews.length > 0 && (
              <div className="grid grid-cols-3 gap-2">
                {photoPreviews.map((p) => (
                  <img
                    key={p.url}
                    src={p.url}
                    alt={p.file.name}
                    className="aspect-square rounded border object-cover"
                  />
                ))}
              </div>
            )}
            {photoFiles.length > 0 && (
              <Button type="button" size="sm" variant="outline" onClick={() => onUploadPhotos()}>
                Upload {photoFiles.length} photo{photoFiles.length === 1 ? "" : "s"}
              </Button>
            )}
          </div>
        )}
        {!isLandlord && remainingPhotoSlots <= 0 && (
          <p className="mt-2 text-xs text-muted-foreground">Photo limit reached ({MAX_MAINTENANCE_PHOTOS}).</p>
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
                  {h.from_status ? `${h.from_status} → ${h.to_status}` : h.to_status}
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
