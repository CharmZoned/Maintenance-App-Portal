import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  AlertCircle,
  ArrowLeft,
  Building2,
  UserRound,
  Wrench,
  X,
} from "lucide-react";
import { EmptyState, ErrorRetry, SkeletonRow } from "@/components/patterns";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MessageBubble } from "./message-bubble";
import { MessageComposer } from "./message-composer";
import {
  OFFICE_MESSAGE_MAX_LENGTH,
  currentUserId,
  listOfficeMessages,
  markOfficeThreadRead,
  sendOfficeMessage,
  subscribeOfficeThread,
  type OfficeMessage,
} from "@/lib/office-messages";

/** A request the landlord can say a message is about (the composer's picker). */
export interface OfficeRequestOption {
  id: number;
  /** e.g. "MR-000123 · Leaking kitchen tap" */
  label: string;
}

type LoadState = "loading" | "ready" | "error";

const NO_REQUEST = "none";

export const SEND_FAILED_MESSAGE =
  "Message not sent. Check your connection and try again.";

function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** "Today" / "Yesterday" / "Mon 16 Nov" — the separator above each day's messages. */
export function officeDayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  if (dayKey(iso) === dayKey(now.toISOString())) return "Today";
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (dayKey(iso) === dayKey(y.toISOString())) return "Yesterday";
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function clockTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

/** "#MR-000123" from a request label, else "#<id>". */
function requestTag(id: number, label: string | null | undefined): string {
  const num = label?.match(/MR-\d+/)?.[0];
  return `#${num ?? `MR-${String(id).padStart(6, "0")}`}`;
}

/**
 * One conversation with the Landlord Gopher office: messages grouped by day,
 * "Regarding #MR-…" chips, a composer with an optional "About a request"
 * picker, and loading / empty / error / failed-send states. Shared by the
 * landlord (their own thread) and the admin (any landlord's or worker's).
 */
