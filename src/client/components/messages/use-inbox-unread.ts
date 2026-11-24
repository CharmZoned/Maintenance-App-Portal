import { useEffect, useRef, useState } from "react";
import { countInboxUnread, INBOX_CHANGED_EVENT } from "@/lib/inbox";
import { supabase } from "@/lib/supabase";
import type { AppRole } from "@/types.supabase";

/** A route change refreshes the badge only when the last count is older than this. */
const ROUTE_REFRESH_MS = 30_000;

/**
 * Unread conversations for the Messages nav badge of a tenant, landlord or
 * technician — the same rows and rule as their Messages page header and the
 * bell (lib/inbox.ts). Reloads when the inbox announces a read or reply, when
 * the window regains focus, and when `refreshKey` changes (pass the path) if
 * the count is more than 30s old. A failed count shows no badge.
 */
export function useInboxUnread({
  enabled,
  role,
  refreshKey,
}: {
  enabled: boolean;
  role: AppRole | null;
  refreshKey?: string;
}): number | undefined {
  const [count, setCount] = useState<number | undefined>(undefined);
  const lastLoad = useRef<{ key: string; at: number } | null>(null);

  useEffect(() => {
    if (!enabled || !role) {
      setCount(undefined);
      lastLoad.current = null;
      return;
    }
    let cancelled = false;
    const load = async () => {
      lastLoad.current = { key: `${role}`, at: Date.now() };
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const next = await countInboxUnread({ role, userId: session?.user.id ?? null });
        if (!cancelled) setCount(next);
      } catch {
        if (!cancelled) setCount(undefined);
      }
    };
    const onChange = () => void load();
    // Reads anywhere fire INBOX_CHANGED_EVENT, and focus catches messages that
    // arrived while away, so a route change (refreshKey) only needs a refresh
    // when the count is getting old. Each refresh scans the inbox.
    const last = lastLoad.current;
    const fresh = last != null && last.key === `${role}` && Date.now() - last.at < ROUTE_REFRESH_MS;
    if (!fresh) void load();
    window.addEventListener(INBOX_CHANGED_EVENT, onChange);
    window.addEventListener("focus", onChange);
    return () => {
      cancelled = true;
      window.removeEventListener(INBOX_CHANGED_EVENT, onChange);
      window.removeEventListener("focus", onChange);
    };
  }, [enabled, role, refreshKey]);

  return count;
}
