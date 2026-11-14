import { useCallback, useEffect, useMemo, useState } from "react";
import { Wrench } from "lucide-react";
import { useApp } from "@/context";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorRetry, SkeletonRow } from "@/components/patterns";
import { MessageThreadRow } from "./message-thread-row";
import { MessageBubble } from "./message-bubble";
import { MessageComposer } from "./message-composer";
import {
  commentSenderLabel,
  formatMessageTime,
  threadsFromWorkOrders,
  type MessageThread,
} from "@/lib/messages";
import type { MaintenanceComment, WorkOrder } from "@/types";

type LoadState = "loading" | "ready" | "error";

/**
 * Figma 05 Messages — N4 list + thread (mobile stack / admin split).
 * Request threads use MaintenanceRequestComments; direct DMs are stubbed.
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
  const app = useApp();
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setLocalError] = useState<string | null>(null);
  const [openedIds, setOpenedIds] = useState<Set<string>>(() => new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [comments, setComments] = useState<MaintenanceComment[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [mobileThread, setMobileThread] = useState(false);

  const load = useCallback(async () => {
    setState("loading");
    setLocalError(null);
    try {
      const list = await app.listWorkOrders();
      setWorkOrders(list);
      setState("ready");
    } catch (err) {
      setLocalError((err as Error).message);
      setState("error");
      app.setError((err as Error).message);
    }
  }, [app]);

  useEffect(() => {
    void load();
  }, [load]);

  const threads = useMemo(
    () => threadsFromWorkOrders(workOrders, { openedIds }),
    [workOrders, openedIds],
  );

  const unreadCount = threads.filter((t) => t.unread).length;

  // Deep-link ?thread=wo:123
  useEffect(() => {
    const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
    const thread = params.get("thread");
    if (thread && threads.some((t) => t.id === thread)) {
      setSelectedId(thread);
      setMobileThread(true);
    }
  }, [search, threads]);

  const selected: MessageThread | undefined = threads.find((t) => t.id === selectedId);

  useEffect(() => {
    if (!selected || selected.kind !== "request" || selected.requestId == null) {
      setComments([]);
      return;
    }
    let cancelled = false;
    setThreadLoading(true);
    void app
      .listMaintenanceComments(selected.requestId)
      .then((rows) => {
        if (!cancelled) setComments(rows);
      })
      .catch((err) => {
        if (!cancelled) app.setError((err as Error).message);
      })
      .finally(() => {
        if (!cancelled) setThreadLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected, app]);

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

  async function sendComment(body: string) {
    if (!selected?.requestId || app.isLandlord) return;
    const created = await app.addMaintenanceComment(selected.requestId, body);
    setComments((prev) => [...prev, created]);
    setWorkOrders((prev) =>
      prev.map((wo) =>
        wo.id === selected.requestId
          ? { ...wo, description: body, created_at: wo.created_at }
          : wo,
      ),
    );
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
        {selected.requestId != null ? (
          <button
            type="button"
            className="shrink-0 text-[13px] font-medium text-brand-text hover:underline"
            onClick={() => navigate(`/maintenance?wo=${selected.requestId}`)}
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
            const { label, outgoing } = commentSenderLabel(c, {
              currentRole: app.isAdmin
                ? "admin"
                : app.isTenant
                  ? "tenant"
                  : app.isLandlord
                    ? "landlord"
                    : "maintenance",
            });
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
        )}
      </div>
      <MessageComposer
        disabled={app.isLandlord || selected.kind !== "request"}
        placeholder={
          app.isLandlord
            ? "Landlord portal is read-only"
            : selected.kind !== "request"
              ? "Direct messages unavailable (stub)"
              : "Write a message…"
        }
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
        !app.isTenant && !app.isLandlord ? (
          <Button
            variant="brand"
            size="header"
            type="button"
            onClick={() =>
              app.setError(
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
        <div className="-mx-6 -mt-2 border-y border-border">
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
        <div className="-mx-6 -mb-6 -mt-2 flex min-h-[calc(100vh-8rem)] border-t border-border md:min-h-[calc(100vh-7rem)]">
          {/* List — hidden on mobile when a thread is open */}
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
          {/* Thread — always on md+; full-bleed on mobile when open */}
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
