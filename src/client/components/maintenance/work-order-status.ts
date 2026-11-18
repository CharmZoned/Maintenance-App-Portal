import type { WorkOrderStatus } from "@/types";

export const PRIORITIES = [
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
] as const;

export const ADMIN_STATUSES: { value: WorkOrderStatus; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "scheduled", label: "Scheduled" },
  { value: "in_progress", label: "In progress" },
  { value: "on_hold", label: "On hold" },
  { value: "closed", label: "Closed" },
];

/** Cap shared by create / edit / media upload file pickers (matches DB trigger). */
export const MAX_MAINTENANCE_PHOTOS = 5;

/**
 * The DB keeps two caps of MAX_MAINTENANCE_PHOTOS per request: photos uploaded by
 * the worker, and photos from everyone else. A tenant's photos must not use up
 * the room a worker needs for the required completion photo.
 */
export function photoSlotsLeft(
  photos: { uploaded_by_role: string | null }[],
  uploaderIsWorker: boolean,
): number {
  const used = photos.filter((p) => (p.uploaded_by_role === "maintenance") === uploaderIsWorker).length;
  return Math.max(0, MAX_MAINTENANCE_PHOTOS - used);
}

/** Take up to `remaining` files (default full cap). Use remaining slots when adding after existing photos. */
export function takePhotoFiles(
  files: FileList | File[] | null | undefined,
  remaining: number = MAX_MAINTENANCE_PHOTOS,
): File[] {
  return Array.from(files ?? []).slice(0, Math.max(0, remaining));
}

/** Staff status dropdown — include In progress when work can start (assigned or already past Open). */
export function staffStatusOptions(canStartWork: boolean): { value: WorkOrderStatus; label: string }[] {
  return canStartWork
    ? [
        { value: "open", label: "Open" },
        { value: "in_progress", label: "In progress" },
        { value: "on_hold", label: "On hold" },
        { value: "closed", label: "Closed" },
      ]
    : [
        { value: "open", label: "Open" },
        { value: "on_hold", label: "On hold" },
        { value: "closed", label: "Closed" },
      ];
}
