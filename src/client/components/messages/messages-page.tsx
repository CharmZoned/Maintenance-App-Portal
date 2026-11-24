import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Wrench } from "lucide-react";
import { useApp } from "@/context";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorRetry, SkeletonRow } from "@/components/patterns";
import { cn } from "@/lib/utils";
import { MessageThreadRow } from "./message-thread-row";
import { MessageBubble } from "./message-bubble";
import { MessageComposer } from "./message-composer";
import { OfficeThread, type OfficeRequestOption } from "./office-thread";
import { OfficeContactPicker } from "./office-contact-picker";
import { TenantMessagesPage } from "./tenant-messages-page";
import {
  commentSenderLabel,
  formatMessageTime,
  officeThreadPreview,
  threadsFromWorkOrders,
  workOrderThreadTitle,
  type MessageThread,
} from "@/lib/messages";
import {
  currentUserId,
  listOfficeContacts,
  listOfficeThreads,
  officeThreadKey,
  parseOfficeThreadKey,
  subscribeOfficeInbox,
  useOfficeThreadPreview,
  type OfficeContact,
  type OfficeThreadSummary,
} from "@/lib/office-messages";
import type { CommentVisibility, MaintenanceComment, WorkOrder } from "@/types";

type LoadState = "loading" | "ready" | "error";

/** Admin inbox filter. */
type AdminFilter = "all" | "landlords" | "workers" | "requests";

export const OFFICE_THREAD_TITLE = "Landlord Gopher office";

