import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MessageSquare, Wrench } from "lucide-react";
import { useApp } from "@/context";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorRetry, SkeletonRow } from "@/components/patterns";
import * as data from "@/lib/data";
import {
  announceInboxChanged,
  countUnreadConversations,
  createInboxReadMarker,
  listOfficeMessages,
  loadAdminInbox,
  officeKey,
  requestKey,
  sendOfficeMessage,
  type InboxConversation,
  type InboxLastMessage,
} from "@/lib/inbox";
import {
  adminInboxThreads,
  commentSenderLabel,
  formatMessageTime,
  type InboxDirectory,
  type MessageThread,
} from "@/lib/messages";
import { supabase } from "@/lib/supabase";
import type { CommentVisibility, WorkOrder } from "@/types";
import { MessageBubble } from "./message-bubble";
import { MessageComposer } from "./message-composer";
import { MessageThreadRow } from "./message-thread-row";

type LoadState = "loading" | "ready" | "error";

/** One bubble in the open conversation, whichever table it came from. */
type ShownMessage = {
  key: string;
  sender: string;
  body: string;
  at: string;
  outgoing: boolean;
  visibility?: CommentVisibility;
};

const EMPTY_PEOPLE: InboxDirectory = { accounts: [], staff: [], tenants: [], landlords: [] };

/** A secondary read: a failure becomes `fallback` and only its own detail degrades. */
function soft<T>(promise: Promise<T>, fallback: T): Promise<T> {
  return promise.catch(() => fallback);
}

/** "Tina Renter · Unit 1A" → "Tina Renter". */
const nameOf = (counterpart: string | undefined) => counterpart?.split(" · ")[0] || "Them";

/**
 * Admin Messages: the office inbox. Direct threads with tenants, landlords and
 * team members (OfficeMessages) and every request's comment thread, each row
 * led by who the conversation is with. Unread uses the shared inbox rule
 * (lib/inbox.ts), so the header count matches the dashboard KPI and the rail
 * badge; opening a conversation records it as read for this admin.
 */
