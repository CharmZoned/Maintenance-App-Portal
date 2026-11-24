import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Wrench } from "lucide-react";
import { useApp } from "@/context";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState, ErrorRetry, SkeletonRow } from "@/components/patterns";
import { MessageThreadRow } from "./message-thread-row";
import { MessageBubble } from "./message-bubble";
import { MessageComposer } from "./message-composer";
import { TenantMessagesPage } from "./tenant-messages-page";
import {
  commentSenderLabel,
  formatMessageTime,
  mergeMessageThreads,
  officeMessageSenderLabel,
  officeThreadId,
  officeThreadTitleFromAccount,
  parseOfficeThreadId,
  resolveStaffMessagesDeepLink,
  threadsFromOfficeSummaries,
  threadsFromWorkOrders,
  type MessageThread,
} from "@/lib/messages";
import type { OfficeMessage, UserAccountRow } from "@/lib/data";
import { supabase } from "@/lib/supabase";
import type { CommentVisibility, MaintenanceComment, WorkOrder } from "@/types";

type LoadState = "loading" | "ready" | "error";

/**
 * Messages route entry.
 * Tenants: office DMs + request comment threads.
 * Staff/worker: office DMs + request comment threads.
 * Landlord: office DM only (no request threads; request links open the request page).
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

  if (isTenant) {
    return <TenantMessagesPage search={search} navigate={navigate} replace={replace} />;
  }

  return (
    <StaffMessagesPage search={search} navigate={navigate} replace={replace} />
  );
}

/**
 * Figma 05 Messages — staff/landlord/worker list + thread.
 * Request threads → MaintenanceRequestComments; direct → OfficeMessages.
 *
 * Landlords get their office conversation only: request messaging with the
 * landlord is out of scope (SOW), so no request (tenant) threads are listed
 * for them and old `?thread=wo:<id>` / `?request=<id>` links go straight to
 * that request's page, which carries its status updates.
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
    listOfficeThreads,
    listOfficeMessages,
    sendOfficeMessage,
    markOfficeThreadRead,
    listUserAccounts,
    setError,
    setNotice,
    isAdmin,
    isTenant,
    isLandlord,
  } = app;

  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [officeSummaries, setOfficeSummaries] = useState<
    Awaited<ReturnType<typeof listOfficeThreads>>
  >([]);
  const [accountTitles, setAccountTitles] = useState<Map<string, string>>(() => new Map());
  const [accounts, setAccounts] = useState<UserAccountRow[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setLocalError] = useState<string | null>(null);
  const [openedIds, setOpenedIds] = useState<Set<string>>(() => new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [extraDirectThreads, setExtraDirectThreads] = useState<MessageThread[]>([]);
  const [comments, setComments] = useState<MaintenanceComment[]>([]);
  const [officeMessages, setOfficeMessages] = useState<OfficeMessage[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [mobileThread, setMobileThread] = useState(false);
  const [commentVisibility, setCommentVisibility] = useState<CommentVisibility>("internal");
  const [threadReloadKey, setThreadReloadKey] = useState(0);
  const [newMessageOpen, setNewMessageOpen] = useState(false);

  const load = useCallback(async () => {
    setState("loading");
    setLocalError(null);
    try {
      const [{ data: auth }, list, office] = await Promise.all([
        supabase.auth.getUser(),
        // Landlords get no request threads (SOW), so they skip the request download.
        isLandlord ? Promise.resolve([] as WorkOrder[]) : listWorkOrders(),
        listOfficeThreads(),
      ]);
      setCurrentUserId(auth.user?.id ?? null);
      setWorkOrders(list);
      setOfficeSummaries(office);

      if (isAdmin) {
        try {
          const rows = await listUserAccounts();
          setAccounts(rows.filter((a) => a.account_status === "approved" && a.role !== "admin"));
          const titles = new Map<string, string>();
          for (const row of rows) {
            titles.set(row.user_id, officeThreadTitleFromAccount(row));
          }
          setAccountTitles(titles);
        } catch {
          setAccounts([]);
          setAccountTitles(new Map());
        }
      } else {
        setAccounts([]);
        setAccountTitles(new Map());
      }
      setState("ready");
    } catch (err) {
      setLocalError((err as Error).message);
      setState("error");
      setError((err as Error).message);
    }
  }, [listWorkOrders, listOfficeThreads, listUserAccounts, setError, isAdmin, isLandlord]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setCommentVisibility(isTenant ? "tenant_visible" : "internal");
  }, [isTenant]);

  const requestThreads = useMemo(
    () => threadsFromWorkOrders(workOrders, { openedIds }),
    [workOrders, openedIds],
  );

  const directThreads = useMemo(() => {
    const fromDb = threadsFromOfficeSummaries(officeSummaries, {
      titles: accountTitles.size > 0 ? accountTitles : undefined,
      ensureOwnThread:
        !isAdmin && currentUserId
          ? { userId: currentUserId, title: "Landlord Gopher office" }
          : undefined,
    });
    const known = new Set(fromDb.map((t) => t.id));
    const extras = extraDirectThreads.filter((t) => !known.has(t.id));
    return [...fromDb, ...extras];
  }, [officeSummaries, accountTitles, isAdmin, currentUserId, extraDirectThreads]);

  const threads = useMemo(
    () => mergeMessageThreads(directThreads, requestThreads),
    [directThreads, requestThreads],
  );

  const unreadCount = threads.filter((t) => t.unread).length;

  // Deep-link ?thread=wo:… / office:… / ?request=
  useEffect(() => {
    if (state !== "ready") return;
    const link = resolveStaffMessagesDeepLink(search, threads, {
      currentUserId,
      isAdmin,
    });

    if (link.kind === "thread") {
      const officeUser = parseOfficeThreadId(link.threadId);
      const canSynthesize =
        officeUser != null &&
        (isAdmin || (currentUserId != null && officeUser === currentUserId));
      if (canSynthesize && !threads.some((t) => t.id === link.threadId)) {
        setExtraDirectThreads((prev) => {
          if (prev.some((t) => t.id === link.threadId)) return prev;
          return [
            ...prev,
            {
              id: link.threadId,
              kind: "direct",
              title: accountTitles.get(officeUser) ?? "Office conversation",
              preview: "No messages yet.",
              updatedAt: new Date().toISOString(),
              unread: false,
              threadUserId: officeUser,
            },
          ];
        });
      }
      setSelectedId(link.threadId);
      setOpenedIds((prev) => {
        if (prev.has(link.threadId)) return prev;
        return new Set(prev).add(link.threadId);
      });
      setMobileThread(true);
      return;
    }

    if (link.kind === "request") {
      if (isLandlord) {
        // No landlord request threads: the request page carries its updates.
        const to = `/maintenance/${link.requestId}`;
        if (replace) replace(to);
        else navigate(to);
        return;
      }
      setSelectedId(link.threadId);
      setOpenedIds((prev) => {
        if (prev.has(link.threadId)) return prev;
        return new Set(prev).add(link.threadId);
      });
      setMobileThread(true);
      return;
    }

    if (link.kind === "not-found") {
      setSelectedId(null);
      setMobileThread(true);
      return;
    }

    if (!new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get("thread")) {
      setSelectedId(null);
      setMobileThread(false);
    }
  }, [search, threads, state, accountTitles, currentUserId, isAdmin, isLandlord, replace, navigate]);

  const selected: MessageThread | undefined =
    threads.find((t) => t.id === selectedId) ??
    extraDirectThreads.find((t) => t.id === selectedId);

  const selectedRequestId =
    selected?.kind === "request"
      ? (selected.requestId ?? null)
      : selectedId
        ? (() => {
            const n = Number(selectedId.replace(/^wo:/, ""));
            return selectedId.startsWith("wo:") && Number.isFinite(n) ? n : null;
          })()
        : null;
  const selectedThreadUserId =
    selected?.kind === "direct"
      ? (selected.threadUserId ?? parseOfficeThreadId(selected.id))
      : selectedId
        ? parseOfficeThreadId(selectedId)
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
          } catch (err) {
            // Still show the thread; surface so unread does not look stuck forever.
            setNotice(
              `Opened the conversation, but couldn’t mark it read: ${(err as Error).message}`,
            );
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
    setNotice,
    isLandlord,
  ]);

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
      if (selectedRequestIdRef.current !== requestId) return;
      setComments((prev) => [...prev, created]);
    } catch (err) {
      setError((err as Error).message);
      throw err;
    }
  }

  async function sendDirect(body: string) {
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
      setExtraDirectThreads((prev) => prev.filter((t) => t.threadUserId !== threadUserId));
      void markOfficeThreadRead(threadUserId).catch(() => undefined);
    } catch (err) {
      setError((err as Error).message);
      throw err;
    }
  }

  function startConversationWith(account: UserAccountRow) {
    const id = officeThreadId(account.user_id);
    setExtraDirectThreads((prev) => {
      if (prev.some((t) => t.id === id) || officeSummaries.some((t) => t.thread_user_id === account.user_id)) {
        return prev;
      }
      return [
        ...prev,
        {
          id,
          kind: "direct",
          title: officeThreadTitleFromAccount(account),
          preview: "No messages yet.",
          updatedAt: new Date().toISOString(),
          unread: false,
          threadUserId: account.user_id,
        },
      ];
    });
    setNewMessageOpen(false);
    openThread({
      id,
      kind: "direct",
      title: officeThreadTitleFromAccount(account),
      preview: "No messages yet.",
      updatedAt: new Date().toISOString(),
      unread: false,
      threadUserId: account.user_id,
    });
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

  const isDirect = selected?.kind === "direct" || Boolean(selectedThreadUserId);
  const canComposeRequest = selectedRequestId != null && !isLandlord;
  const canComposeDirect = Boolean(selectedThreadUserId);
  const composerDisabled = isDirect ? !canComposeDirect : !canComposeRequest;

  const threadPane = selected || selectedRequestId != null || selectedThreadUserId ? (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-[100px] shrink-0 items-center gap-2 border-b border-border px-4 md:px-5">
        <button
          type="button"
          className="text-sm font-medium text-foreground md:hidden"
          onClick={closeMobileThread}
        >
          ← Back
        </button>
        {(selected?.kind === "request" || selectedRequestId != null) && !isDirect ? (
          <Wrench className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        ) : null}
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold">
          {selected?.title ??
            (selectedRequestId != null
              ? `Request ${selectedRequestId}`
              : "Office conversation")}
        </h2>
        {selectedRequestId != null && !isDirect ? (
          <button
            type="button"
            className="shrink-0 text-[13px] font-medium text-brand-text hover:underline"
            onClick={() => navigate(`/maintenance/${selectedRequestId}`)}
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
        ) : isDirect ? (
          officeMessages.length === 0 ? (
            <EmptyState message="No messages yet. Send the first update to the office." />
          ) : (
            officeMessages.map((m) => {
              const { label, outgoing } = officeMessageSenderLabel(m, {
                currentUserId,
                currentRole,
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
          <EmptyState message="No comments on this request yet. Send the first update." />
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
        resetKey={selected?.id ?? selectedId}
        disabled={composerDisabled}
        placeholder={
          isDirect
            ? isAdmin
              ? "Write a message…"
              : "Message the office…"
            : isLandlord
              ? "Landlord portal is read-only on request threads"
              : "Write a message…"
        }
        showVisibility={!isTenant && !isLandlord && !isDirect && selectedRequestId != null}
        visibility={commentVisibility}
        onVisibilityChange={setCommentVisibility}
        onSend={isDirect ? async (body) => sendDirect(body) : sendComment}
      />
    </div>
  ) : (
    <div className="hidden flex-1 items-center justify-center md:flex">
      <EmptyState message="Select a conversation to read and reply." />
    </div>
  );

  const deepLinkMiss =
    state === "ready" &&
    resolveStaffMessagesDeepLink(search, threads, { currentUserId, isAdmin }).kind ===
      "not-found";

  return (
    <PageShell
      title="Messages"
      meta={meta}
      width="max-w-none"
      actions={
        isAdmin ? (
          <Button
            variant="brand"
            size="header"
            type="button"
            onClick={() => setNewMessageOpen(true)}
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
      ) : threads.length === 0 && !selectedId ? (
        <EmptyState message="No conversations yet. Message the office, or comment on a maintenance request." />
      ) : deepLinkMiss && !selected ? (
        <EmptyState
          message="That conversation wasn’t found. Pick a thread from your inbox."
          actionLabel="Back to inbox"
          onAction={() => (replace ? replace("/messages") : navigate("/messages"))}
        />
      ) : (
        <div className="-mx-6 -mb-6 -mt-2 flex min-h-[calc(100vh-8rem)] border-t border-border md:min-h-[calc(100vh-7rem)]">
          <div
            className={
              mobileThread && (selected || selectedId)
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
              mobileThread && (selected || selectedId)
                ? "flex min-w-0 flex-1 flex-col"
                : "hidden min-w-0 flex-1 flex-col md:flex"
            }
          >
            {threadPane}
          </div>
        </div>
      )}

      <Dialog open={newMessageOpen} onOpenChange={setNewMessageOpen}>
        <DialogContent className="max-h-[80vh] overflow-hidden sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New message</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Start a direct conversation with a portal user. Request chats stay on the work order.
          </p>
          <ul className="max-h-[50vh] space-y-1 overflow-auto">
            {accounts.length === 0 ? (
              <li className="py-6 text-center text-sm text-muted-foreground">
                No approved tenants, landlords, or workers to message yet.
              </li>
            ) : (
              accounts.map((account) => (
                <li key={account.user_id}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-2 rounded-md px-3 py-2.5 text-left text-sm hover:bg-muted/60"
                    onClick={() => startConversationWith(account)}
                  >
                    <span className="truncate font-medium">
                      {officeThreadTitleFromAccount(account)}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {account.email}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
