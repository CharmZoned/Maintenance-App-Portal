import { workOrderStatusFromDb } from "@/lib/mappers";
import type { MaintenancePhoto, MaintenanceStatusEvent, WorkOrder } from "@/types";

/**
 * Which photos let THIS worker mark the job completed. Mirrors the server rule
 * in private.protect_maintenance_request() (20261118190000_worker_job_pool.sql,
 * tightened in 20261124120000_request_completion_fixes.sql):
 *
 *   a photo uploaded by the current worker (uploaded_by_user_id = viewer,
 *   role maintenance), created after the latest of
 *     - when they accepted the job from the pool (accepted_at),
 *     - when the job was last released (released_at),
 *     - when the request was last reopened (history row from Closed to anything else),
 *   whose file actually reached storage.
 *
 * A photo from a previous worker, from before a reopen, or a row whose upload
 * failed does not count. The client checks the same thing so the Complete
 * dialog can say why a new photo is needed instead of failing on save.
 */

/** Why the worker still needs a photo; "none" when they already have one that counts. */
export type CompletionPhotoNeed = "none" | "first" | "reopened" | "reassigned";

export type CompletionProofOrder = Pick<WorkOrder, "accepted_at" | "released_at">;
export type CompletionProofEvent = Pick<MaintenanceStatusEvent, "from_status" | "to_status" | "created_at">;
export type CompletionProofPhoto = Pick<
  MaintenancePhoto,
  "uploaded_by_role" | "uploaded_by_user_id" | "created_at" | "missing"
>;

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/** When the request was last reopened (moved out of Completed), or null. */
export function lastReopenedAt(history: readonly CompletionProofEvent[]): number | null {
  let latest: number | null = null;
  for (const ev of history) {
    if (ev.from_status == null) continue;
    if (workOrderStatusFromDb(ev.from_status) !== "closed") continue;
    if (workOrderStatusFromDb(ev.to_status) === "closed") continue;
    const t = ms(ev.created_at);
    if (t != null && (latest == null || t > latest)) latest = t;
  }
  return latest;
}

/** The latest of accepted_at, released_at and the last reopen; null when none is set. */
export function completionPhotoSince(
  order: CompletionProofOrder,
  history: readonly CompletionProofEvent[],
): number | null {
  const times = [ms(order.accepted_at), ms(order.released_at), lastReopenedAt(history)].filter(
    (t): t is number => t != null,
  );
  return times.length ? Math.max(...times) : null;
}

function isWorkPhoto(photo: CompletionProofPhoto): boolean {
  return photo.uploaded_by_role === "maintenance";
}

/**
 * The proof for `viewerUserId`: `since` is the cut-off (ms) a photo must be
 * newer than, `photos` the viewer's photos that count. Without a viewer id
 * (should not happen for a signed-in worker) any worker photo counts, as the
 * old client did, and the server still has the final word.
 */
export function completionProof<P extends CompletionProofPhoto>(input: {
  order: CompletionProofOrder;
  history: readonly CompletionProofEvent[];
  photos: readonly P[];
  viewerUserId: string | null | undefined;
}): { since: number | null; photos: P[]; need: CompletionPhotoNeed } {
  const { order, history, photos, viewerUserId } = input;
  const since = completionPhotoSince(order, history);
  const mine = (p: CompletionProofPhoto) => isWorkPhoto(p) && (!viewerUserId || p.uploaded_by_user_id === viewerUserId);
  const newer = (p: CompletionProofPhoto) => {
    if (since == null) return true;
    const t = ms(p.created_at);
    return t != null && t > since;
  };
  const proof = photos.filter((p) => mine(p) && newer(p) && !p.missing);
  if (proof.length > 0) return { since, photos: proof, need: "none" };

  const reopened = lastReopenedAt(history);
  // Reopened since the job was taken: earlier photos show the first fix, not this one.
  if (reopened != null && reopened === since) return { since, photos: [], need: "reopened" };
  // Other workers' photos, or the viewer's own from an earlier hold of the job.
  const olderWork = photos.some((p) => isWorkPhoto(p) && !p.missing && !(mine(p) && newer(p)));
  return { since, photos: [], need: olderWork ? "reassigned" : "first" };
}

/** One line for the Complete dialog: why a (new) photo is needed. Null when none is. */
export function completionPhotoHint(need: CompletionPhotoNeed): string | null {
  switch (need) {
    case "reopened":
      return "This job was reopened — add a photo of today’s work.";
    case "reassigned":
      return "Earlier photos are from before you took this job — add a photo of your finished work.";
    case "first":
      return "Add a photo of the finished work.";
    default:
      return null;
  }
}