export function AdminMessagesPage({
  search = "",
  navigate,
  replace,
}: {
  search?: string;
  navigate: (to: string) => void;
  replace?: (to: string) => void;
}) {
  const { listWorkOrders, listMaintenanceComments, addMaintenanceComment, setError, setNotice, landlords } = useApp();

  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  /** null = the inbox could not be read; rows then show without unread state. */
  const [inbox, setInbox] = useState<InboxConversation[] | null>(null);
  const [people, setPeople] = useState<Omit<InboxDirectory, "landlords">>(EMPTY_PEOPLE);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setLocalError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ShownMessage[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [mobileThread, setMobileThread] = useState(false);
  const [commentVisibility, setCommentVisibility] = useState<CommentVisibility>("internal");
  const [threadReloadKey, setThreadReloadKey] = useState(0);
  const [myUserId, setMyUserId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (!cancelled) setMyUserId(session?.user.id ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(async () => {
    setState("loading");
    setLocalError(null);
    try {
      const [list, conversations, accounts, staff, tenants] = await Promise.all([
        listWorkOrders(),
        soft<InboxConversation[] | null>(loadAdminInbox(), null),
        soft(data.listUserAccounts(), []),
        soft(data.listStaff(), []),
        soft(data.listTenants(), []),
      ]);
      setWorkOrders(list);
      setInbox(conversations);
      setPeople({ accounts, staff, tenants });
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

  const threads = useMemo(
    () => adminInboxThreads({ workOrders, inbox: inbox ?? [], people: { ...people, landlords } }),
    [workOrders, inbox, people, landlords],
  );
  // The shared inbox count — the same number as the rail badge and the dashboard KPI.
  const unreadCount = inbox ? countUnreadConversations(inbox) : 0;

  const inboxRef = useRef(inbox);
  inboxRef.current = inbox;

  /**
   * Records conversations as read for this admin, then lets the rail badge
   * catch up. It decides when to write (lib/inbox.ts), so re-renders of this
   * page — including the one a failed write causes — never write again.
   */
  const [reads] = useState(() =>
    createInboxReadMarker({
      getConversation: (key) => inboxRef.current?.find((c) => c.key === key),
      setUnread: (key, unread) =>
        setInbox((prev) => prev?.map((c) => (c.key === key ? { ...c, unread } : c)) ?? prev),
      onWritten: announceInboxChanged,
    }),
  );

  // Deep-link ?thread=wo:123 | office:<user id> — open it; clear selection when absent.
  useEffect(() => {
    const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
    const thread = params.get("thread");
    if (thread && threads.some((t) => t.id === thread)) {
      setSelectedId(thread);
      setMobileThread(true);
      // Once per id: this effect re-runs whenever `threads` changes.
      reads.follow(thread);
      return;
    }
    if (!thread) {
      reads.follow(null);
      setSelectedId(null);
      setMobileThread(false);
    }
  }, [search, threads, reads]);

  const selected: MessageThread | undefined = threads.find((t) => t.id === selectedId);
  const selectedRequestId = selected?.kind === "request" ? (selected.requestId ?? null) : null;
  const selectedThreadUserId = selected?.kind === "direct" ? (selected.threadUserId ?? null) : null;
  const selectedName = nameOf(selected?.counterpart);
  const selectedKeyRef = useRef(selectedId);
  selectedKeyRef.current = selectedId;

  useEffect(() => {
    setMessages([]);
    setThreadError(null);
    if (selectedRequestId == null && selectedThreadUserId == null) {
      setThreadLoading(false);
      return;
    }

    let cancelled = false;
    setThreadLoading(true);
    const read: Promise<ShownMessage[]> =
      selectedRequestId != null
        ? listMaintenanceComments(selectedRequestId).then((rows) =>
            rows.map((c) => {
              const { label, outgoing } = commentSenderLabel(c, { currentRole: "admin" });
              return {
                key: `c-${c.id}`,
                sender: label,
                body: c.body,
                at: c.created_at,
                outgoing,
                visibility: c.visibility,
              };
            }),
          )
        : listOfficeMessages(selectedThreadUserId!).then((rows) =>
            rows.map((m) => {
              const outgoing = m.author_role === "admin";
              return {
                key: `o-${m.id}`,
                sender: outgoing ? (m.author_user_id === myUserId ? "You · Admin" : "Admin") : selectedName,
                body: m.body,
                at: m.created_at,
                outgoing,
              };
            }),
          );
    const key = selectedRequestId != null ? requestKey(selectedRequestId) : officeKey(selectedThreadUserId!);
    void read
      .then((rows) => {
        if (cancelled) return;
        setMessages(rows);
        setThreadError(null);
        // Someone may have written since the inbox loaded: read through what is on screen.
        const newest = rows.reduce<string | null>(
          (best, m) => (best == null || Date.parse(m.at) > Date.parse(best) ? m.at : best),
          null,
        );
        if (newest) reads.seen(key, newest);
      })
      .catch((err) => {
        if (cancelled) return;
        setMessages([]);
        setThreadError((err as Error).message);
        setError((err as Error).message);
      })
      .finally(() => {
        if (!cancelled) setThreadLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedRequestId, selectedThreadUserId, selectedName, myUserId, threadReloadKey, listMaintenanceComments, setError, reads]);

  function openThread(thread: MessageThread) {
    setSelectedId(thread.id);
    setMobileThread(true);
    reads.open(thread.id);
    if (replace) replace(`/messages?thread=${encodeURIComponent(thread.id)}`);
  }

  function closeMobileThread() {
    setMobileThread(false);
    if (replace) replace("/messages");
  }

  /** The office just wrote: it is now the latest message, so the conversation is answered. */
  function recordReply(
    key: string,
    base: { kind: "request"; requestId: number } | { kind: "office"; threadUserId: string },
    last: InboxLastMessage,
  ) {
    setInbox((prev) => {
      if (!prev) return prev;
      const others = prev.filter((c) => c.key !== key);
      return [{ ...base, key, last, unread: false } as InboxConversation, ...others];
    });
    announceInboxChanged();
  }

  async function send(body: string, visibility: CommentVisibility) {
    const key = selectedId;
    try {
      if (selectedRequestId != null) {
        const requestId = selectedRequestId;
        const created = await addMaintenanceComment(requestId, body, visibility);
        recordReply(requestKey(requestId), { kind: "request", requestId }, {
          at: created.created_at,
          body: created.body,
          authorRole: "admin",
          authorUserId: myUserId,
          authorTenantId: null,
          authorStaffId: created.author_staff_id,
        });
        // Drop if the admin switched threads while the request was in flight.
        if (selectedKeyRef.current !== key) return;
        const { label, outgoing } = commentSenderLabel(created, { currentRole: "admin" });
        setMessages((prev) => [
          ...prev,
          { key: `c-${created.id}`, sender: label, body: created.body, at: created.created_at, outgoing, visibility: created.visibility },
        ]);
      } else if (selectedThreadUserId != null) {
        const threadUserId = selectedThreadUserId;
        const created = await sendOfficeMessage(threadUserId, body);
        recordReply(officeKey(threadUserId), { kind: "office", threadUserId }, {
          at: created.created_at,
          body: created.body,
          authorRole: "admin",
          authorUserId: created.author_user_id,
          authorTenantId: null,
          authorStaffId: null,
        });
        if (selectedKeyRef.current !== key) return;
        setMessages((prev) => [
          ...prev,
          { key: `o-${created.id}`, sender: "You · Admin", body: created.body, at: created.created_at, outgoing: true },
        ]);
      }
    } catch (err) {
      setError((err as Error).message);
      // Rethrow so MessageComposer keeps the draft (its catch handles it).
      throw err;
    }
  }

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
        <button type="button" className="text-sm font-medium text-foreground md:hidden" onClick={closeMobileThread}>
          ← Back
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold">{selected.counterpart ?? selected.title}</h2>
          <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[13px] text-muted-foreground">
            {selected.kind === "request" ? (
              <Wrench className="size-3.5 shrink-0" aria-hidden />
            ) : (
              <MessageSquare className="size-3.5 shrink-0" aria-hidden />
            )}
            <span className="truncate">{selected.title}</span>
          </p>
        </div>
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
          <ErrorRetry message={threadError} onRetry={() => setThreadReloadKey((k) => k + 1)} />
        ) : messages.length === 0 ? (
          <EmptyState
            message={
              selected.kind === "request"
                ? "No comments on this request yet. Send the first update."
                : "No messages in this conversation yet."
            }
          />
        ) : (
          messages.map((m) => (
            <div key={m.key} className={m.outgoing ? "flex justify-end" : "flex justify-start"}>
              <MessageBubble
                sender={m.sender}
                body={m.body}
                time={formatMessageTime(m.at)}
                side={m.outgoing ? "outgoing" : "incoming"}
                visibility={m.visibility}
                showVisibilityLabel={selected.kind === "request"}
              />
            </div>
          ))
        )}
      </div>
      <MessageComposer
        resetKey={selected.id}
        placeholder={selected.kind === "request" ? "Write a message…" : `Reply to ${selectedName}…`}
        showVisibility={selected.kind === "request"}
        visibility={commentVisibility}
        onVisibilityChange={setCommentVisibility}
        onSend={send}
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
        <Button
          variant="brand"
          size="header"
          type="button"
          onClick={() => setNotice("Starting a new conversation from here is coming soon. For now, open the maintenance request and post a comment there.")}
        >
          New message
        </Button>
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
        <EmptyState message="No conversations yet. Messages from tenants, landlords and your team, and comments on maintenance requests, will show up here." />
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
              <MessageThreadRow key={t.id} thread={t} selected={t.id === selectedId} onSelect={() => openThread(t)} />
            ))}
          </div>
          <div className={mobileThread && selected ? "flex min-w-0 flex-1 flex-col" : "hidden min-w-0 flex-1 flex-col md:flex"}>
            {threadPane}
          </div>
        </div>
      )}
    </PageShell>
  );
}