/**
 * Messages route entry.
 * Tenants: fully mocked Figma inbox/conversation (no messages tables).
 * Staff/landlord: office conversations (OfficeMessages) + request threads.
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

  return <StaffMessagesPage search={search} navigate={navigate} replace={replace} />;
}

function queryParam(search: string, name: string): string | null {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  return params.get(name);
}

const threadParam = (search: string) => queryParam(search, "thread");

/** `?about=<request id>` pre-picks "About a request" in the landlord's office composer. */
function aboutParam(search: string): number | null {
  const raw = queryParam(search, "about");
  const id = raw && /^\d+$/.test(raw) ? Number(raw) : NaN;
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function contactRoleLabel(role: OfficeContact["role"] | undefined): string {
  return role === "landlord" ? "Landlord" : role === "maintenance" ? "Worker" : role === "tenant" ? "Tenant" : "Portal user";
}

function SectionHeading({ children, count }: { children: ReactNode; count?: number }) {
  return (
    <div className="flex items-center justify-between border-b border-border bg-muted/40 px-4 py-2">
      <h3 className="text-xs font-medium text-muted-foreground">{children}</h3>
      {count ? (
        <span className="rounded-full bg-brand px-1.5 text-[11px] font-medium text-on-brand">{count}</span>
      ) : null}
    </div>
  );
}

/**
 * Figma N4 Messages — staff / landlord / worker.
 *  - Landlord & worker: the "Landlord Gopher office" conversation pinned on
 *    top; request comment threads below under "Request activity".
 *  - Admin: office threads grouped into Landlords / Workers (unread dots from
 *    OfficeThreadReads), request threads under "Request activity", and
 *    "New message" to start a conversation with any landlord or worker.
 * Deep links: `?thread=office` (own thread), `?thread=office:<user_id>`
 * (admin: one person's thread), `?thread=wo:<id>` (a request thread).
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
  const { listWorkOrders, listMaintenanceComments, addMaintenanceComment, setError, isAdmin, isTenant, isLandlord } =
    app;
  const hasOwnOfficeThread = !isAdmin; // landlords and workers

  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setLocalError] = useState<string | null>(null);
  const [openedIds, setOpenedIds] = useState<Set<string>>(() => new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileThread, setMobileThread] = useState(false);
  const [me, setMe] = useState<string | null>(null);

  // Admin-only office inbox.
  const [officeThreads, setOfficeThreads] = useState<OfficeThreadSummary[]>([]);
  const [contacts, setContacts] = useState<OfficeContact[]>([]);
  const [contactsState, setContactsState] = useState<LoadState>("loading");
  const [contactsError, setContactsError] = useState<string | null>(null);
  const [filter, setFilter] = useState<AdminFilter>("all");
  const [pickerOpen, setPickerOpen] = useState(false);

  // Landlord / worker: own thread preview (last message + unread), live.
  const ownPreview = useOfficeThreadPreview();

  useEffect(() => {
    void currentUserId().then(setMe);
  }, []);

  const load = useCallback(async () => {
    setState("loading");
    setLocalError(null);
    try {
      const [list, threads] = await Promise.all([
        listWorkOrders(),
        isAdmin ? listOfficeThreads() : Promise.resolve([] as OfficeThreadSummary[]),
      ]);
      setWorkOrders(list);
      setOfficeThreads(threads);
      setState("ready");
    } catch (err) {
      setLocalError((err as Error).message);
      setState("error");
      setError((err as Error).message);
    }
  }, [listWorkOrders, isAdmin, setError]);

  const loadContacts = useCallback(async () => {
    if (!isAdmin) return;
    setContactsState("loading");
    setContactsError(null);
    try {
      setContacts(await listOfficeContacts());
      setContactsState("ready");
    } catch (err) {
      setContactsError((err as Error).message);
      setContactsState("error");
    }
  }, [isAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadContacts();
  }, [loadContacts]);

  // Admin: keep the inbox (latest message + unread dots) live.
  useEffect(() => {
    if (!isAdmin) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribeOfficeInbox(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void listOfficeThreads()
          .then(setOfficeThreads)
          .catch(() => {});
      }, 300);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [isAdmin]);

  const requestThreads = useMemo(() => threadsFromWorkOrders(workOrders, { openedIds }), [workOrders, openedIds]);

  const contactById = useMemo(() => new Map(contacts.map((c) => [c.userId, c])), [contacts]);

  const adminOfficeRows = useMemo(() => {
    if (!isAdmin) return [] as Array<MessageThread & { role: OfficeContact["role"] | undefined }>;
    return officeThreads
      .map((t) => {
        const contact = contactById.get(t.thread_user_id);
        const name = contact?.name ?? "Portal user";
        return {
          id: officeThreadKey(t.thread_user_id),
          kind: "office" as const,
          title: name,
          preview: officeThreadPreview(
            { body: t.last_message_body, author_role: t.last_author_role },
            { viewerIsAdmin: true, otherName: name.split(" ")[0] || name },
          ),
          updatedAt: t.last_message_at,
          // A reply from the office means nothing is waiting on the office.
          unread: t.unread && t.last_author_role !== "admin",
          threadUserId: t.thread_user_id,
          role: contact?.role,
        };
      })
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  }, [isAdmin, officeThreads, contactById]);

  const landlordRows = adminOfficeRows.filter((r) => r.role === "landlord");
  const workerRows = adminOfficeRows.filter((r) => r.role === "maintenance");
  // Threads whose person is not (or no longer) an approved landlord or worker.
  const otherRows = adminOfficeRows.filter((r) => r.role !== "landlord" && r.role !== "maintenance");

  const ownOfficeRow: MessageThread | null = hasOwnOfficeThread
    ? {
        id: officeThreadKey(),
        kind: "office",
        title: OFFICE_THREAD_TITLE,
        preview: officeThreadPreview(ownPreview.lastMessage, { viewerIsAdmin: false, otherName: "Landlord Gopher" }),
        updatedAt: ownPreview.lastMessage?.created_at ?? "",
        unread: ownPreview.unread > 0,
        threadUserId: me ?? undefined,
      }
    : null;

  const officeUnread = isAdmin ? adminOfficeRows.filter((r) => r.unread).length : ownPreview.unread > 0 ? 1 : 0;
  const unreadCount = officeUnread + requestThreads.filter((t) => t.unread).length;

  // ── Selection and deep links ────────────────────────────────────────
  // ?thread=office · ?thread=office:<user_id> · ?thread=wo:<id>
  useEffect(() => {
    const thread = threadParam(search);
    if (!thread) {
      setSelectedId(null);
      setMobileThread(false);
      return;
    }
    const office = parseOfficeThreadKey(thread);
    if (office) {
      if (office.own && hasOwnOfficeThread) {
        setSelectedId(officeThreadKey());
        setMobileThread(true);
      } else if (!office.own && isAdmin) {
        setSelectedId(officeThreadKey(office.userId));
        setMobileThread(true);
      } else if (!office.own && hasOwnOfficeThread && me && office.userId === me) {
        setSelectedId(officeThreadKey());
        setMobileThread(true);
      }
      return;
    }
    if (requestThreads.some((t) => t.id === thread)) {
      setSelectedId(thread);
      setOpenedIds((prev) => (prev.has(thread) ? prev : new Set(prev).add(thread)));
      setMobileThread(true);
    }
  }, [search, requestThreads, hasOwnOfficeThread, isAdmin, me]);

  const selectedOffice = selectedId ? parseOfficeThreadKey(selectedId) : null;
  const selectedOfficeUserId = selectedOffice ? (selectedOffice.own ? me : selectedOffice.userId) : null;
  const selectedRequest = selectedOffice ? undefined : requestThreads.find((t) => t.id === selectedId);

  function openThread(thread: MessageThread) {
    setSelectedId(thread.id);
    if (thread.kind === "request") setOpenedIds((prev) => new Set(prev).add(thread.id));
    setMobileThread(true);
    replace?.(`/messages?thread=${encodeURIComponent(thread.id)}`);
  }

  function closeMobileThread() {
    setMobileThread(false);
    replace?.("/messages");
  }

  // ── Office thread helpers ───────────────────────────────────────────
  const workOrderById = useMemo(() => new Map(workOrders.map((wo) => [wo.id, wo])), [workOrders]);
  const requestLabel = useCallback(
    (id: number) => {
      const wo = workOrderById.get(id);
      return wo ? workOrderThreadTitle(wo) : null;
    },
    [workOrderById],
  );
  const requestOptions: OfficeRequestOption[] = useMemo(
    () =>
      isLandlord
        ? [...workOrders]
            .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
            .map((wo) => ({ id: wo.id, label: workOrderThreadTitle(wo) }))
        : [],
    [isLandlord, workOrders],
  );

  const markAdminThreadRead = useCallback((threadUserId: string) => {
    setOfficeThreads((prev) => prev.map((t) => (t.thread_user_id === threadUserId ? { ...t, unread: false } : t)));
  }, []);

  const onAdminSent = useCallback(
    (threadUserId: string, body: string, at: string) => {
      setOfficeThreads((prev) => {
        const rest = prev.filter((t) => t.thread_user_id !== threadUserId);
        return [
          {
            thread_user_id: threadUserId,
            last_message_at: at,
            last_message_body: body,
            last_author_role: "admin",
            last_author_user_id: me,
            unread: false,
          },
          ...rest,
        ];
      });
    },
    [me],
  );

  const meta =
    state === "loading"
      ? "Loading…"
      : state === "error"
        ? "Couldn’t load"
        : unreadCount > 0
          ? `${unreadCount} unread`
          : "Inbox";

  // ── Thread pane ─────────────────────────────────────────────────────
  let threadPane: ReactNode;
  if (selectedOffice && selectedOfficeUserId) {
    if (isAdmin) {
      const contact = contactById.get(selectedOfficeUserId);
      const name = contact?.name ?? (contactsState === "loading" ? "Loading…" : "Portal user");
      threadPane = (
        <OfficeThread
          key={selectedOfficeUserId}
          threadUserId={selectedOfficeUserId}
          viewerIsAdmin
          title={name}
          subtitle={[contactRoleLabel(contact?.role), contact?.detail].filter(Boolean).join(" · ")}
          personName={name}
          requestLabel={requestLabel}
          onOpenRequest={(id) => navigate(`/maintenance/${id}`)}
          onBack={closeMobileThread}
          onRead={() => markAdminThreadRead(selectedOfficeUserId)}
          onSent={(m) => onAdminSent(selectedOfficeUserId, m.body, m.created_at)}
          emptyMessage={`No messages with ${name === "Loading…" ? "this person" : name} yet. Write the first one below.`}
        />
      );
    } else {
      threadPane = (
        <OfficeThread
          key={selectedOfficeUserId}
          threadUserId={selectedOfficeUserId}
          viewerIsAdmin={false}
          title={OFFICE_THREAD_TITLE}
          subtitle="Message the office about your properties or requests. The team replies here."
          requestOptions={requestOptions}
          initialRequestId={aboutParam(search)}
          requestLabel={requestLabel}
          onOpenRequest={(id) => navigate(`/maintenance/${id}`)}
          onBack={closeMobileThread}
        />
      );
    }
  } else if (selectedOffice) {
    threadPane = (
      <div className="flex flex-1 flex-col gap-3 p-5">
        <SkeletonRow />
        <SkeletonRow />
      </div>
    );
  } else if (selectedRequest) {
    threadPane = (
      <RequestThreadPane
        key={selectedRequest.id}
        thread={selectedRequest}
        isAdmin={isAdmin}
        isTenant={isTenant}
        isLandlord={isLandlord}
        listMaintenanceComments={listMaintenanceComments}
        addMaintenanceComment={addMaintenanceComment}
        setError={setError}
        onBack={closeMobileThread}
        onOpenRequest={(id) => navigate(`/maintenance/${id}`)}
        onAskOffice={
          hasOwnOfficeThread
            ? () =>
                replace?.(
                  `/messages?thread=${officeThreadKey()}${
                    selectedRequest.requestId != null ? `&about=${selectedRequest.requestId}` : ""
                  }`,
                )
            : undefined
        }
      />
    );
  } else {
    threadPane = (
      <div className="hidden flex-1 items-center justify-center md:flex">
        <EmptyState message="Select a conversation to read and reply." />
      </div>
    );
  }

  // ── List pane ───────────────────────────────────────────────────────
  const renderRows = (rows: MessageThread[]) =>
    rows.map((t) => (
      <MessageThreadRow key={t.id} thread={t} selected={t.id === selectedId} onSelect={() => openThread(t)} />
    ));

  const showLandlords = filter === "all" || filter === "landlords";
  const showWorkers = filter === "all" || filter === "workers";
  const showRequests = filter === "all" || filter === "requests";

  const listPane = isAdmin ? (
    <>
      <div className="flex flex-wrap gap-1 border-b border-border px-4 py-3" role="group" aria-label="Show">
        {(
          [
            ["all", "All", unreadCount],
            ["landlords", "Landlords", landlordRows.filter((r) => r.unread).length],
            ["workers", "Workers", workerRows.filter((r) => r.unread).length],
            ["requests", "Requests", 0],
          ] as Array<[AdminFilter, string, number]>
        ).map(([value, label, count]) => (
          <button
            key={value}
            type="button"
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-sm px-3 text-sm font-medium transition-colors",
              filter === value
                ? "bg-card text-foreground shadow-raised"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {label}
            {count > 0 ? (
              <span className="rounded-full bg-brand px-1.5 text-[11px] font-medium text-on-brand">{count}</span>
            ) : null}
          </button>
        ))}
      </div>
      {showLandlords ? (
        <section aria-label="Landlords">
          <SectionHeading count={landlordRows.filter((r) => r.unread).length}>Landlords</SectionHeading>
          {landlordRows.length ? (
            renderRows(landlordRows)
          ) : (
            <p className="border-b border-border px-4 py-4 text-[13px] text-muted-foreground">
              No landlord conversations yet. Use New message to write to a landlord.
            </p>
          )}
        </section>
      ) : null}
      {showWorkers ? (
        <section aria-label="Workers">
          <SectionHeading count={workerRows.filter((r) => r.unread).length}>Workers</SectionHeading>
          {workerRows.length ? (
            renderRows(workerRows)
          ) : (
            <p className="border-b border-border px-4 py-4 text-[13px] text-muted-foreground">
              No worker conversations yet. Use New message to write to a worker.
            </p>
          )}
        </section>
      ) : null}
      {filter === "all" && otherRows.length ? (
        <section aria-label="Other conversations">
          <SectionHeading count={otherRows.filter((r) => r.unread).length}>Other</SectionHeading>
          {renderRows(otherRows)}
        </section>
      ) : null}
      {showRequests ? (
        <section aria-label="Request activity">
          <SectionHeading>Request activity</SectionHeading>
          {requestThreads.length ? (
            renderRows(requestThreads)
          ) : (
            <p className="px-4 py-4 text-[13px] text-muted-foreground">
              Comments on maintenance requests will show up here.
            </p>
          )}
        </section>
      ) : null}
    </>
  ) : (
    <>
      {ownOfficeRow ? (
        <MessageThreadRow
          thread={ownOfficeRow}
          pinned
          selected={selectedOffice != null}
          onSelect={() => openThread(ownOfficeRow)}
        />
      ) : null}
      <section aria-label="Request activity">
        <SectionHeading>Request activity</SectionHeading>
        {requestThreads.length ? (
          renderRows(requestThreads)
        ) : (
          <p className="px-4 py-4 text-[13px] text-muted-foreground">
            Updates on your maintenance requests will show up here.
          </p>
        )}
      </section>
    </>
  );

  const hasSelection = selectedId != null && (selectedOffice != null || selectedRequest != null);

  return (
    <PageShell
      title="Messages"
      meta={meta}
      width="max-w-none"
      actions={
        isAdmin ? (
          <Button variant="brand" size="header" type="button" onClick={() => setPickerOpen(true)}>
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
      ) : (
        <div className="-mx-6 -mb-6 -mt-2 flex min-h-[calc(100vh-8rem)] border-t border-border md:min-h-[calc(100vh-7rem)]">
          <div
            className={
              mobileThread && hasSelection
                ? "hidden w-full md:block md:w-[420px] md:shrink-0 md:border-r md:border-border"
                : "w-full md:w-[420px] md:shrink-0 md:border-r md:border-border"
            }
          >
            {listPane}
          </div>
          <div
            className={
              mobileThread && hasSelection
                ? "flex min-w-0 flex-1 flex-col"
                : "hidden min-w-0 flex-1 flex-col md:flex"
            }
          >
            {threadPane}
          </div>
        </div>
      )}
      {isAdmin ? (
        <OfficeContactPicker
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          contacts={contacts}
          loading={contactsState === "loading"}
          error={contactsError}
          onRetry={() => void loadContacts()}
          onPick={(contact) => {
            setPickerOpen(false);
            const key = officeThreadKey(contact.userId);
            setSelectedId(key);
            setMobileThread(true);
            replace?.(`/messages?thread=${encodeURIComponent(key)}`);
          }}
        />
      ) : null}
    </PageShell>
  );
}

/** A request's comment thread (MaintenanceRequestComments). Landlords read only. */
function RequestThreadPane({
  thread,
  isAdmin,
  isTenant,
  isLandlord,
  listMaintenanceComments,
  addMaintenanceComment,
  setError,
  onBack,
  onOpenRequest,
  onAskOffice,
}: {
  thread: MessageThread;
  isAdmin: boolean;
  isTenant: boolean;
  isLandlord: boolean;
  listMaintenanceComments: (requestId: number) => Promise<MaintenanceComment[]>;
  addMaintenanceComment: (requestId: number, body: string, visibility?: CommentVisibility) => Promise<MaintenanceComment>;
  setError: (message: string | null) => void;
  onBack: () => void;
  onOpenRequest: (id: number) => void;
  onAskOffice?: () => void;
}) {
  const requestId = thread.requestId ?? null;
  const [comments, setComments] = useState<MaintenanceComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [visibility, setVisibility] = useState<CommentVisibility>(isTenant ? "tenant_visible" : "internal");
  const requestIdRef = useRef(requestId);
  requestIdRef.current = requestId;

  useEffect(() => {
    setComments([]);
    setThreadError(null);
    if (requestId == null) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void listMaintenanceComments(requestId)
      .then((rows) => {
        if (cancelled) return;
        // Defense in depth — landlords only see tenant_visible (RLS also enforces).
        setComments(isLandlord ? rows.filter((row) => row.visibility === "tenant_visible") : rows);
      })
      .catch((err) => {
        if (cancelled) return;
        setThreadError((err as Error).message);
        setError((err as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [requestId, reloadKey, listMaintenanceComments, setError, isLandlord]);

  async function sendComment(body: string, v: CommentVisibility) {
    if (requestId == null || isLandlord) return;
    const id = requestId;
    try {
      const created = await addMaintenanceComment(id, body, v);
      if (requestIdRef.current !== id) return;
      setComments((prev) => [...prev, created]);
    } catch (err) {
      setError((err as Error).message);
      // Rethrow so MessageComposer keeps the draft.
      throw err;
    }
  }

  const currentRole = isAdmin ? "admin" : isTenant ? "tenant" : isLandlord ? "landlord" : "maintenance";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-[72px] shrink-0 items-center gap-2 border-b border-border px-4 py-3 md:px-5">
        <button type="button" className="text-sm font-medium text-foreground md:hidden" onClick={onBack}>
          ← Back
        </button>
        <Wrench className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold">{thread.title}</h2>
        {requestId != null ? (
          <button
            type="button"
            className="shrink-0 text-[13px] font-medium text-brand-text hover:underline"
            onClick={() => onOpenRequest(requestId)}
          >
            Open request
          </button>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-4 md:p-5">
        {loading ? (
          <>
            <SkeletonRow />
            <SkeletonRow />
          </>
        ) : threadError ? (
          <ErrorRetry message={threadError} onRetry={() => setReloadKey((k) => k + 1)} />
        ) : comments.length === 0 ? (
          <EmptyState
            message={
              isLandlord
                ? "No updates on this request yet."
                : "No comments on this request yet. Send the first update."
            }
          />
        ) : (
          comments.map((c) => {
            const { label, outgoing } = commentSenderLabel(c, { currentRole });
            return (
              <div key={c.id} className={outgoing ? "flex justify-end" : "flex justify-start"}>
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
      {isLandlord ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-border bg-card px-4 py-3 text-[13px] text-muted-foreground">
          <span>Questions about this request go to the office.</span>
          {onAskOffice ? (
            <button type="button" className="font-medium text-brand-text hover:underline" onClick={onAskOffice}>
              Message Landlord Gopher
            </button>
          ) : null}
        </div>
      ) : (
        <MessageComposer
          resetKey={thread.id}
          placeholder={isTenant ? "Message staff…" : "Write a message…"}
          showVisibility={!isTenant}
          visibility={visibility}
          onVisibilityChange={setVisibility}
          onSend={sendComment}
        />
      )}
    </div>
  );
}
