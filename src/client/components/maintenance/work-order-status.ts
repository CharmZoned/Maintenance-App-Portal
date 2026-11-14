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

/** Cap shared by create / edit / media upload file pickers. */
export const MAX_MAINTENANCE_PHOTOS = 5;

export function takePhotoFiles(files: FileList | File[] | null | undefined): File[] {
  return Array.from(files ?? []).slice(0, MAX_MAINTENANCE_PHOTOS);
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
