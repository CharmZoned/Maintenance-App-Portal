import { compareCreatedDesc, formatActivityStamp, isOpenRequest } from "@/lib/request-status";
import type { Property, WorkOrder } from "@/types";

/** Path of the unit page (route contract §4: `/properties/:id/units/:unitId`). */
export function unitPagePath(propertyId: number, unitId: number): string {
  return `/properties/${propertyId}/units/${unitId}`;
}

/** Open requests first, newest first; past (completed) requests after. */
export function splitRequests<T extends Pick<WorkOrder, "status" | "created_at" | "id">>(
  orders: readonly T[],
): { open: T[]; past: T[] } {
  const sorted = [...orders].sort(compareCreatedDesc);
  return {
    open: sorted.filter((o) => isOpenRequest(o)),
    past: sorted.filter((o) => !isOpenRequest(o)),
  };
}

/** Open request count per unit id. Common-area requests (no unit) are skipped. */
export function openRequestCountByUnit(
  orders: readonly Pick<WorkOrder, "status" | "unit_id">[],
): Map<number, number> {
  const counts = new Map<number, number>();
  for (const o of orders) {
    if (o.unit_id == null || !isOpenRequest(o)) continue;
    counts.set(o.unit_id, (counts.get(o.unit_id) ?? 0) + 1);
  }
  return counts;
}

/** Open request count per property id. */
export function openRequestCountByProperty(
  orders: readonly Pick<WorkOrder, "status" | "property_id">[],
): Map<number, number> {
  const counts = new Map<number, number>();
  for (const o of orders) {
    if (o.property_id == null || !isOpenRequest(o)) continue;
    counts.set(o.property_id, (counts.get(o.property_id) ?? 0) + 1);
  }
  return counts;
}

/** "No open requests" / "1 open request" / "2 open requests". */
export function openRequestsLabel(count: number): string {
  if (count <= 0) return "No open requests";
  return `${count} open ${count === 1 ? "request" : "requests"}`;
}

/** "Today 2:14 pm" → "today 2:14 pm" so it reads inside a sentence. */
function inlineStamp(iso: string | null | undefined): string {
  const stamp = formatActivityStamp(iso);
  return /^(Today|Yesterday)\b/.test(stamp) ? stamp.charAt(0).toLowerCase() + stamp.slice(1) : stamp;
}

/**
 * Context line under a request title on the property and unit pages.
 * Property page: "Unit 1A · Reported today 2:14 pm" or "Common area · …".
 * Unit page (showPlace false): "Reported Fri, Nov 13".
 * Completed rows say when the job was fixed when that date is known.
 */
export function requestRowContext(
  order: Pick<WorkOrder, "status" | "unit_id" | "unit_name" | "created_at" | "completed_at">,
  opts?: { showPlace?: boolean },
): string {
  const parts: string[] = [];
  if (opts?.showPlace !== false) {
    const unit = order.unit_name?.trim();
    if (order.unit_id == null) parts.push("Common area");
    else parts.push(unit ? (/^unit\b/i.test(unit) ? unit : `Unit ${unit}`) : "Unit");
  }
  if (!isOpenRequest(order) && order.completed_at) {
    parts.push(`Fixed ${inlineStamp(order.completed_at)}`);
  } else if (order.created_at) {
    parts.push(`Reported ${inlineStamp(order.created_at)}`);
  }
  return parts.filter(Boolean).join(" · ");
}

/**
 * A landlord with exactly one property skips the list and lands on that
 * property (navigate with `replace`, so Back doesn't loop). Returns the path,
 * or null to show the list.
 */
export function singlePropertyRedirect(opts: {
  isLandlord: boolean;
  loading: boolean;
  properties: readonly Pick<Property, "id">[];
}): string | null {
  if (!opts.isLandlord || opts.loading || opts.properties.length !== 1) return null;
  return `/properties/${opts.properties[0].id}`;
}
