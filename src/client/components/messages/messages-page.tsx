import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Wrench } from "lucide-react";
import { useApp } from "@/context";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorRetry, SkeletonRow } from "@/components/patterns";
import { MessageThreadRow } from "./message-thread-row";
import { MessageBubble } from "./message-bubble";
import { MessageComposer } from "./message-composer";
import { TenantMessagesPage } from "./tenant-messages-page";
import {
  commentSenderLabel,
  formatMessageTime,
  threadsFromWorkOrders,
  type MessageThread,
} from "@/lib/messages";
import type { CommentVisibility, MaintenanceComment, WorkOrder } from "@/types";

type LoadState = "loading" | "ready" | "error";

/**
 * Messages route entry.
 * Tenants: fully mocked Figma inbox/conversation (no messages tables).
 * Staff/landlord: request threads via MaintenanceRequestComments.
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
 * Figma 05 Messages — staff/landlord list + thread (WO comments).
 * Request threads use MaintenanceRequestComments; direct DMs are stubbed.
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
  const [state, setState] = useState<LoadState>("loading");
  const [error, setLocalError] = useState<string | null>(null);
  const [openedIds, setOpenedIds] = useState<Set<string>>(() => new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [comments, setComments] = useState<MaintenanceComment[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [mobileThread, setMobileThread] = useState(false);
  const [commentVisibility, setCommentVisibility] = useState<CommentVisibility>("internal");
  const [threadReloadKey, setThreadReloadKey] = useState(0);

  const load = useCallback(async () => {
    setState("loading");
    setLocalError(null);
    try {
      const list = await listWorkOrders();
      setWorkOrders(list);
      setState("ready");
    } catch (err) {
      setLocalError((err as Error).message);
      setState("error");
      setError((err as Error).message);
    }
  }, [listWorkOrders, setError]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setCommentVisibility(isTenant ? "tenant_visible" : "internal");
  }, [isTenant]);

  const threads = useMemo(
    () => threadsFromWorkOrders(workOrders, { openedIds }),
    [workOrders, openedIds],
  );

  const unreadCount = threads.filter((t) => t.unread).length;

  // Deep-link ?thread=wo:123 — mark opened; clear selection when param absent.
  useEffect(() => {
    const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
    const thread = params.get("thread");
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
  }, [search, threads]);

  const selected: MessageThread | undefined = threads.find((t) => t.id === selectedId);
  const selectedRequestId =
    selected?.kind === "request" ? selected.requestId ?? null : null;
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
      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-4 md:p-5">
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
          comments.map((c) => {
            const { label, outgoing } = commentSenderLabel(c, { currentRole });
            return (
              <div
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
              </div>
            );
          })
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
            onClick={() =>
              setNotice(
                "New message is stubbed — start from a work order comment thread for now.",
              )
            }
          >
            New message
          </Button>
        ) : null
      }
    >
      {state === "loading" ? (
        <div className="-mx-[var(--page-gutter,1.5rem)] -mt-2 border-y border-border">
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </div>
      ) : state === "error" ? (
        <ErrorRetry message={error ?? undefined} onRetry={() => void load()} />
      ) : threads.length === 0 ? (
        <EmptyState message="No request conversations yet. Comments on maintenance requests will show up here." />
      ) : (
        <div className="-mx-[var(--page-gutter,1.5rem)] -mb-6 -mt-2 flex min-h-[calc(100vh-var(--page-content-top,8rem))] border-t border-border md:min-h-[calc(100vh-var(--page-content-top,7rem))]">
          <div
            className={
              mobileThread && selected
                ? "hidden w-full md:block md:w-[420px] md:shrink-0 md:border-r md:border-border"
                : "w-full md:w-[420px] md:shrink-0 md:border-r md:border-border"
            }
          >
            {threads.map((t) => (
              <MessageThreadRow
                key={t.id}
                thread={t}
                selected={t.id === selectedId}
                onSelect={() => openThread(t)}
              />
            ))}
          </div>
          <div
            className={
              mobileThread && selected
                ? "flex min-w-0 flex-1 flex-col"
                : "hidden min-w-0 flex-1 flex-col md:flex"
            }
          >
            {threadPane}
          </div>
        </div>
      )}
    </PageShell>
  );
}
