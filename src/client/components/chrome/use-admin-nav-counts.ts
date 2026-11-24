import { useEffect, useState } from "react";
import * as data from "@/lib/data";
import { WORK_ORDER_OPEN_STATUSES_DB } from "@/lib/mappers";
import { supabase } from "@/lib/supabase";

/** Live counts for the admin rail badges, by nav item id. Absent = no badge. */
export type AdminNavCounts = {
  /** Open maintenance requests (every status except Closed). */
  maintenance?: number;
  /** Accounts waiting for approval — admins only. */
  people?: number;
  /** Unread OfficeMessages threads for the signed-in viewer. */
  messages?: number;
};

async function countOpenRequests(): Promise<number | undefined> {
  // Head request: the database counts, no rows come back.
  const { count, error } = await supabase
    .from("MaintenanceRequests")
    .select("id", { count: "exact", head: true })
    .in("status", [...WORK_ORDER_OPEN_STATUSES_DB]);
  if (error || typeof count !== "number") return undefined;
  return count;
}

async function countPendingAccounts(): Promise<number | undefined> {
  // Same source as the Users approval queue (admin-only RPC).
  const accounts = await data.listUserAccounts();
  return accounts.filter((a) => a.account_status === "pending").length;
}

async function countUnreadOfficeThreads(): Promise<number | undefined> {
  // Slim scan (no message bodies) — see data.countUnreadOfficeThreads.
  return data.countUnreadOfficeThreads();
}

/**
 * Counts for the admin workspace rail. Loads in the background (never blocks
 * rendering) and again whenever `refreshKey` changes — pass the current path so
 * the badges follow what the admin just did on another screen.
 *
 * Each count is independent and fails silently: a count that cannot be loaded
 * is dropped, so the rail shows no badge rather than a stale or invented one.
 */
export function useAdminNavCounts({
  enabled,
  isAdmin,
  refreshKey,
}: {
  /** False for the non-staff shells and while signed out — nothing is fetched. */
  enabled: boolean;
  isAdmin: boolean;
  refreshKey?: string;
}): AdminNavCounts {
  const [counts, setCounts] = useState<AdminNavCounts>({});

  useEffect(() => {
    if (!enabled) {
      setCounts({});
      return;
    }
    let cancelled = false;
    const load = (key: keyof AdminNavCounts, fetchCount: () => Promise<number | undefined>) => {
      fetchCount()
        .catch(() => undefined)
        .then((value) => {
          if (cancelled) return;
          setCounts((prev) => (prev[key] === value ? prev : { ...prev, [key]: value }));
        });
    };
    load("maintenance", countOpenRequests);
    load("messages", countUnreadOfficeThreads);
    if (isAdmin) load("people", countPendingAccounts);
    else setCounts((prev) => (prev.people === undefined ? prev : { ...prev, people: undefined }));
    return () => {
      cancelled = true;
    };
  }, [enabled, isAdmin, refreshKey]);

  return counts;
}
