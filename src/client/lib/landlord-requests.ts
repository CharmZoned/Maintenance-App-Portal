import { supabase } from "./supabase";
import { uploadMaintenancePhoto } from "./data";
import {
  maintenanceCategoryToDb,
  mapWorkOrder,
  workOrderPriorityToDb,
} from "./mappers";
import type { MaintenanceCategory, WorkOrder, WorkOrderPriority } from "@/types";

/** Same cap the database enforces per reporter (MaintenanceRequestPhotos trigger). */
export const MAX_LANDLORD_REQUEST_PHOTOS = 5;

export interface NewLandlordRequest {
  /** Property the request is on. Must be one the landlord owns. */
  property_id: number;
  /** A unit on that property, or null for a common area (owner decision D2). */
  unit_id: number | null;
  title: string;
  /** Optional details. Falls back to the title when left empty. */
  description?: string | null;
  category: MaintenanceCategory | string;
  priority: WorkOrderPriority;
  /** Owner decision D3: the form defaults to No. */
  permission_to_enter: boolean;
  /** Up to 5 photos, uploaded after the request row exists. */
  photos?: File[];
}

export interface LandlordRequestResult {
  request: WorkOrder;
  /** How many photos made it up. */
  photosUploaded: number;
  /** Why the remaining photos failed, if any did. The request itself was still filed. */
  photoError: string | null;
}

function isAbortError(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === "AbortError") ||
    (err instanceof Error && err.name === "AbortError")
  );
}

/** The signed-in user's landlord id, or an error if they are not an approved landlord. */
async function currentLandlordId(signal?: AbortSignal): Promise<number> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  signal?.throwIfAborted();
  let query = supabase
    .from("user_roles")
    .select("role, landlord_id, account_status")
    .eq("user_id", user.id);
  if (signal) query = query.abortSignal(signal);
  const { data: role, error } = await query.maybeSingle();
  if (error) throw new Error(error.message || "Couldn’t check your account.");
  if (
    !role ||
    role.role !== "landlord" ||
    role.account_status !== "approved" ||
    role.landlord_id == null
  ) {
    throw new Error("Only approved landlords can file requests here.");
  }
  return Number(role.landlord_id);
}

/**
 * A landlord files a maintenance request on a unit they own, or on a common
 * area of a property they own (unit_id null). Landlord wave LG-C.
 *
 * The row goes in first (RLS policy maintenance_requests_insert_landlord:
 * status Open, nothing assigned or scheduled, submitted_by_landlord_id = the
 * caller). Photos are uploaded afterwards, one at a time, the same way the
 * tenant flow does. A photo failure does not undo the request: the result says
 * how many photos made it.
 */
export async function createLandlordRequest(
  input: NewLandlordRequest,
  opts?: { signal?: AbortSignal },
): Promise<LandlordRequestResult> {
  const signal = opts?.signal;
  signal?.throwIfAborted();

  const title = input.title.trim();
  if (!title) throw new Error("Describe the problem in a few words.");
  if (!Number.isFinite(input.property_id)) throw new Error("Choose a property.");
  const description = input.description?.trim() || title;
  const photos = (input.photos ?? []).slice(0, MAX_LANDLORD_REQUEST_PHOTOS);

  const landlordId = await currentLandlordId(signal);
  signal?.throwIfAborted();

  let insert = supabase
    .from("MaintenanceRequests")
    .insert({
      title,
      description,
      category: maintenanceCategoryToDb(input.category),
      priority: workOrderPriorityToDb(input.priority),
      status: "Open",
      property_id: input.property_id,
      unit_id: input.unit_id,
      submitted_by_landlord_id: landlordId,
      submitted_by_tenant_id: null,
      permission_to_enter: input.permission_to_enter,
      assigned_staff_id: null,
      vendor_id: null,
      scheduled_for: null,
      started_at: null,
      closed_at: null,
      hold_reason: null,
      next_follow_up_date: null,
      resolution_notes: null,
      is_test_data: false,
    })
    .select("*");
  if (signal) insert = insert.abortSignal(signal);
  const { data: row, error } = await insert.single();
  if (error) throw new Error(error.message || "Request wasn’t submitted.");
  const request = mapWorkOrder(row!);

  let photosUploaded = 0;
  let photoError: string | null = null;
  for (const file of photos) {
    try {
      await uploadMaintenancePhoto(request.id, file, undefined, { signal });
      photosUploaded++;
    } catch (err) {
      if (isAbortError(err) || signal?.aborted) throw err;
      photoError = (err as Error).message || "A photo didn’t upload.";
      break;
    }
  }

  return { request, photosUploaded, photoError };
}
