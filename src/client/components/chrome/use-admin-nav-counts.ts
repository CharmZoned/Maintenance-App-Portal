import { useEffect, useState } from "react";
import * as data from "@/lib/data";
import { countAdminUnread, INBOX_CHANGED_EVENT } from "@/lib/inbox";
import { workOrderStatusToDb } from "@/lib/mappers";
import { supabase } from "@/lib/supabase";

/** Live counts for the admin rail badges, by nav item id. Absent = no badge. */
export type AdminNavCounts = {
  /**
   * Requests waiting on the office: new and nobody assigned yet. The same rule
   * as the Maintenance page's "Needs action" tab and the dashboard's
   * "need action" figure.
   */
  maintenance?: number;
  /** Accounts waiting for approval — admins only. */
  people?: number;
  /**
   * Unread conversations. Admins: the office inbox — the same count as the
   * Messages page header and the dashboard KPI. Other staff: their unread
   * OfficeMessages threads.
   */
  messages?: number;
};

/**
 * Head request: the database counts, no rows come back. Mirrors
 * `staffQueueTab(...) === "needs"` (components/maintenance/request-status.ts):
 * status open (mapped to the DB label) and no team member assigned.
 */
export async function countRequestsNeedingAction(): Promise<number | undefined> {
  const { count, error } = await supabase
    .from("MaintenanceRequests")
    .select("id", { count: "exact", head: true })
    .eq("status", workOrderStatusToDb("open"))
    .is("assigned_staff_id", null);
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
 * the badges follow what the admin just did on another screen. The Messages
 * count also reloads when the inbox announces a change (a thread was read or
 * answered), since that happens without leaving the page.
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
    const loadMessages = () => load("messages", isAdmin ? countAdminUnread : countUnreadOfficeThreads);
    load("maintenance", countRequestsNeedingAction);
    loadMessages();
    window.addEventListener(INBOX_CHANGED_EVENT, loadMessages);
    if (isAdmin) load("people", countPendingAccounts);
    else setCounts((prev) => (prev.people === undefined ? prev : { ...prev, people: undefined }));
    return () => {
      cancelled = true;
      window.removeEventListener(INBOX_CHANGED_EVENT, loadMessages);
    };
  }, [enabled, isAdmin, refreshKey]);

  return counts;
}
