import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Wrench } from "lucide-react";
import { useApp } from "@/context";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorRetry, SkeletonRow } from "@/components/patterns";
import { MessageBubble } from "./message-bubble";
import { MessageComposer } from "./message-composer";
import { cn } from "@/lib/utils";
import {
  commentSenderLabel,
  formatMessageTime,
  mergeMessageThreads,
  officeMessageSenderLabel,
  parseOfficeThreadId,
  resolveStaffMessagesDeepLink,
  threadsFromOfficeSummaries,
  threadsFromWorkOrders,
  type MessageThread,
} from "@/lib/messages";
import type { OfficeMessage } from "@/lib/data";
import { messagesLoadScenarioFromSearch } from "@/lib/tenant-messages-mock";
import { supabase } from "@/lib/supabase";
import type { MaintenanceComment, WorkOrder } from "@/types";

type LoadState = "loading" | "ready" | "error";

/**
 * Tenant Messages — Figma M/T/D inbox + conversation, backed by:
 * - OfficeMessages (one direct thread with the Landlord Gopher office)
 * - MaintenanceRequestComments on the tenant's work orders
 *
 * Deep links: `?thread=wo:<id>` / `?thread=office:<uuid>` / `?request=<pk>`
 * Demo: `?demo=empty|error` still exercises empty/error UI without a backend miss.
 */
