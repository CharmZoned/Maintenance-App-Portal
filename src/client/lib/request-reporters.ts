import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabase";
import type { WorkOrder } from "@/types";

/**
 * "Reported by <landlord name>" for landlord-filed requests (owner decision D3,
 * landlord wave LG-A3).
 *
 * A tenant cannot read the Landlords table. The database function
 * list_request_reporter_names returns only the landlord's display name, and
 * only for requests the caller can already see. Requests not filed by a
 * landlord are left out of the map.
 */
export async function listRequestReporterNames(requestIds: number[]): Promise<Map<number, string>> {
  const names = new Map<number, string>();
  const ids = [...new Set(requestIds.filter((id) => Number.isFinite(id)))];
  if (ids.length === 0) return names;
  const { data, error } = await supabase.rpc("list_request_reporter_names", { p_request_ids: ids });
  if (error) throw new Error(error.message || "Couldn’t load who reported these requests.");
  for (const row of data ?? []) {
    const name = row.landlord_name?.trim();
    if (name) names.set(Number(row.request_id), name);
  }
  return names;
}

/**
 * True when a tenant is looking at a request they did not submit. A tenant
 * only sees their own requests and landlord-filed requests on their current
 * unit, so this means "filed by the landlord": view only, no reply, no fix
 * confirmation, no photos from the tenant.
 */
export function isReportedByOther(order: Pick<WorkOrder, "tenant_id">): boolean {
  return order.tenant_id == null;
}

/** "Reported by …" text for the tenant view. */
export function tenantReporterLabel(
  order: Pick<WorkOrder, "tenant_id" | "tenant_first_name" | "tenant_last_name">,
  landlordName: string | null | undefined,
): string {
  if (isReportedByOther(order)) return landlordName?.trim() || "Your landlord";
  return [order.tenant_first_name, order.tenant_last_name].filter(Boolean).join(" ") || "You";
}

/**
 * Loads reporter names for the landlord-filed requests in `orders`. Failures
 * fall back to "Your landlord" (empty map), never to the tenant's own name.
 */
export function useRequestReporterNames(orders: Pick<WorkOrder, "id" | "tenant_id">[]): Map<number, string> {
  const key = useMemo(
    () =>
      orders
        .filter(isReportedByOther)
        .map((o) => o.id)
        .sort((a, b) => a - b)
        .join(","),
    [orders],
  );
  const [names, setNames] = useState<Map<number, string>>(() => new Map());

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    const ids = key.split(",").map(Number);
    listRequestReporterNames(ids)
      .then((found) => {
        if (cancelled) return;
        setNames((prev) => {
          const next = new Map(prev);
          for (const [id, name] of found) next.set(id, name);
          return next;
        });
      })
      .catch(() => {
        /* keep the "Your landlord" fallback */
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  return names;
}
