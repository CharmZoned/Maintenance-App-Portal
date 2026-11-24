import { useState } from "react";
import { Wrench } from "lucide-react";
import { useApp } from "@/context";
import { PageShell } from "@/components/page-shell";
import { EmptyState, ErrorRetry, SkeletonRow } from "@/components/patterns";
import { MessageThreadRow } from "./message-thread-row";
import { MessageBubble } from "./message-bubble";
import { MessageComposer } from "./message-composer";
import { ConversationUnavailable } from "./conversation-unavailable";
import { TenantMessagesPage } from "./tenant-messages-page";
import { AdminMessagesPage } from "./admin-messages-page";
import { usePortalInbox } from "./use-portal-inbox";
import { commentSenderLabel, formatMessageTime, officeMessageSenderLabel } from "@/lib/messages";
import type { CommentVisibility } from "@/types";

/**
 * Messages route entry.
 * Tenants: office thread + request comment threads (tenant-visible).
 * Admins: the office inbox (every direct thread and request).
 * Technicians: office thread + comment threads on their jobs.
 * Landlords: office thread only (no request threads; request links open the request page).
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
  const { isTenant, isAdmin, isLandlord } = useApp();

  if (isTenant) {
    return <TenantMessagesPage search={search} navigate={navigate} replace={replace} />;
  }

  // The office inbox: direct threads + request threads with real read state.
  if (isAdmin) {
    return <AdminMessagesPage search={search} navigate={navigate} replace={replace} />;
  }

  return (
    <PortalMessagesPage
      role={isLandlord ? "landlord" : "maintenance"}
      search={search}
      navigate={navigate}
      replace={replace}
    />
  );
}

/**
 * Figma 05 Messages — landlord / technician list + thread.
 * Request threads → MaintenanceRequestComments; direct → OfficeMessages.
 *
 * Landlords get their office conversation only: request messaging with the
 * landlord is out of scope (SOW), so no request (tenant) threads are listed
 * for them and `?thread=wo:<id>` / `?request=<id>` links go straight to that
 * request's page, which carries its status updates.
 */
function PortalMessagesPage({
  role,
  search,
  navigate,
  replace,
}: {
  role: "landlord" | "maintenance";
  search: string;
  navigate: (to: string) => void;
  replace?: (to: string) => void;
}) {
  const inbox = usePortalInbox({ role, search, navigate, replace });
  const { state, threads, unreadCount, selected, selectedRequestId, unavailable } = inbox;
  const [commentVisibility, setCommentVisibility] = useState<CommentVisibility>("internal");
  const isTechnician = role === "maintenance";
  const isDirect = selected?.kind === "direct";

  const meta =
    state === "loading" ? "Loading…" : state === "error" ? "Couldn’t load" : unreadCount > 0 ? `${unreadCount} unread` : "Inbox";

  const showPane = Boolean(inbox.mobileThread && (selected || unavailable));

  const threadPane = unavailable ? (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center">
      <ConversationUnavailable onBack={inbox.closeThread} />
    </div>
  ) : selected ? (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-[100px] shrink-0 items-center gap-2 border-b border-border px-4 md:px-5">
        <button type="button" className="min-h-11 text-sm font-medium text-foreground md:hidden" onClick={inbox.closeThread}>
          ← Back
        </button>
        {!isDirect ? <Wrench className="size-4 shrink-0 text-muted-foreground" aria-hidden /> : null}
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold">{selected.title}</h2>
        {selectedRequestId != null ? (
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
        {inbox.threadLoading ? (
          <>
            <SkeletonRow />
            <SkeletonRow />
          </>
        ) : inbox.threadError ? (
          <ErrorRetry message={inbox.threadError} onRetry={inbox.retryThread} />
        ) : isDirect ? (
          inbox.officeMessages.length === 0 ? (
            <EmptyState message="No messages yet. Write to the office any time." />
          ) : (
            inbox.officeMessages.map((m) => {
              const { label, outgoing } = officeMessageSenderLabel(m, {
                currentUserId: inbox.viewer.userId,
                currentRole: role,
              });
              return (
                <div key={m.id} className={outgoing ? "flex justify-end" : "flex justify-start"}>
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
        ) : inbox.comments.length === 0 ? (
          <EmptyState message="No messages on this job yet. Send the first update." />
        ) : (
          inbox.comments.map((c) => {
            const { label, outgoing } = commentSenderLabel(c, { currentRole: role });
            return (
              <div key={c.id} className={outgoing ? "flex justify-end" : "flex justify-start"}>
                <MessageBubble
                  sender={label}
                  body={c.body}
                  time={formatMessageTime(c.created_at)}
                  side={outgoing ? "outgoing" : "incoming"}
                  visibility={c.visibility}
                  showVisibilityLabel
                />
              </div>
            );
          })
        )}
      </div>
      <MessageComposer
        resetKey={selected.id}
        initialValue={inbox.draft}
        placeholder={isDirect ? "Message the office…" : "Write a message…"}
        showVisibility={isTechnician && !isDirect}
        visibility={commentVisibility}
        onVisibilityChange={setCommentVisibility}
        onSend={isDirect ? (body) => inbox.sendOnOffice(body) : inbox.sendOnRequest}
      />
    </div>
  ) : (
    <div className="hidden flex-1 items-center justify-center md:flex">
      <EmptyState message="Select a conversation to read and reply." />
    </div>
  );

  return (
    <PageShell title="Messages" meta={meta} width="max-w-none">
      {state === "loading" ? (
        <div className="-mx-[var(--page-gutter,1.5rem)] -mt-2 border-y border-border">
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </div>
      ) : state === "error" ? (
        <ErrorRetry message={inbox.error ?? undefined} onRetry={inbox.reload} />
      ) : (
        <div className="-mx-[var(--page-gutter,1.5rem)] -mb-6 -mt-2 flex min-h-[calc(100vh-var(--page-content-top,8rem))] border-t border-border md:min-h-[calc(100vh-var(--page-content-top,7rem))]">
          <div
            className={
              showPane
                ? "hidden w-full md:block md:w-[420px] md:shrink-0 md:border-r md:border-border"
                : "w-full md:w-[420px] md:shrink-0 md:border-r md:border-border"
            }
          >
            {threads.map((t) => (
              <MessageThreadRow key={t.id} thread={t} selected={t.id === selected?.id} onSelect={() => inbox.openThread(t)} />
            ))}
          </div>
          <div className={showPane ? "flex min-w-0 flex-1 flex-col" : "hidden min-w-0 flex-1 flex-col md:flex"}>
            {threadPane}
          </div>
        </div>
      )}
    </PageShell>
  );
}
