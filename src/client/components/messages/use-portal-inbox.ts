import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@/context";
import type { OfficeMessage } from "@/lib/data";
import {
  announceInboxChanged,
  countUnreadConversations,
  createInboxReadMarker,
  hasRequestConversations,
  loadInbox,
  markConversationRead,
  officeKey,
  requestKey,
  type InboxConversation,
  type InboxLastMessage,
  type InboxViewer,
} from "@/lib/inbox";
import {
  portalInboxThreads,
  resolvePortalMessagesLink,
  type MessageThread,
} from "@/lib/messages";
import { supabase } from "@/lib/supabase";
import type { CommentVisibility, MaintenanceComment, WorkOrder } from "@/types";
import type { AppRole } from "@/types.supabase";

type LoadState = "loading" | "ready" | "error";

/**
 * The Messages inbox for a tenant, landlord or technician: their own office
 * thread plus the request threads they take part in, with saved read state
 * (lib/inbox.ts) — the same rule and numbers as the nav badge and the bell.
 *
 * Owns loading, the `?thread=` / `?request=` / `?office=me` deep links (an
 * inaccessible one becomes `unavailable`, never a fake thread), recording
 * reads, the open thread's messages, and sending. Pages only lay it out.
 */
export function usePortalInbox({
  role,
  search,
  navigate,
  replace,
  /** Tenant demo scenarios (`?demo=empty|error`). */
  scenario = null,
}: {
  role: AppRole;
  search: string;
  navigate: (to: string) => void;
  replace?: (to: string) => void;
  scenario?: "empty" | "error" | null;
}) {
  const { listWorkOrders, listMaintenanceComments, addMaintenanceComment, listOfficeMessages, sendOfficeMessage, setError } =
    useApp();

  const [viewer, setViewer] = useState<InboxViewer>({ role, userId: null });
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [inbox, setInbox] = useState<InboxConversation[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setLocalError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [mobileThread, setMobileThread] = useState(false);
  /** The office-message helper's draft, applied once (the URL is then cleaned). */
  const [officeDraft, setOfficeDraft] = useState<string | null>(null);

  const [comments, setComments] = useState<MaintenanceComment[]>([]);
  const [officeMessages, setOfficeMessages] = useState<OfficeMessage[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [threadReloadKey, setThreadReloadKey] = useState(0);

  const withRequests = hasRequestConversations(role);

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setLocalError(null);
    (async () => {
      try {
        if (scenario === "error") throw new Error("Couldn’t load messages right now. Try again.");
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const me: InboxViewer = { role, userId: session?.user.id ?? null };
        const [list, conversations] =
          scenario === "empty"
            ? [[] as WorkOrder[], [] as InboxConversation[]]
            : await Promise.all([
                // Landlords have no request threads, so they skip the request download.
                withRequests ? listWorkOrders({ skip_staff_notes: true }) : Promise.resolve([] as WorkOrder[]),
                loadInbox(me),
              ]);
        if (cancelled) return;
        setViewer(me);
        setWorkOrders(list);
        setInbox(conversations);
        setState("ready");
      } catch (err) {
        if (cancelled) return;
        setLocalError((err as Error).message);
        setState("error");
        if (scenario !== "error") setError((err as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [role, withRequests, listWorkOrders, setError, scenario, reloadKey]);

  const threads = useMemo(
    () => (scenario === "empty" ? [] : portalInboxThreads({ viewer, workOrders, inbox })),
    [viewer, workOrders, inbox, scenario],
  );
  // The shared count — the same number as the nav badge.
  const unreadCount = countUnreadConversations(inbox);

  const inboxRef = useRef(inbox);
  inboxRef.current = inbox;
  const viewerRef = useRef(viewer);
  viewerRef.current = viewer;

  const [reads] = useState(() =>
    createInboxReadMarker({
      getConversation: (key) => inboxRef.current.find((c) => c.key === key),
      setUnread: (key, unread) => setInbox((prev) => prev.map((c) => (c.key === key ? { ...c, unread } : c))),
      write: (conversation, through) => markConversationRead(conversation, through, viewerRef.current),
      onWritten: announceInboxChanged,
    }),
  );

  // Deep links: open what the URL names, or say it is not available.
  useEffect(() => {
    if (state !== "ready") return;
    const link = resolvePortalMessagesLink(search, threads, viewer);
    switch (link.kind) {
      case "open":
        setSelectedId(link.threadId);
        setUnavailable(false);
        setMobileThread(true);
        reads.follow(link.threadId);
        if (link.draft != null) {
          setOfficeDraft(link.draft);
          // Apply the draft once: a reload must not fill it in again.
          const clean = `/messages?thread=${encodeURIComponent(link.threadId)}`;
          if (replace) replace(clean);
          else if (typeof window !== "undefined") window.history.replaceState(window.history.state, "", clean);
        }
        return;
      case "redirect":
        if (replace) replace(link.to);
        else navigate(link.to);
        return;
      case "unavailable":
        reads.follow(null);
        setSelectedId(null);
        setUnavailable(true);
        setMobileThread(true);
        return;
      default:
        reads.follow(null);
        setUnavailable(false);
        setSelectedId(null);
        setMobileThread(false);
    }
  }, [search, threads, viewer, state, reads, replace, navigate]);

  const selected = threads.find((t) => t.id === selectedId);
  const selectedRequestId = selected?.kind === "request" ? (selected.requestId ?? null) : null;
  const selectedThreadUserId = selected?.kind === "direct" ? (selected.threadUserId ?? null) : null;
  const selectedKeyRef = useRef(selectedId);
  selectedKeyRef.current = selectedId;

  useEffect(() => {
    setComments([]);
    setOfficeMessages([]);
    setThreadError(null);
    if (selectedRequestId == null && selectedThreadUserId == null) {
      setThreadLoading(false);
      return;
    }
    let cancelled = false;
    setThreadLoading(true);
    const key = selectedRequestId != null ? requestKey(selectedRequestId) : officeKey(selectedThreadUserId!);
    const read: Promise<Array<{ created_at: string }>> =
      selectedRequestId != null
        ? listMaintenanceComments(selectedRequestId).then((rows) => {
            // RLS already hides internal notes from tenants; this keeps it so if a policy ever widens.
            const shown = role === "tenant" ? rows.filter((r) => r.visibility === "tenant_visible") : rows;
            if (!cancelled) setComments(shown);
            return shown;
          })
        : listOfficeMessages(selectedThreadUserId!).then((rows) => {
            if (!cancelled) setOfficeMessages(rows);
            return rows;
          });
    void read
      .then((rows) => {
        if (cancelled) return;
        // Someone may have written since the inbox loaded: read through what is on screen.
        const newest = rows.reduce<string | null>(
          (best, m) => (best == null || Date.parse(m.created_at) > Date.parse(best) ? m.created_at : best),
          null,
        );
        if (newest) reads.seen(key, newest);
      })
      .catch((err) => {
        if (cancelled) return;
        setThreadError((err as Error).message);
      })
      .finally(() => {
        if (!cancelled) setThreadLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedRequestId, selectedThreadUserId, threadReloadKey, listMaintenanceComments, listOfficeMessages, reads, role]);

  const openThread = useCallback(
    (thread: MessageThread) => {
      setSelectedId(thread.id);
      setUnavailable(false);
      setMobileThread(true);
      reads.open(thread.id);
      if (replace) replace(`/messages?thread=${encodeURIComponent(thread.id)}`);
    },
    [reads, replace],
  );

  const closeThread = useCallback(() => {
    setMobileThread(false);
    setUnavailable(false);
    setSelectedId(null);
    if (replace) replace("/messages");
    else navigate("/messages");
  }, [replace, navigate]);

  /** The reader just wrote: it is now the latest message, so the conversation is answered. */
  const recordReply = useCallback(
    (
      key: string,
      base: { kind: "request"; requestId: number } | { kind: "office"; threadUserId: string },
      last: InboxLastMessage,
    ) => {
      setInbox((prev) => [
        { ...base, key, last, unread: false } as InboxConversation,
        ...prev.filter((c) => c.key !== key),
      ]);
      announceInboxChanged();
    },
    [],
  );

  const sendOnRequest = useCallback(
    async (body: string, visibility: CommentVisibility) => {
      if (selectedRequestId == null) return;
      const requestId = selectedRequestId;
      const key = requestKey(requestId);
      try {
        const created = await addMaintenanceComment(requestId, body, role === "tenant" ? "tenant_visible" : visibility);
        recordReply(key, { kind: "request", requestId }, {
          at: created.created_at,
          body: created.body,
          authorRole: role,
          authorUserId: viewerRef.current.userId,
          authorTenantId: created.author_tenant_id ?? null,
          authorStaffId: created.author_staff_id ?? null,
        });
        if (selectedKeyRef.current === key) setComments((prev) => [...prev, created]);
      } catch (err) {
        setError((err as Error).message);
        // Rethrow so the composer keeps the draft.
        throw err;
      }
    },
    [selectedRequestId, addMaintenanceComment, recordReply, role, setError],
  );

  const sendOnOffice = useCallback(
    async (body: string) => {
      if (!selectedThreadUserId) return;
      const threadUserId = selectedThreadUserId;
      const key = officeKey(threadUserId);
      try {
        const created = await sendOfficeMessage(threadUserId, body);
        recordReply(key, { kind: "office", threadUserId }, {
          at: created.created_at,
          body: created.body,
          authorRole: created.author_role,
          authorUserId: created.author_user_id,
          authorTenantId: null,
          authorStaffId: null,
        });
        setOfficeDraft(null);
        if (selectedKeyRef.current === key) setOfficeMessages((prev) => [...prev, created]);
      } catch (err) {
        setError((err as Error).message);
        throw err;
      }
    },
    [selectedThreadUserId, sendOfficeMessage, recordReply, setError],
  );

  const isOwnOffice =
    selected?.kind === "direct" && viewer.userId != null && selected.threadUserId === viewer.userId;

  return {
    viewer,
    state,
    error,
    reload: () => setReloadKey((k) => k + 1),
    threads,
    unreadCount,
    selected,
    selectedRequestId,
    unavailable,
    mobileThread,
    openThread,
    closeThread,
    comments,
    officeMessages,
    threadLoading,
    threadError,
    retryThread: () => setThreadReloadKey((k) => k + 1),
    /** Prefill for the composer: only on the user's own office thread. */
    draft: isOwnOffice ? (officeDraft ?? "") : "",
    sendOnRequest,
    sendOnOffice,
  };
}
