import { useCallback, useEffect, useRef, useState } from "react";
import { EmptyState, ErrorRetry, SkeletonRow } from "@/components/patterns";
import { MessageBubble } from "./message-bubble";
import { MessageComposer } from "./message-composer";
import { formatMessageTime, officeSenderLabel } from "@/lib/messages";
import {
  OFFICE_MESSAGE_MAX_LENGTH,
  listOfficeMessages,
  markOfficeThreadRead,
  sendOfficeMessage,
  type OfficeMessage,
  type OfficeViewer,
} from "@/lib/office-messages";

/** How often an open conversation (and the inbox) looks for new messages. */
export const OFFICE_REFRESH_MS = 15_000;

/**
 * Run `refresh` every `intervalMs` while the tab is visible, and straight away
 * when the tab becomes visible or the window regains focus. The app has no
 * realtime subscriptions; this is the light refetch that stands in for one.
 */
export function useVisibleRefresh(refresh: () => void, intervalMs = OFFICE_REFRESH_MS, enabled = true) {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    if (!enabled) return;
    const run = () => {
      if (document.visibilityState === "visible") refreshRef.current();
    };
    const timer = window.setInterval(run, intervalMs);
    document.addEventListener("visibilitychange", run);
    window.addEventListener("focus", run);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", run);
      window.removeEventListener("focus", run);
    };
  }, [intervalMs, enabled]);
}

type LoadState = "loading" | "ready" | "error";

/**
 * One office thread: the conversation and its composer.
 *
 * Opening it marks the thread read for the viewer, and so does every new
 * message that arrives while it is open. Mount with `key={threadUserId}` so a
 * thread switch starts clean.
 */
export function OfficeConversation({
  threadUserId,
  viewer,
  personLabel,
  onRead,
  onLatestMessage,
}: {
  /** Whose thread with the office this is. */
  threadUserId: string;
  viewer: OfficeViewer;
  /** Admin view: how the person on the other side is named ("Sam Fixit · Team"). */
  personLabel?: string | null;
  /** The viewer's read row now covers every message in the thread. */
  onRead?: (threadUserId: string) => void;
  /** The newest message in the thread changed (loaded, received or sent). */
  onLatestMessage?: (message: OfficeMessage) => void;
}) {
  const viewerIsAdmin = viewer.role === "admin";
  const [messages, setMessages] = useState<OfficeMessage[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  /** `created_at` of the newest message already saved as read. */
  const readThroughRef = useRef<string | null>(null);
  const aliveRef = useRef(true);
  const onReadRef = useRef(onRead);
  onReadRef.current = onRead;
  const onLatestRef = useRef(onLatestMessage);
  onLatestRef.current = onLatestMessage;

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  /** Everything on screen has been seen: move the viewer's read row up to the newest message. */
  const markRead = useCallback(
    async (rows: OfficeMessage[]) => {
      const latest = rows[rows.length - 1];
      if (!latest || readThroughRef.current === latest.created_at) return;
      // Only while someone is actually looking at the page.
      if (document.visibilityState !== "visible") return;
      const previous = readThroughRef.current;
      readThroughRef.current = latest.created_at;
      try {
        await markOfficeThreadRead(threadUserId, latest.created_at);
        if (aliveRef.current) onReadRef.current?.(threadUserId);
      } catch {
        // Not saved: leave it unread and try again on the next refresh.
        if (readThroughRef.current === latest.created_at) readThroughRef.current = previous;
      }
    },
    [threadUserId],
  );

  const load = useCallback(
    async (mode: "initial" | "background") => {
      if (mode === "initial") {
        setState("loading");
        setError(null);
      }
      try {
        const rows = await listOfficeMessages(threadUserId);
        if (!aliveRef.current) return;
        setMessages((prev) => {
          // A message sent while this request was in flight may be missing from it.
          const known = new Set(rows.map((m) => m.id));
          const newest = rows[rows.length - 1];
          const pending = prev.filter(
            (m) => !known.has(m.id) && (!newest || m.created_at >= newest.created_at),
          );
          return pending.length ? [...rows, ...pending] : rows;
        });
        setState("ready");
        const latest = rows[rows.length - 1];
        if (latest) onLatestRef.current?.(latest);
        void markRead(rows);
      } catch (err) {
        if (!aliveRef.current) return;
        // A failed background refresh keeps what is on screen; the next one retries.
        if (mode === "initial") {
          setError((err as Error).message);
          setState("error");
        }
      }
    },
    [threadUserId, markRead],
  );

  useEffect(() => {
    void load("initial");
  }, [load]);

  useVisibleRefresh(() => {
    if (state === "ready") void load("background");
  });

  // Keep the newest message in view.
  const lastId = messages[messages.length - 1]?.id ?? null;
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lastId, state]);

  async function send(body: string) {
    const created = await sendOfficeMessage(threadUserId, body, viewer);
    if (!aliveRef.current) return;
    setMessages((prev) => (prev.some((m) => m.id === created.id) ? prev : [...prev, created]));
    onLatestRef.current?.(created);
  }

  return (
    <>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto p-4 md:p-5">
        {state === "loading" ? (
          <>
            <SkeletonRow />
            <SkeletonRow />
            <p className="sr-only" role="status">
              Loading conversation…
            </p>
          </>
        ) : state === "error" ? (
          <ErrorRetry
            message={error ?? "We couldn’t load this conversation. Check your connection and try again."}
            onRetry={() => void load("initial")}
          />
        ) : messages.length === 0 ? (
          <EmptyState
            message={
              viewerIsAdmin
                ? "No messages yet. Write the first one."
                : "No messages yet. Write to the office — everyone in the office can read and answer."
            }
          />
        ) : (
          <ol className="space-y-3" aria-label="Messages">
            {messages.map((m) => {
              const { label, outgoing } = officeSenderLabel(m, {
                viewerUserId: viewer.userId,
                viewerIsAdmin,
                threadPersonLabel: personLabel,
              });
              return (
                <li key={m.id} className={outgoing ? "flex justify-end" : "flex justify-start"}>
                  <MessageBubble
                    sender={label}
                    body={m.body}
                    time={formatMessageTime(m.created_at)}
                    side={outgoing ? "outgoing" : "incoming"}
                  />
                </li>
              );
            })}
          </ol>
        )}
      </div>
      <MessageComposer
        resetKey={threadUserId}
        disabled={state !== "ready"}
        placeholder={viewerIsAdmin ? "Write a reply…" : "Message the office…"}
        maxLength={OFFICE_MESSAGE_MAX_LENGTH}
        showSendError
        onSend={send}
      />
    </>
  );
}
