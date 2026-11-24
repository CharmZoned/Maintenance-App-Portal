import { useCallback, useEffect, useState } from "react";
import {
  OFFICE_THREAD_READ_EVENT,
  countUnreadOfficeMessages,
  currentUserId,
  getOfficeThreadReadAt,
  listOfficeMessages,
  listOfficeThreads,
  subscribeOfficeInbox,
  subscribeOfficeThread,
  type OfficeMessage,
} from "../lib/office-messages";
import { supabase } from "../lib/supabase";

export interface OfficeThreadPreview {
  /** Newest message in the signed-in user's office thread (null when there is none). */
  lastMessage: OfficeMessage | null;
  /**
   * Landlord / worker: messages from the office they haven't read.
   * Admin: how many office threads have an unread message.
   */
  unread: number;
  loading: boolean;
  error: string | null;
}

/**
 * The signed-in user's conversation with the Landlord Gopher office, for the
 * Home page card: the last message and the unread count. Stays live (realtime,
 * or polling when realtime is unavailable) and refreshes when the thread is
 * marked read on the Messages page.
 */
export function useOfficeThreadPreview(): OfficeThreadPreview {
  const [state, setState] = useState<OfficeThreadPreview>({
    lastMessage: null,
    unread: 0,
    loading: true,
    error: null,
  });
  const [ctx, setCtx] = useState<{ userId: string; isAdmin: boolean } | null>(null);

  const load = useCallback(async (): Promise<{ userId: string; isAdmin: boolean } | null> => {
    try {
      const userId = await currentUserId();
      if (!userId) {
        setState({ lastMessage: null, unread: 0, loading: false, error: null });
        return null;
      }
      const { data: role } = await supabase.from("user_roles").select("role").eq("user_id", userId).maybeSingle();
      const isAdmin = role?.role === "admin";

      if (isAdmin) {
        const threads = await listOfficeThreads();
        const latest = threads[0];
        setState({
          lastMessage: latest
            ? {
                id: 0,
                created_at: latest.last_message_at,
                thread_user_id: latest.thread_user_id,
                author_user_id: latest.last_author_user_id,
                author_role: latest.last_author_role,
                body: latest.last_message_body,
                request_id: null,
              }
            : null,
          unread: threads.filter((t) => t.unread && t.last_author_role !== "admin").length,
          loading: false,
          error: null,
        });
      } else {
        const [messages, readAt] = await Promise.all([listOfficeMessages(userId), getOfficeThreadReadAt(userId)]);
        setState({
          lastMessage: messages.length ? messages[messages.length - 1] : null,
          unread: countUnreadOfficeMessages(messages, { userId, isAdmin: false }, readAt),
          loading: false,
          error: null,
        });
      }
      return { userId, isAdmin };
    } catch (err) {
      setState((prev) => ({ ...prev, loading: false, error: (err as Error).message }));
      return null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void load().then((next) => {
      if (!cancelled) setCtx(next);
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  // Live: any new message re-reads the preview (cheap: one thread, or the inbox summary).
  useEffect(() => {
    if (!ctx) return;
    const refresh = () => void load();
    const unsubscribe = ctx.isAdmin ? subscribeOfficeInbox(refresh) : subscribeOfficeThread(ctx.userId, refresh);
    window.addEventListener(OFFICE_THREAD_READ_EVENT, refresh);
    return () => {
      unsubscribe();
      window.removeEventListener(OFFICE_THREAD_READ_EVENT, refresh);
    };
  }, [ctx, load]);

  return state;
}