export function TenantMessagesPage({
  search = "",
  navigate,
  replace,
}: {
  search?: string;
  navigate: (to: string) => void;
  replace?: (to: string) => void;
}) {
  const {
    listWorkOrders,
    listMaintenanceComments,
    addMaintenanceComment,
    listOfficeThreads,
    listOfficeMessages,
    sendOfficeMessage,
    markOfficeThreadRead,
    setError,
  } = useApp();

  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [officeSummaries, setOfficeSummaries] = useState<
    Awaited<ReturnType<typeof listOfficeThreads>>
  >([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setLocalError] = useState<string | null>(null);
  const [openedIds, setOpenedIds] = useState<Set<string>>(() => new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileThread, setMobileThread] = useState(false);
  const [deepLinkMiss, setDeepLinkMiss] = useState<string | null>(null);
  const [comments, setComments] = useState<MaintenanceComment[]>([]);
  const [officeMessages, setOfficeMessages] = useState<OfficeMessage[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [threadReloadKey, setThreadReloadKey] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);

  const loadScenario = useMemo(() => messagesLoadScenarioFromSearch(search), [search]);

  const load = useCallback(async () => {
    setState("loading");
    setLocalError(null);
    try {
      if (loadScenario === "error") {
        throw new Error("Couldn’t load messages right now. Try again.");
      }
      if (loadScenario === "empty") {
        const { data: auth } = await supabase.auth.getUser();
        setCurrentUserId(auth.user?.id ?? null);
        setWorkOrders([]);
        setOfficeSummaries([]);
        setState("ready");
        return;
      }
      const [{ data: auth }, list, office] = await Promise.all([
        supabase.auth.getUser(),
        listWorkOrders(),
        listOfficeThreads(),
      ]);
      setCurrentUserId(auth.user?.id ?? null);
      setWorkOrders(list);
      setOfficeSummaries(office);
      setState("ready");
    } catch (err) {
      setLocalError((err as Error).message);
      setState("error");
      setError((err as Error).message);
    }
  }, [listWorkOrders, listOfficeThreads, setError, loadScenario]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  const conversations = useMemo(() => {
    if (loadScenario === "empty") return [];
    const requestThreads = threadsFromWorkOrders(workOrders, { openedIds });
    const direct = threadsFromOfficeSummaries(officeSummaries, {
      ensureOwnThread: currentUserId
        ? { userId: currentUserId, title: "Landlord Gopher office" }
        : undefined,
    });
    // Prefer office title for the tenant's own thread.
    return mergeMessageThreads(
      direct.map((t) =>
        t.threadUserId === currentUserId
          ? { ...t, title: "Landlord Gopher office" }
          : t,
      ),
      requestThreads,
    );
  }, [workOrders, officeSummaries, openedIds, currentUserId, loadScenario]);

  const unread = useMemo(
    () => conversations.filter((c) => c.unread).length,
    [conversations],
  );

  useEffect(() => {
    if (state !== "ready") return;
    const link = resolveStaffMessagesDeepLink(search, conversations);

    if (link.kind === "thread") {
      setSelectedId(link.threadId);
      setOpenedIds((prev) => new Set(prev).add(link.threadId));
      setMobileThread(true);
      setDeepLinkMiss(null);
      return;
    }

    if (link.kind === "request") {
      setSelectedId(link.threadId);
      setOpenedIds((prev) => new Set(prev).add(link.threadId));
      setMobileThread(true);
      setDeepLinkMiss(null);
      return;
    }

    if (link.kind === "not-found") {
      setSelectedId(null);
      setMobileThread(true);
      setDeepLinkMiss(link.raw || "unknown");
      return;
    }

    setDeepLinkMiss(null);
    setSelectedId((prev) => prev ?? conversations[0]?.id ?? null);
    setMobileThread(false);
  }, [search, conversations, state]);

  const selected: MessageThread | undefined = conversations.find((c) => c.id === selectedId);
  const selectedRequestId = selected?.kind === "request" ? (selected.requestId ?? null) : null;
  const selectedThreadUserId =
    selected?.kind === "direct"
      ? (selected.threadUserId ?? parseOfficeThreadId(selected.id))
      : null;

  const selectedRequestIdRef = useRef(selectedRequestId);
  selectedRequestIdRef.current = selectedRequestId;
  const selectedThreadUserIdRef = useRef(selectedThreadUserId);
  selectedThreadUserIdRef.current = selectedThreadUserId;

  useEffect(() => {
    setComments([]);
    setOfficeMessages([]);
    setThreadError(null);

    if (selectedRequestId != null) {
      let cancelled = false;
      setThreadLoading(true);
      void listMaintenanceComments(selectedRequestId)
        .then((rows) => {
          if (cancelled) return;
          setComments(rows.filter((r) => r.visibility === "tenant_visible"));
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
    }

    if (selectedThreadUserId) {
      let cancelled = false;
      setThreadLoading(true);
      void listOfficeMessages(selectedThreadUserId)
        .then(async (rows) => {
          if (cancelled) return;
          setOfficeMessages(rows);
          setThreadError(null);
          try {
            await markOfficeThreadRead(selectedThreadUserId);
            setOfficeSummaries((prev) =>
              prev.map((t) =>
                t.thread_user_id === selectedThreadUserId ? { ...t, unread: false } : t,
              ),
            );
          } catch {
            // best-effort
          }
        })
        .catch((err) => {
          if (cancelled) return;
          setOfficeMessages([]);
          setThreadError((err as Error).message);
          setError((err as Error).message);
        })
        .finally(() => {
          if (!cancelled) setThreadLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }

    setThreadLoading(false);
  }, [
    selectedRequestId,
    selectedThreadUserId,
    threadReloadKey,
    listMaintenanceComments,
    listOfficeMessages,
    markOfficeThreadRead,
    setError,
  ]);

  const showMobileConversation = Boolean(mobileThread && (selected || deepLinkMiss));

  function openThread(conversation: MessageThread) {
    setSelectedId(conversation.id);
    setOpenedIds((prev) => new Set(prev).add(conversation.id));
    setMobileThread(true);
    setDeepLinkMiss(null);
    if (replace) {
      replace(`/messages?thread=${encodeURIComponent(conversation.id)}`);
    }
  }

  function closeMobileThread() {
    setMobileThread(false);
    setDeepLinkMiss(null);
    if (replace) replace("/messages");
  }

  async function sendOnRequest(body: string) {
    if (selectedRequestId == null) return;
    const requestId = selectedRequestId;
    try {
      const created = await addMaintenanceComment(requestId, body, "tenant_visible");
      if (selectedRequestIdRef.current !== requestId) return;
      setComments((prev) => [...prev, created]);
    } catch (err) {
      setError((err as Error).message);
      throw err;
    }
  }

  async function sendOnOffice(body: string) {
    if (!selectedThreadUserId) return;
    const threadUserId = selectedThreadUserId;
    try {
      const created = await sendOfficeMessage(threadUserId, body);
      if (selectedThreadUserIdRef.current !== threadUserId) return;
      setOfficeMessages((prev) => [...prev, created]);
      setOfficeSummaries((prev) => {
        const rest = prev.filter((t) => t.thread_user_id !== threadUserId);
        return [
          {
            thread_user_id: threadUserId,
            last_message_at: created.created_at,
            last_message_body: created.body,
            last_author_role: created.author_role,
            last_author_user_id: created.author_user_id,
            unread: false,
          },
          ...rest,
        ];
      });
      void markOfficeThreadRead(threadUserId).catch(() => undefined);
    } catch (err) {
      setError((err as Error).message);
      throw err;
    }
  }

  const hero = (
    <header className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        The right people, in one place
      </p>
      <h2 className="text-[2.125rem] font-semibold leading-[2.625rem] tracking-[-0.01em] text-foreground">
        Messages
      </h2>
      <p className="text-sm text-muted-foreground md:hidden">
        Your home. Your conversations.
      </p>
      <p className="hidden text-sm text-muted-foreground md:block">
        Conversations for your home and your maintenance requests.
      </p>
    </header>
  );

  const mobileConversationHero = (
    <header className="space-y-3">
      <button
        type="button"
        onClick={closeMobileThread}
        className="text-sm font-medium text-brand-text hover:underline"
      >
        ← Back to inbox
      </button>
      <h2 className="text-2xl font-semibold leading-8 text-foreground">Messages</h2>
    </header>
  );

  const notFoundEmpty = (
    <EmptyState
      message={
        deepLinkMiss
          ? `No conversation for “${deepLinkMiss}”. Pick a thread from your inbox, or open the request from Requests.`
          : "Select a conversation to read and reply."
      }
      actionLabel={deepLinkMiss ? "Back to requests" : undefined}
      onAction={deepLinkMiss ? () => navigate("/maintenance") : undefined}
    />
  );

  const inboxCard = (
    <section
      aria-label={unread > 0 ? `Inbox, ${unread} unread` : "Inbox, all caught up"}
      className="overflow-hidden rounded-lg border border-border bg-card"
    >
      <div className="flex items-center justify-between gap-3 px-5 py-5">
        <h3 className="text-lg font-semibold leading-[1.625rem] text-foreground">Inbox</h3>
        <p className="text-xs text-brand-text" aria-hidden={unread > 0 ? undefined : true}>
          {unread > 0 ? `${unread} unread` : "All caught up"}
        </p>
      </div>
      <ul className="border-t border-border">
        {conversations.map((c) => {
          const time = formatMessageTime(c.updatedAt);
          return (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => openThread(c)}
                className={cn(
                  "flex min-h-[7.375rem] w-full items-center gap-3 border-b border-border px-4 py-3.5 text-left transition-colors",
                  c.id === selectedId ? "bg-brand-tint" : "bg-card hover:bg-muted/50",
                )}
                aria-current={c.id === selectedId ? "true" : undefined}
                aria-label={
                  c.unread
                    ? `${c.title}, unread. ${c.preview}. ${time}`
                    : `${c.title}. ${c.preview}. ${time}`
                }
              >
                <div className="flex h-full w-2 shrink-0 items-center justify-center">
                  {c.unread ? (
                    <span className="size-2 rounded-full bg-brand" aria-hidden />
                  ) : null}
                </div>
                <div className="min-w-0 flex-1" aria-hidden>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1.5">
                      {c.kind === "request" ? (
                        <Wrench className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      ) : null}
                      <span className="truncate text-sm font-semibold text-foreground">
                        {c.title}
                      </span>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">{time}</span>
                  </div>
                  <p className="mt-1 truncate text-[13px] text-muted-foreground">{c.preview}</p>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="space-y-1 px-5 py-5">
        <p className="text-sm font-medium text-foreground">Property office</p>
        <p className="text-sm text-muted-foreground">
          Message Landlord Gopher directly, or open a request thread.
        </p>
      </div>
    </section>
  );

  const conversationPaneClass =
    "flex h-[min(32rem,calc(100dvh-12rem))] max-h-[calc(100dvh-12rem)] flex-col overflow-hidden rounded-lg border border-border bg-card";

  const isDirect = selected?.kind === "direct";
  const threadBody = threadLoading ? (
    <>
      <SkeletonRow />
      <SkeletonRow />
    </>
  ) : threadError ? (
    <ErrorRetry message={threadError} onRetry={() => setThreadReloadKey((k) => k + 1)} />
  ) : isDirect ? (
    officeMessages.length === 0 ? (
      <EmptyState message="No messages yet. Say hello to the office." />
    ) : (
      officeMessages.map((m) => {
        const { label, outgoing } = officeMessageSenderLabel(m, {
          currentUserId,
          currentRole: "tenant",
        });
        return (
          <div
            key={m.id}
            className={outgoing ? "flex justify-end" : "flex justify-start"}
          >
            <MessageBubble
              sender={label}
              body={m.body}
              time={formatMessageTime(m.created_at)}
              side={outgoing ? "outgoing" : "incoming"}
            />
          </div>
        );
      })
    )
  ) : comments.length === 0 ? (
    <EmptyState message="No messages on this request yet. Send the first update." />
  ) : (
    comments.map((c) => {
      const { label, outgoing } = commentSenderLabel(c, { currentRole: "tenant" });
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
          />
        </div>
      );
    })
  );

  const conversationCard = selected ? (
    <section
      aria-label={`Conversation ${selected.title}`}
      className={conversationPaneClass}
    >
      <div className="shrink-0 space-y-3 border-b border-border px-5 py-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <h3 className="text-lg font-semibold leading-[1.625rem] text-foreground">
            {selected.title}
          </h3>
          {selectedRequestId != null ? (
            <Button
              type="button"
              variant="secondary"
              size="lg"
              className="min-h-11 w-full sm:w-auto sm:min-w-[10rem]"
              onClick={() => navigate(`/maintenance?wo=${selectedRequestId}`)}
            >
              Open request
            </Button>
          ) : null}
        </div>
        <div className="space-y-0.5">
          <p className="text-xs text-muted-foreground">
            {isDirect
              ? "You · Landlord Gopher office"
              : "You · assigned request members"}
          </p>
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-5">
        {threadBody}
        <p className="pt-2 text-xs text-muted-foreground">
          Only members of this conversation can view or reply.
        </p>
      </div>
      <div className="shrink-0">
        <MessageComposer
          resetKey={selected.id}
          placeholder="Write a message…"
          onSend={async (body) => {
            if (isDirect) await sendOnOffice(body);
            else await sendOnRequest(body);
          }}
        />
      </div>
    </section>
  ) : (
    <section className={cn(conversationPaneClass, "items-center justify-center")}>
      {notFoundEmpty}
    </section>
  );

  return (
    <PageShell
      title="Messages"
      meta={state === "ready" && unread > 0 ? `${unread} unread` : "Inbox"}
      width="max-w-none"
    >
      {state === "loading" ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading messages">
          {hero}
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </div>
      ) : state === "error" ? (
        <div className="space-y-6">
          {hero}
          <ErrorRetry
            message={error ?? "Couldn’t load messages."}
            onRetry={() => setReloadKey((k) => k + 1)}
          />
        </div>
      ) : conversations.length === 0 && !deepLinkMiss ? (
        <div className="space-y-6">
          {hero}
          <EmptyState message="No conversations yet. When you message the office or open a request, threads show up here." />
          <p className="text-center text-xs text-muted-foreground">
            Private by membership. Request threads are limited to authorized participants.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          <div className={cn(showMobileConversation ? "block md:hidden" : "hidden")}>
            {mobileConversationHero}
            <div className="mt-4">{conversationCard}</div>
          </div>

          <div className={cn(showMobileConversation ? "hidden md:block" : "block")}>
            {hero}
            <div className="mt-6 flex flex-col gap-6 lg:flex-row lg:items-stretch">
              <div className="w-full lg:w-[360px] lg:shrink-0">{inboxCard}</div>
              <div
                className={cn(
                  "min-w-0 flex-1",
                  deepLinkMiss && !selected ? "flex md:flex" : "hidden md:block",
                )}
              >
                {conversationCard}
              </div>
            </div>
            <p className="mt-6 text-center text-xs text-muted-foreground md:text-left">
              <span className="md:hidden">Only conversation members can read or reply.</span>
              <span className="hidden md:inline">
                Private by membership. Request threads are limited to authorized participants.
              </span>
            </p>
          </div>
        </div>
      )}
    </PageShell>
  );
}
