import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { MessageSquare, Wrench } from "lucide-react";
import { useApp } from "@/context";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorRetry, SkeletonRow } from "@/components/patterns";
import { cn } from "@/lib/utils";
import { MessageThreadRow } from "./message-thread-row";
import { MessageBubble } from "./message-bubble";
import { MessageComposer } from "./message-composer";
import { TenantMessagesPage } from "./tenant-messages-page";
import { OfficeConversation, useVisibleRefresh } from "./office-conversation";
import {
  commentSenderLabel,
  emptyOfficeThread,
  formatMessageTime,
  officeUserIdFromThreadId,
  ownOfficeThread,
  sortThreads,
  threadsFromOfficeSummaries,
  threadsFromWorkOrders,
  type MessageThread,
  type OfficePerson,
} from "@/lib/messages";
import { listOfficeThreads, type OfficeThreadSummary } from "@/lib/data";
import {
  getOfficeViewer,
  getOwnOfficeThread,
  listOfficePeople,
  type OfficeMessage,
  type OfficeViewer,
} from "@/lib/office-messages";
import type { CommentVisibility, MaintenanceComment, WorkOrder } from "@/types";

type LoadState = "loading" | "ready" | "error";

/**
 * Office threads as the signed-in person sees them.
 * Admin: every person's thread, plus who is behind each account.
 * Anyone else: their own single thread (no summary until someone writes).
 */
type OfficeInbox = {
  viewer: OfficeViewer;
  summaries: OfficeThreadSummary[];
  people: Map<string, OfficePerson>;
};

async function loadOfficeSummaries(viewer: OfficeViewer): Promise<OfficeThreadSummary[]> {
  if (viewer.role === "admin") return listOfficeThreads();
  const own = await getOwnOfficeThread(viewer.userId);
  return own ? [own] : [];
}

async function loadOfficeInbox(): Promise<OfficeInbox> {
  const viewer = await getOfficeViewer();
  const [summaries, people] = await Promise.all([
    loadOfficeSummaries(viewer),
    // Names are best effort: without them a thread is still listed, as "Portal user".
    viewer.role === "admin"
      ? listOfficePeople().catch(() => new Map<string, OfficePerson>())
      : Promise.resolve(new Map<string, OfficePerson>()),
  ]);
  return { viewer, summaries, people };
}

/**
 * Height left for the inbox inside the page's scroll area, measured from where
 * the inbox starts. The open thread is given exactly this height, so it fills
 * the screen and scrolls inside itself whatever sits around it (a top banner,
 * the phone tab bar). Null until measured; the CSS fallback applies meanwhile.
 */
function useAvailableHeight(ref: RefObject<HTMLElement | null>, mounted: boolean): number | null {
  const [height, setHeight] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!mounted || !el || typeof ResizeObserver === "undefined") {
      setHeight(null);
      return;
    }
    let scroller = el.parentElement;
    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) {
      scroller = scroller.parentElement;
    }
    if (!scroller) return;
    const scrollArea = scroller;
    const measure = () => {
      const offset =
        el.getBoundingClientRect().top - scrollArea.getBoundingClientRect().top + scrollArea.scrollTop;
      const next = Math.floor(scrollArea.clientHeight - offset);
      setHeight(next > 0 ? next : null);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scrollArea);
    return () => observer.disconnect();
  }, [ref, mounted]);

  return height;
}

/**
 * Messages route entry.
 * Tenants: fully mocked Figma inbox/conversation (no messages tables).
 * Admin, worker, landlord: request threads via MaintenanceRequestComments,
 * plus office threads (OfficeMessages).
 */
export function MessagesPage({
  search = "",
  navigate,
  replace,
}: {
  search?: string;
  navigate: (to: string) => void;
  replace?: (to: string) => void;
}) {
  const { isTenant } = useApp();

  // TODO(data-gap): messages backend not available — tenant path is mock-only
  if (isTenant) {
    return <TenantMessagesPage search={search} navigate={navigate} replace={replace} />;
  }

  return (
    <StaffMessagesPage search={search} navigate={navigate} replace={replace} />
  );
}

