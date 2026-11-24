import { useEffect, useState } from "react";
import { countInboxUnread, INBOX_CHANGED_EVENT } from "@/lib/inbox";
import { supabase } from "@/lib/supabase";
import type { AppRole } from "@/types.supabase";

/**
 * Unread conversations for the Messages nav badge of a tenant, landlord or
 * technician — the same rows and rule as their Messages page header and the
 * bell (lib/inbox.ts). Reloads when `refreshKey` changes (pass the path) and
 * when the inbox announces a read or reply. A failed count shows no badge.
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

  useEffect(() => {
    if (!enabled || !role) {
      setCount(undefined);
      return;
    }
    let cancelled = false;
    const load = async () => {
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
    void load();
    window.addEventListener(INBOX_CHANGED_EVENT, onChange);
    return () => {
      cancelled = true;
      window.removeEventListener(INBOX_CHANGED_EVENT, onChange);
    };
  }, [enabled, role, refreshKey]);

  return count;
}
