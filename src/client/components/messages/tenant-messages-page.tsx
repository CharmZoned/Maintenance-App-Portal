import { useCallback, useEffect, useMemo, useState } from "react";
import { Wrench } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorRetry, SkeletonRow } from "@/components/patterns";
import { MessageBubble } from "./message-bubble";
import { MessageComposer } from "./message-composer";
import { cn } from "@/lib/utils";
import {
  createSyntheticRequestThread,
  loadTenantMessagesMock,
  messagesLoadScenarioFromSearch,
  MOCK_THREAD_IDS,
  resolveMessagesDeepLink,
  unreadCount,
  type MockConversation,
  type MockMessage,
  type TenantMessagesMockBundle,
} from "@/lib/tenant-messages-mock";

type LoadState = "loading" | "ready" | "error";

/**
 * Tenant Messages — Figma M/T/D inbox + conversation (fully mocked).
 * Phone: list vs thread as separate screens. Tablet: stacked. Desktop: split.
 *
 * Deep-link contract (Requests → Messages):
 * - `/messages?request=<workOrderId>` — `workOrderId` is MaintenanceRequests
 *   **primary key** (`order.id`). Match demo `linkedRequestIds` / WO number soft
 *   keys when possible; otherwise open a synthetic request thread for that id
 *   so phone never lands on a silent unselected inbox.
 * - `/messages?thread=<mockThreadId>` — in-page selection / phone thread.
 *   Unknown thread → not-found empty on mobile + desktop.
 *
 * // TODO(data-gap): messages backend not available
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
  const [bundle, setBundle] = useState<TenantMessagesMockBundle | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setLocalError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileThread, setMobileThread] = useState(false);
  /** Unknown `?thread=` (or empty `?request=`) — show empty on phone + desktop. */
  const [deepLinkMiss, setDeepLinkMiss] = useState<string | null>(null);
  const [localMessages, setLocalMessages] = useState<Record<string, MockMessage[]>>(
    {},
  );
  const [reloadKey, setReloadKey] = useState(0);

  const loadScenario = useMemo(() => messagesLoadScenarioFromSearch(search), [search]);

  const load = useCallback(async () => {
    setState("loading");
    setLocalError(null);
    try {
      // TODO(data-gap): messages backend not available
      // Reachable empty/error via ?demo=empty|error (see messagesLoadScenarioFromSearch).
      const data = await loadTenantMessagesMock({ scenario: loadScenario });
      setBundle(data);
      setLocalMessages(
        Object.fromEntries(data.conversations.map((c) => [c.id, [...c.messages]])),
      );
      setState("ready");
    } catch (err) {
      setLocalError((err as Error).message);
      setState("error");
    }
  }, [loadScenario]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  const conversations = bundle?.conversations ?? [];

  // Resolve ?request= (Requests PK) and ?thread= (inbox) per deep-link contract.
  useEffect(() => {
    if (state !== "ready") return;
    const link = resolveMessagesDeepLink(search, conversations);

    if (link.kind === "thread") {
      setSelectedId(link.threadId);
      setMobileThread(true);
      setDeepLinkMiss(null);
      return;
    }

    if (link.kind === "request") {
      if (link.synthetic) {
        // Ensure a conversation exists for this real order.id / uuid.
        // TODO(data-gap): messages backend not available
        setBundle((prev) => {
          if (!prev) return prev;
          if (prev.conversations.some((c) => c.id === link.threadId)) return prev;
          const synthetic = createSyntheticRequestThread(link.requestId);
          return {
            ...prev,
            conversations: [synthetic, ...prev.conversations],
          };
        });
        setLocalMessages((prev) =>
          prev[link.threadId] ? prev : { ...prev, [link.threadId]: [] },
        );
      }
      setSelectedId(link.threadId);
      setMobileThread(true);
      setDeepLinkMiss(null);
      return;
    }

    if (link.kind === "not-found") {
      setSelectedId(null);
      setMobileThread(true);
      setDeepLinkMiss(link.requestId || "unknown");
      return;
    }

    // No deep-link — desktop/tablet Figma shows WO-1842 selected by default.
    setDeepLinkMiss(null);
    setSelectedId((prev) => prev ?? MOCK_THREAD_IDS.leakingTap);
    setMobileThread(false);
  }, [search, conversations, state]);

  const selected: MockConversation | undefined = conversations.find(
    (c) => c.id === selectedId,
  );
  const threadMessages = selectedId ? (localMessages[selectedId] ?? []) : [];
  const unread = useMemo(() => unreadCount(conversations), [conversations]);
  const showMobileConversation = Boolean(mobileThread && (selected || deepLinkMiss));

  function openThread(conversation: MockConversation) {
    setSelectedId(conversation.id);
    setMobileThread(true);
    setDeepLinkMiss(null);
    // Mark read locally only — no read-state API.
    // TODO(data-gap): messages backend not available
    setBundle((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        conversations: prev.conversations.map((c) =>
          c.id === conversation.id ? { ...c, unread: false } : c,
        ),
      };
    });
    if (replace) {
      replace(`/messages?thread=${encodeURIComponent(conversation.id)}`);
    }
  }

  function closeMobileThread() {
    setMobileThread(false);
    setDeepLinkMiss(null);
    if (replace) replace("/messages");
  }

  async function sendMockMessage(body: string) {
    if (!selectedId) return;
    // TODO(data-gap): messages backend not available — local append only
    const now = new Date();
    const timeLabel = `Today ${now.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    })}`;
    const next: MockMessage = {
      id: `local-${Date.now()}`,
      sender: "You",
      body,
      timeLabel,
      side: "outgoing",
    };
    setLocalMessages((prev) => ({
      ...prev,
      [selectedId]: [...(prev[selectedId] ?? []), next],
    }));
    setBundle((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        conversations: prev.conversations.map((c) =>
          c.id === selectedId
            ? { ...c, preview: body, timeLabel, unread: false }
            : c,
        ),
      };
    });
  }

  function openLinkedRequest(path: string | undefined) {
    if (!path) return;
    // Thin affordance — does not load a chat-linked work order.
    // TODO(data-gap): messages backend not available
    navigate(path);
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
        // TODO(data-gap): messages backend not available
        deepLinkMiss
          ? `No conversation for “${deepLinkMiss}” yet. Messaging isn’t connected — pick a thread from your inbox, or open the request from Requests.`
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
        {conversations.map((c) => (
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
                  ? `${c.title}, unread. ${c.preview}. ${c.timeLabel}`
                  : `${c.title}. ${c.preview}. ${c.timeLabel}`
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
                  <span className="shrink-0 text-xs text-muted-foreground">{c.timeLabel}</span>
                </div>
                <p className="mt-1 truncate text-[13px] text-muted-foreground">{c.preview}</p>
              </div>
            </button>
          </li>
        ))}
      </ul>
      {bundle ? (
        <div className="space-y-1 px-5 py-5">
          <p className="text-sm font-medium text-foreground">{bundle.propertyManagerTitle}</p>
          <p className="text-sm text-muted-foreground">{bundle.propertyManagerDetail}</p>
        </div>
      ) : null}
    </section>
  );

  // Cap pane to viewport so Send stays above the fold on laptop (messages scroll).
  const conversationPaneClass =
    "flex h-[min(32rem,calc(100dvh-12rem))] max-h-[calc(100dvh-12rem)] flex-col overflow-hidden rounded-lg border border-border bg-card";

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
          {selected.openRequestPath ? (
            <Button
              type="button"
              variant="secondary"
              size="lg"
              className="min-h-11 w-full sm:w-auto sm:min-w-[10rem]"
              onClick={() => openLinkedRequest(selected.openRequestPath)}
            >
              Open request
            </Button>
          ) : null}
        </div>
        <div className="space-y-0.5">
          {selected.participants.map((line) => (
            <p key={line} className="text-xs text-muted-foreground">
              {line}
            </p>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-5">
        {threadMessages.length === 0 ? (
          <EmptyState
            message={
              // TODO(data-gap): messages backend not available
              selected.id.startsWith("mock:request:")
                ? "No messages for this request yet. Chat isn’t connected — you can still open the request, or write a local demo reply."
                : "No messages in this conversation yet."
            }
          />
        ) : (
          threadMessages.map((m) => (
            <div
              key={m.id}
              className={m.side === "outgoing" ? "flex justify-end" : "flex justify-start"}
            >
              <MessageBubble
                sender={m.sender}
                body={m.body}
                time={m.timeLabel}
                side={m.side}
              />
            </div>
          ))
        )}
        <p className="pt-2 text-xs text-muted-foreground">
          Only members of this conversation can view or reply.
        </p>
      </div>
      <div className="shrink-0">
        <MessageComposer
          // TODO(data-gap): messages backend not available — send stays local
          resetKey={selected.id}
          placeholder="Write a message…"
          onSend={async (body) => {
            await sendMockMessage(body);
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
    <PageShell title="Messages" meta={state === "ready" && unread > 0 ? `${unread} unread` : "Inbox"} width="max-w-none">
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
          <EmptyState message="No conversations yet. When messaging is connected, threads for your home and requests will show up here." />
          <p className="text-center text-xs text-muted-foreground">
            Private by membership. Request threads are limited to authorized participants.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Phone conversation / not-found is a separate screen. */}
          <div className={cn(showMobileConversation ? "block md:hidden" : "hidden")}>
            {mobileConversationHero}
            <div className="mt-4">{conversationCard}</div>
          </div>

          <div className={cn(showMobileConversation ? "hidden md:block" : "block")}>
            {hero}
            <div className="mt-6 flex flex-col gap-6 lg:flex-row lg:items-stretch">
              <div className="w-full lg:w-[360px] lg:shrink-0">{inboxCard}</div>
              {/* Tablet stacks conversation under inbox; desktop sits beside. */}
              <div
                className={cn(
                  "min-w-0 flex-1",
                  // Always show pane on md+; on phone only when inbox layout (rare).
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