export function OfficeThread({
  threadUserId,
  viewerIsAdmin,
  title,
  subtitle,
  personName,
  requestOptions,
  requestLabel,
  onOpenRequest,
  onBack,
  onRead,
  onSent,
  emptyMessage,
  initialRequestId,
}: {
  /** Whose thread: the landlord or worker talking to the office. */
  threadUserId: string;
  viewerIsAdmin: boolean;
  title: string;
  subtitle?: string;
  /** Admin view: the landlord's or worker's name, shown on their bubbles. */
  personName?: string;
  /** When given (and non-empty), the composer offers "About a request". */
  requestOptions?: OfficeRequestOption[];
  /** Label for a linked request (falls back to #MR-<id>). */
  requestLabel?: (id: number) => string | null | undefined;
  onOpenRequest?: (id: number) => void;
  /** Phone: back to the conversation list. */
  onBack?: () => void;
  /** Called after the thread is marked read (so the list can clear its dot). */
  onRead?: () => void;
  onSent?: (message: OfficeMessage) => void;
  emptyMessage?: string;
  /** Pre-pick this request in "About a request" (e.g. from a request page's "Message Landlord Gopher"). */
  initialRequestId?: number | null;
}) {
  const [messages, setMessages] = useState<OfficeMessage[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [sendError, setSendError] = useState<string | null>(null);
  const initialAbout =
    initialRequestId != null &&
    (requestOptions ?? []).some((o) => o.id === initialRequestId)
      ? String(initialRequestId)
      : NO_REQUEST;
  const [aboutRequest, setAboutRequest] = useState<string>(initialAbout);
  const [me, setMe] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const onReadRef = useRef(onRead);
  onReadRef.current = onRead;

  const markRead = useCallback(() => {
    void markOfficeThreadRead(threadUserId)
      .then(() => onReadRef.current?.())
      .catch(() => {
        // Unread state is a convenience; a failed write must not break the chat.
      });
  }, [threadUserId]);

  useEffect(() => {
    void currentUserId().then(setMe);
  }, []);

  // Follow a new pre-picked request (deep link) once the options are known.
  useEffect(() => {
    if (initialAbout !== NO_REQUEST) setAboutRequest(initialAbout);
  }, [initialAbout]);

  // Load the thread, then mark it read.
  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setError(null);
    setSendError(null);
    listOfficeMessages(threadUserId)
      .then((rows) => {
        if (cancelled) return;
        setMessages(rows);
        setState("ready");
        markRead();
      })
      .catch((err) => {
        if (cancelled) return;
        setMessages([]);
        setError((err as Error).message);
        setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [threadUserId, reloadKey, markRead]);

  // Live: new messages appear without a reload; incoming ones are marked read while open.
  useEffect(() => {
    return subscribeOfficeThread(threadUserId, (message) => {
      setMessages((prev) =>
        prev.some((m) => m.id === message.id) ? prev : [...prev, message],
      );
      const fromOtherSide = viewerIsAdmin
        ? message.author_role !== "admin"
        : message.author_role === "admin";
      if (fromOtherSide) markRead();
    });
  }, [threadUserId, viewerIsAdmin, markRead]);

  // Keep the newest message (and the composer) in view, whether the list
  // scrolls on its own or the page scrolls (phone).
  useLayoutEffect(() => {
    if (state !== "ready") return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    endRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [messages.length, state]);

  async function send(body: string) {
    setSendError(null);
    const requestId =
      aboutRequest === NO_REQUEST ? undefined : Number(aboutRequest);
    try {
      const created = await sendOfficeMessage({
        threadUserId,
        body,
        requestId,
      });
      setMessages((prev) =>
        prev.some((m) => m.id === created.id) ? prev : [...prev, created],
      );
      setAboutRequest(NO_REQUEST);
      onSent?.(created);
    } catch (err) {
      setSendError(SEND_FAILED_MESSAGE);
      // Rethrow so MessageComposer keeps the draft.
      throw err;
    }
  }

  const isOutgoing = (m: OfficeMessage) =>
    viewerIsAdmin ? m.author_role === "admin" : m.author_role !== "admin";

  const senderLabel = (m: OfficeMessage) => {
    if (viewerIsAdmin) {
      if (m.author_role === "admin")
        return m.author_user_id && m.author_user_id === me
          ? "You"
          : "Landlord Gopher";
      return personName || "Them";
    }
    return m.author_role === "admin" ? "Landlord Gopher" : "You";
  };

  const options = requestOptions ?? [];
  const picker =
    options.length > 0 ? (
      <div className="flex flex-wrap items-center gap-2">
        <label
          className="text-[13px] text-muted-foreground"
          htmlFor={`office-about-${threadUserId}`}
        >
          About a request
        </label>
        <Select value={aboutRequest} onValueChange={setAboutRequest}>
          <SelectTrigger
            id={`office-about-${threadUserId}`}
            className="h-8 w-full min-w-0 sm:w-[320px]"
            aria-label="About a request (optional)"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_REQUEST}>No request</SelectItem>
            {options.map((o) => (
              <SelectItem key={o.id} value={String(o.id)}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    ) : null;

  let lastDay = "";

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="office-thread">
      <div className="flex min-h-[72px] shrink-0 items-center gap-3 border-b border-border px-4 py-3 md:px-5">
        {onBack ? (
          <button
            type="button"
            className="-ml-1 flex size-9 items-center justify-center rounded-sm text-foreground hover:bg-muted md:hidden"
            onClick={onBack}
            aria-label="Back to conversations"
          >
            <ArrowLeft className="size-4" aria-hidden />
          </button>
        ) : null}
        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-tint text-brand-text">
          {viewerIsAdmin ? (
            <UserRound className="size-4" aria-hidden />
          ) : (
            <Building2 className="size-4" aria-hidden />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold text-foreground">
            {title}
          </h2>
          {subtitle ? (
            <p className="truncate text-[13px] text-muted-foreground">
              {subtitle}
            </p>
          ) : null}
        </div>
      </div>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 space-y-3 overflow-auto p-4 md:p-5"
        aria-live="polite"
      >
        {state === "loading" ? (
          <>
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
          </>
        ) : state === "error" ? (
          <ErrorRetry
            message={
              error ? `We couldn't load this conversation. ${error}` : undefined
            }
            onRetry={() => setReloadKey((k) => k + 1)}
          />
        ) : messages.length === 0 ? (
          <EmptyState
            icon={<Building2 className="size-5" aria-hidden />}
            message={
              emptyMessage ??
              (viewerIsAdmin
                ? "No messages yet. Write the first one below."
                : "No messages yet. Ask the Landlord Gopher office anything and they'll reply here.")
            }
          />
        ) : (
          messages.map((m) => {
            const day = dayKey(m.created_at);
            const showDay = day !== lastDay;
            lastDay = day;
            const outgoing = isOutgoing(m);
            const label =
              m.request_id != null ? requestLabel?.(m.request_id) : null;
            return (
              <div key={m.id} className="space-y-3">
                {showDay ? (
                  <p className="text-center text-xs text-muted-foreground">
                    {officeDayLabel(m.created_at)}
                  </p>
                ) : null}
                <div
                  className={
                    outgoing ? "flex justify-end" : "flex justify-start"
                  }
                >
                  <MessageBubble
                    sender={senderLabel(m)}
                    body={m.body}
                    time={clockTime(m.created_at)}
                    side={outgoing ? "outgoing" : "incoming"}
                    footer={
                      m.request_id != null ? (
                        <a
                          href={`/maintenance/${m.request_id}`}
                          onClick={(e) => {
                            if (
                              !onOpenRequest ||
                              e.metaKey ||
                              e.ctrlKey ||
                              e.shiftKey
                            )
                              return;
                            e.preventDefault();
                            onOpenRequest(m.request_id!);
                          }}
                          className="inline-flex max-w-full items-center gap-1 self-start rounded-xs bg-background px-1.5 py-0.5 text-[11px] font-medium text-brand-text shadow-edge hover:underline"
                          title={label ?? undefined}
                        >
                          <Wrench className="size-3 shrink-0" aria-hidden />
                          <span className="truncate">
                            Regarding {requestTag(m.request_id, label)}
                          </span>
                        </a>
                      ) : undefined
                    }
                  />
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Phone: the page scrolls, so keep the composer pinned above the tab bar. */}
      <div className="sticky bottom-0 z-10 bg-card">
        {sendError ? (
          <div className="px-4 pb-2 pt-2 md:px-5">
            <div
              role="alert"
              className="flex items-center gap-2 rounded-md bg-destructive-tint px-3 py-2 text-[13px] text-destructive"
            >
              <AlertCircle className="size-4 shrink-0" aria-hidden />
              <p className="min-w-0 flex-1">{sendError}</p>
              <button
                type="button"
                className="flex size-6 items-center justify-center rounded-xs hover:bg-background/60"
                onClick={() => setSendError(null)}
                aria-label="Dismiss"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </div>
          </div>
        ) : null}

        <MessageComposer
          resetKey={threadUserId}
          disabled={state !== "ready"}
          placeholder={viewerIsAdmin ? "Write a reply…" : "Write a message…"}
          maxLength={OFFICE_MESSAGE_MAX_LENGTH}
          toolbar={picker}
          onSend={(body) => send(body)}
        />
      </div>
      <div ref={endRef} aria-hidden />
    </div>
  );
}