/**
 * Figma 05 Messages — staff/landlord list + thread.
 * Request threads use MaintenanceRequestComments. Office threads use
 * OfficeMessages: an admin sees one per person who has written (or been
 * written to); a worker or landlord sees their own single "Office" thread.
 * Deep links: `?thread=wo:<requestId>` and `?thread=office:<userId>`.
 */
function StaffMessagesPage({
  search = "",
  navigate,
  replace,
}: {
  search?: string;
  navigate: (to: string) => void;
  replace?: (to: string) => void;
}) {
  const app = useApp();
  const {
    listWorkOrders,
    listMaintenanceComments,
    addMaintenanceComment,
    setError,
    setNotice,
    isAdmin,
    isTenant,
    isLandlord,
  } = app;

  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [office, setOffice] = useState<OfficeInbox | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setLocalError] = useState<string | null>(null);
  /** One of the two sources failed while the other loaded: shown above the list. */
  const [partialError, setPartialError] = useState<string | null>(null);
  const [openedIds, setOpenedIds] = useState<Set<string>>(() => new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [comments, setComments] = useState<MaintenanceComment[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [mobileThread, setMobileThread] = useState(false);
  const [commentVisibility, setCommentVisibility] = useState<CommentVisibility>("internal");
  const [threadReloadKey, setThreadReloadKey] = useState(0);

  /** Bumped whenever office state changes locally, so an older in-flight refresh is dropped. */
  const officeSeqRef = useRef(0);

  const load = useCallback(async () => {
    setState("loading");
    setLocalError(null);
    setPartialError(null);
    // A full load is authoritative: any quiet refresh still in flight is dropped.
    officeSeqRef.current += 1;
    const [requests, inbox] = await Promise.allSettled([listWorkOrders(), loadOfficeInbox()]);
    if (requests.status === "fulfilled") setWorkOrders(requests.value);
    if (inbox.status === "fulfilled") {
      officeSeqRef.current += 1;
      setOffice(inbox.value);
    }

    if (requests.status === "rejected" && inbox.status === "rejected") {
      const message = (requests.reason as Error).message;
      setLocalError(message);
      setState("error");
      setError(message);
      return;
    }
    if (requests.status === "rejected") {
      setWorkOrders([]);
      setPartialError("Request conversations couldn’t be loaded.");
      setError((requests.reason as Error).message);
    } else if (inbox.status === "rejected") {
      setOffice(null);
      setPartialError("Conversations with the office couldn’t be loaded.");
    }
    setState("ready");
  }, [listWorkOrders, setError]);

  useEffect(() => {
    void load();
  }, [load]);

  const officeViewer = office?.viewer ?? null;

  /** Quiet refetch of the office summaries (new messages, unread state). */
  const refreshOffice = useCallback(async () => {
    if (!officeViewer) return;
    const seq = ++officeSeqRef.current;
    try {
      const summaries = await loadOfficeSummaries(officeViewer);
      if (seq !== officeSeqRef.current) return;
      setOffice((prev) => (prev ? { ...prev, summaries } : prev));
    } catch {
      // Keep what is on screen; the next refresh tries again.
    }
  }, [officeViewer]);

  // No realtime in the app: refetch on an interval while visible, and on focus.
  useVisibleRefresh(() => void refreshOffice(), undefined, state === "ready" && officeViewer != null);

  /** The open conversation saved the viewer's read row: clear the dot without waiting for a refetch. */
  const handleOfficeRead = useCallback((threadUserId: string) => {
    officeSeqRef.current += 1;
    setOffice((prev) =>
      prev
        ? {
            ...prev,
            summaries: prev.summaries.map((s) =>
              s.thread_user_id === threadUserId && s.unread ? { ...s, unread: false } : s,
            ),
          }
        : prev,
    );
  }, []);

  const officeRef = useRef(office);
  officeRef.current = office;

  /** The open conversation has a newer latest message (received or sent): update its row. */
  const handleOfficeLatest = useCallback((message: OfficeMessage) => {
    const isNews = (summaries: OfficeThreadSummary[]) => {
      const existing = summaries.find((s) => s.thread_user_id === message.thread_user_id);
      return !existing || Date.parse(existing.last_message_at) < Date.parse(message.created_at);
    };
    if (!officeRef.current || !isNews(officeRef.current.summaries)) return;
    // Drop any refresh already in flight: it may predate this message.
    officeSeqRef.current += 1;
    setOffice((prev) => {
      if (!prev || !isNews(prev.summaries)) return prev;
      const existing = prev.summaries.find((s) => s.thread_user_id === message.thread_user_id);
      const next: OfficeThreadSummary = {
        thread_user_id: message.thread_user_id,
        last_message_at: message.created_at,
        last_message_body: message.body,
        last_author_role: message.author_role,
        last_author_user_id: message.author_user_id,
        unread: existing?.unread ?? false,
      };
      return {
        ...prev,
        summaries: existing
          ? prev.summaries.map((s) => (s === existing ? next : s))
          : [next, ...prev.summaries],
      };
    });
  }, []);

  const linkedThreadId = useMemo(
    () => new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get("thread"),
    [search],
  );

  const threads = useMemo(() => {
    const requestThreads = threadsFromWorkOrders(workOrders, { openedIds });
    if (!office) return requestThreads;

    if (office.viewer.role !== "admin") {
      // One "Office" thread of their own, always there so they can write first.
      const own = ownOfficeThread(office.viewer.userId, office.summaries[0]);
      return sortThreads(requestThreads, [own]);
    }

    const officeThreads = threadsFromOfficeSummaries(office.summaries, {
      people: office.people,
      viewerUserId: office.viewer.userId,
    });
    // A link to a person nobody has written to yet opens an empty thread for them.
    const linkedUserId = officeUserIdFromThreadId(linkedThreadId);
    const pinned =
      linkedUserId &&
      office.people.has(linkedUserId) &&
      !office.summaries.some((s) => s.thread_user_id === linkedUserId)
        ? [emptyOfficeThread(linkedUserId, office.people.get(linkedUserId))]
        : [];
    return sortThreads([...requestThreads, ...officeThreads], pinned);
  }, [workOrders, openedIds, office, linkedThreadId]);

  const unreadCount = threads.filter((t) => t.unread).length;

  const splitRef = useRef<HTMLDivElement | null>(null);
  const paneHeight = useAvailableHeight(splitRef, state === "ready" && threads.length > 0);

  // Deep-link ?thread=wo:123 or ?thread=office:<userId> — mark opened; clear
  // selection when param absent.
  useEffect(() => {
    const thread = linkedThreadId;
    if (thread && threads.some((t) => t.id === thread)) {
      setSelectedId(thread);
      setOpenedIds((prev) => {
        if (prev.has(thread)) return prev;
        return new Set(prev).add(thread);
      });
      setMobileThread(true);
      return;
    }
    if (!thread) {
      setSelectedId(null);
      setMobileThread(false);
    }
  }, [linkedThreadId, threads]);

  const selected: MessageThread | undefined = threads.find((t) => t.id === selectedId);
  const selectedRequestId =
    selected?.kind === "request" ? selected.requestId ?? null : null;
  const selectedOfficeUserId =
    selected?.kind === "office" ? selected.officeUserId ?? null : null;
  const selectedRequestIdRef = useRef(selectedRequestId);
  selectedRequestIdRef.current = selectedRequestId;

  useEffect(() => {
    setComments([]);
    setThreadError(null);

    if (selectedRequestId == null) {
      setThreadLoading(false);
      return;
    }

    let cancelled = false;
    setThreadLoading(true);
    void listMaintenanceComments(selectedRequestId)
      .then((rows) => {
        if (cancelled) return;
        // Defense in depth — landlords only see tenant_visible (RLS also enforces).
        setComments(
          isLandlord ? rows.filter((row) => row.visibility === "tenant_visible") : rows,
        );
        setThreadError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setComments([]);
        setThreadError((err as Error).message);
        setError((err as Error).message);
      })
      .finally(() => {
        if (!cancelled) setThreadLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedRequestId, threadReloadKey, listMaintenanceComments, setError, isLandlord]);

  function openThread(thread: MessageThread) {
    setSelectedId(thread.id);
    setOpenedIds((prev) => new Set(prev).add(thread.id));
    setMobileThread(true);
    if (replace) {
      replace(`/messages?thread=${encodeURIComponent(thread.id)}`);
    }
  }

  function closeMobileThread() {
    setMobileThread(false);
    if (replace) replace("/messages");
  }

  async function sendComment(body: string, visibility: CommentVisibility) {
    if (selectedRequestId == null || isLandlord) return;
    const requestId = selectedRequestId;
    try {
      const created = await addMaintenanceComment(requestId, body, visibility);
      // Drop if the user switched threads while the request was in flight.
      if (selectedRequestIdRef.current !== requestId) return;
      setComments((prev) => [...prev, created]);
    } catch (err) {
      setError((err as Error).message);
      // Rethrow so MessageComposer keeps the draft (its catch handles it).
      throw err;
    }
  }

  const currentRole = isAdmin
    ? "admin"
    : isTenant
      ? "tenant"
      : isLandlord
        ? "landlord"
        : "maintenance";

  const meta =
    state === "loading"
      ? "Loading…"
      : state === "error"
        ? "Couldn’t load"
        : unreadCount > 0
          ? `${unreadCount} unread`
          : "Inbox";

  const threadPane = selected ? (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-[100px] shrink-0 items-center gap-2 border-b border-border px-4 md:px-5">
        <button
          type="button"
          className="text-sm font-medium text-foreground md:hidden"
          onClick={closeMobileThread}
        >
          ← Back
        </button>
        {selected.kind === "request" ? (
          <Wrench className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        ) : selected.kind === "office" ? (
          <MessageSquare className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        ) : null}
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold">{selected.title}</h2>
        {selectedRequestId != null ? (
          <button
            type="button"
            className="shrink-0 text-[13px] font-medium text-brand-text hover:underline"
            onClick={() => navigate(`/maintenance?wo=${selectedRequestId}`)}
          >
            Open request
          </button>
        ) : null}
      </div>
      {selectedOfficeUserId != null && officeViewer ? (
        <OfficeConversation
          key={selectedOfficeUserId}
          threadUserId={selectedOfficeUserId}
          viewer={officeViewer}
          personLabel={officeViewer.role === "admin" ? selected.title : null}
          latestMessageAt={selected.updatedAt || null}
          onRead={handleOfficeRead}
          onLatestMessage={handleOfficeLatest}
        />
      ) : (
        <>
          <div className="min-h-0 flex-1 overflow-auto p-4 md:p-5">
            {threadLoading ? (
              <>
                <SkeletonRow />
                <SkeletonRow />
              </>
            ) : threadError ? (
              <ErrorRetry
                message={threadError}
                onRetry={() => setThreadReloadKey((k) => k + 1)}
              />
            ) : comments.length === 0 ? (
              <EmptyState
                message={
                  selected.stub
                    ? "Direct messages are stubbed — no message-center API yet."
                    : "No comments on this request yet. Send the first update."
                }
              />
            ) : (
              <ol className="space-y-3" aria-label="Messages">
                {comments.map((c) => {
                  const { label, outgoing } = commentSenderLabel(c, { currentRole });
                  return (
                    <li
                      key={c.id}
                      className={outgoing ? "flex justify-end" : "flex justify-start"}
                    >
                      <MessageBubble
                        sender={label}
                        body={c.body}
                        time={formatMessageTime(c.created_at)}
                        side={outgoing ? "outgoing" : "incoming"}
                        visibility={c.visibility}
                        showVisibilityLabel={!isTenant}
                      />
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
          <MessageComposer
            resetKey={selected.id}
            disabled={isLandlord || selected.kind !== "request"}
            placeholder={
              isLandlord
                ? "Landlord portal is read-only"
                : selected.kind !== "request"
                  ? "Direct messages unavailable (stub)"
                  : isTenant
                    ? "Message staff…"
                    : "Write a message…"
            }
            showVisibility={!isTenant && !isLandlord && selected.kind === "request"}
            visibility={commentVisibility}
            onVisibilityChange={setCommentVisibility}
            onSend={sendComment}
          />
        </>
      )}
    </div>
  ) : (
    <div className="hidden flex-1 items-center justify-center md:flex">
      <EmptyState message="Select a conversation to read and reply." />
    </div>
  );

  return (
    <PageShell
      title="Messages"
      meta={meta}
      width="max-w-none"
      actions={
        !isTenant && !isLandlord ? (
          <Button
            variant="brand"
            size="header"
            type="button"
            onClick={() => {
              // A worker's only direct conversation is the one with the office.
              const own =
                officeViewer && officeViewer.role !== "admin"
                  ? threads.find((t) => t.kind === "office")
                  : undefined;
              if (own) {
                openThread(own);
                return;
              }
              setNotice(
                "New message is stubbed — start from a work order comment thread for now.",
              );
            }}
          >
            New message
          </Button>
        ) : null
      }
    >
      {state === "loading" ? (
        <div className="-mx-6 -mt-2 border-y border-border">
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </div>
      ) : state === "error" ? (
        <ErrorRetry message={error ?? undefined} onRetry={() => void load()} />
      ) : threads.length === 0 ? (
        partialError ? (
          <ErrorRetry message={partialError} onRetry={() => void load()} />
        ) : (
          <EmptyState message="No conversations yet." />
        )
      ) : (
        <div
          ref={splitRef}
          className="-mx-6 -mb-6 -mt-2 flex min-h-[calc(100vh-8rem)] border-t border-border md:min-h-[calc(100vh-7rem)]"
          style={paneHeight ? { minHeight: paneHeight } : undefined}
        >
          <div
            className={
              mobileThread && selected
                ? "hidden w-full md:block md:w-[420px] md:shrink-0 md:border-r md:border-border"
                : "w-full md:w-[420px] md:shrink-0 md:border-r md:border-border"
            }
          >
            {partialError ? (
              <div
                role="alert"
                className="flex items-center justify-between gap-3 border-b border-border bg-destructive-tint px-4 py-3"
              >
                <p className="text-[13px] text-destructive">{partialError}</p>
                <button
                  type="button"
                  className="shrink-0 text-[13px] font-medium text-destructive underline"
                  onClick={() => void load()}
                >
                  Retry
                </button>
              </div>
            ) : null}
            <ul aria-label="Conversations">
              {threads.map((t) => (
                <li key={t.id}>
                  <MessageThreadRow
                    thread={t}
                    selected={t.id === selectedId}
                    onSelect={() => openThread(t)}
                  />
                </li>
              ))}
            </ul>
          </div>
          {/*
            The thread is one screen tall and scrolls inside itself, so the
            newest message and the composer stay in view however long the
            conversation (or the list beside it) gets.
          */}
          <div
            className={cn(
              "h-[calc(100dvh-8rem)] min-w-0 flex-1 flex-col md:sticky md:top-0 md:h-[calc(100dvh-7rem)] md:self-start",
              mobileThread && selected ? "flex" : "hidden md:flex",
            )}
            style={paneHeight ? { height: paneHeight } : undefined}
          >
            {threadPane}
          </div>
        </div>
      )}
    </PageShell>
  );
}
