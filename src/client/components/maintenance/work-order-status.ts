import type { WorkOrderStatus } from "@/types";
import { PRIORITY_OPTIONS, statusOptions } from "@/lib/request-status";

/**
 * Status and priority LABELS come from `@/lib/request-status` (the one shared
 * mapping). This module keeps photo / price helpers and the picker option lists
 * built from that mapping. Stored values are unchanged.
 */

/** Priority picker options — DB 'urgent' reads "Emergency" (never "Urgent"). */
export const PRIORITIES = PRIORITY_OPTIONS;

/** Admin status picker: all five stored values, shared labels (New … Completed). */
export const ADMIN_STATUSES: { value: WorkOrderStatus; label: string }[] = statusOptions();

/** Cap shared by create / edit / media upload file pickers (matches DB trigger). */
export const MAX_MAINTENANCE_PHOTOS = 5;

/**
 * The DB keeps two caps of MAX_MAINTENANCE_PHOTOS per request: photos uploaded by
 * the worker, and photos from everyone else. A tenant's photos must not use up
 * the room a worker needs for the required completion photo.
 *
 * Work photos count only for the current visit: those taken after `workSince`
 * (ms; the latest of accepted, released and last reopened, as in
 * completionPhotoSince). Older work photos stay as history, so a job reopened
 * with five photos still has room for the new proof. Mirrors
 * private.enforce_maintenance_photo_cap.
 */
export function photoSlotsLeft(
  photos: { uploaded_by_role: string | null; created_at?: string | null }[],
  uploaderIsWorker: boolean,
  workSince: number | null = null,
): number {
  const used = photos.filter((p) => {
    if ((p.uploaded_by_role === "maintenance") !== uploaderIsWorker) return false;
    if (!uploaderIsWorker || workSince == null) return true;
    const t = p.created_at ? Date.parse(p.created_at) : NaN;
    return Number.isNaN(t) || t > workSince;
  }).length;
  return Math.max(0, MAX_MAINTENANCE_PHOTOS - used);
}

/**
 * Parse a price field. Blank means "no price". Anything that is not a plain
 * number of 0 or more with at most two decimals is rejected, so "12abc" is an
 * error and never silently saved as 12.
 */
export function parsePriceInput(raw: string): { ok: true; value: number | null } | { ok: false } {
  const text = raw.trim();
  if (text === "") return { ok: true, value: null };
  if (!/^[0-9]+(\.[0-9]{1,2})?$/.test(text)) return { ok: false };
  const value = Number(text);
  return Number.isFinite(value) ? { ok: true, value } : { ok: false };
}

/**
 * The price fields to send on save: only the ones whose value differs from what
 * is stored. An untouched field is never sent, so saving a work order cannot
 * delete a price by accident. Throws when a field holds an invalid value.
 */
export function changedPriceFields(
  fields: { workerPrice: string; landlordPrice: string },
  stored: { worker_price: number | null; landlord_price: number | null },
): { worker_price?: number | null; landlord_price?: number | null } {
  const out: { worker_price?: number | null; landlord_price?: number | null } = {};
  const worker = parsePriceInput(fields.workerPrice);
  if (!worker.ok) throw new Error("Worker price must be a number of 0 or more, like 140 or 140.50.");
  const landlord = parsePriceInput(fields.landlordPrice);
  if (!landlord.ok) throw new Error("Landlord price must be a number of 0 or more, like 190 or 190.50.");
  if (worker.value !== stored.worker_price) out.worker_price = worker.value;
  if (landlord.value !== stored.landlord_price) out.landlord_price = landlord.value;
  return out;
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
    ? statusOptions(["open", "in_progress", "on_hold", "closed"])
    : statusOptions(["open", "on_hold", "closed"]);
}
