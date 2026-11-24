import { useMemo } from "react";
import { Wrench } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorRetry, SkeletonRow } from "@/components/patterns";
import { MessageBubble } from "./message-bubble";
import { MessageComposer } from "./message-composer";
import { ConversationUnavailable } from "./conversation-unavailable";
import { usePortalInbox } from "./use-portal-inbox";
import { cn } from "@/lib/utils";
import { commentSenderLabel, formatMessageTime, officeMessageSenderLabel } from "@/lib/messages";
import { messagesLoadScenarioFromSearch } from "@/lib/tenant-messages-mock";

/**
 * Tenant Messages — Figma M/T/D inbox + conversation, backed by:
 * - OfficeMessages (one direct thread with the Landlord Gopher office)
 * - MaintenanceRequestComments on the tenant's requests (tenant-visible only)
 *
 * Read state, deep links and sending live in `usePortalInbox`, shared with the
 * landlord and technician inbox, so "unread" means the same everywhere.
 *
 * Deep links: `?thread=wo:<id>` / `?thread=office:<uuid>` / `?request=<pk>` /
 * `?office=me&about=…`. Demo: `?demo=empty|error` exercises empty/error UI.
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
  const scenario = useMemo(() => messagesLoadScenarioFromSearch(search), [search]);
  const inbox = usePortalInbox({
    role: "tenant",
    search,
    navigate,
    replace,
    scenario: scenario === "empty" || scenario === "error" ? scenario : null,
  });
  const { state, threads: conversations, unreadCount: unread, selected, selectedRequestId, unavailable } = inbox;

  const showMobileConversation = Boolean(inbox.mobileThread && (selected || unavailable));

  const hero = (
    <header className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        The right people, in one place
      </p>
      <h2 className="text-[2.125rem] font-semibold leading-[2.625rem] tracking-[-0.01em] text-foreground">
        Messages
      </h2>
      <p className="text-sm text-muted-foreground md:hidden">Your home. Your conversations.</p>
      <p className="hidden text-sm text-muted-foreground md:block">
        Conversations for your home and your maintenance requests.
      </p>
    </header>
  );

  const mobileConversationHero = (
    <header className="space-y-3">
      <button
        type="button"
        onClick={inbox.closeThread}
        className="text-sm font-medium text-brand-text hover:underline"
      >
        ← Back to inbox
      </button>
      <h2 className="text-2xl font-semibold leading-8 text-foreground">Messages</h2>
    </header>
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
          const when = time ? `. ${time}` : "";
          return (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => inbox.openThread(c)}
                className={cn(
                  "flex min-h-[7.375rem] w-full items-center gap-3 border-b border-border px-4 py-3.5 text-left transition-colors",
                  c.id === selected?.id ? "bg-brand-tint" : "bg-card hover:bg-muted/50",
                )}
                aria-current={c.id === selected?.id ? "true" : undefined}
                aria-label={c.unread ? `${c.title}, unread. ${c.preview}${when}` : `${c.title}. ${c.preview}${when}`}
              >
                <div className="flex h-full w-2 shrink-0 items-center justify-center">
                  {c.unread ? <span className="size-2 rounded-full bg-brand" aria-hidden /> : null}
                </div>
                <div className="min-w-0 flex-1" aria-hidden>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1.5">
                      {c.kind === "request" ? (
                        <Wrench className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      ) : null}
                      <span
                        className={cn(
                          "truncate text-sm text-foreground",
                          c.unread ? "font-semibold" : "font-medium",
                        )}
                      >
                        {c.title}
                      </span>
                    </div>
                    {time ? <span className="shrink-0 text-xs text-muted-foreground">{time}</span> : null}
                  </div>
                  <p
                    className={cn(
                      "mt-1 truncate text-[13px]",
                      c.empty ? "italic text-muted-foreground/80" : "text-muted-foreground",
                    )}
                  >
                    {c.preview}
                  </p>
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
  const threadBody = inbox.threadLoading ? (
    <>
      <SkeletonRow />
      <SkeletonRow />
    </>
  ) : inbox.threadError ? (
    <ErrorRetry message={inbox.threadError} onRetry={inbox.retryThread} />
  ) : isDirect ? (
    inbox.officeMessages.length === 0 ? (
      <EmptyState message="No messages yet. Say hello to the office." />
    ) : (
      inbox.officeMessages.map((m) => {
        const { label, outgoing } = officeMessageSenderLabel(m, {
          currentUserId: inbox.viewer.userId,
          currentRole: "tenant",
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
    <EmptyState message="No messages on this request yet. Send the first update." />
  ) : (
    inbox.comments.map((c) => {
      const { label, outgoing } = commentSenderLabel(c, { currentRole: "tenant" });
      return (
        <div key={c.id} className={outgoing ? "flex justify-end" : "flex justify-start"}>
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

  const conversationCard = unavailable ? (
    <section className={cn(conversationPaneClass, "items-center justify-center")}>
      <ConversationUnavailable onBack={inbox.closeThread} />
    </section>
  ) : selected ? (
    <section aria-label={`Conversation ${selected.title}`} className={conversationPaneClass}>
      <div className="shrink-0 space-y-3 border-b border-border px-5 py-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <h3 className="text-lg font-semibold leading-[1.625rem] text-foreground">{selected.title}</h3>
          {selectedRequestId != null ? (
            <Button
              type="button"
              variant="secondary"
              size="lg"
              className="min-h-11 w-full sm:w-auto sm:min-w-[10rem]"
              onClick={() => navigate(`/maintenance/${selectedRequestId}`)}
            >
              Open request
            </Button>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          {isDirect ? "You · Landlord Gopher office" : "You · the office and your technician"}
        </p>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-5">
        {threadBody}
        <p className="pt-2 text-xs text-muted-foreground">Only members of this conversation can view or reply.</p>
      </div>
      <div className="shrink-0">
        <MessageComposer
          resetKey={selected.id}
          initialValue={inbox.draft}
          placeholder={isDirect ? "Message the office…" : "Write a message…"}
          onSend={async (body, visibility) => {
            if (isDirect) await inbox.sendOnOffice(body);
            else await inbox.sendOnRequest(body, visibility);
          }}
        />
      </div>
    </section>
  ) : (
    <section className={cn(conversationPaneClass, "items-center justify-center")}>
      <EmptyState message="Select a conversation to read and reply." />
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
          <ErrorRetry message={inbox.error ?? "Couldn’t load messages."} onRetry={inbox.reload} />
        </div>
      ) : conversations.length === 0 && !unavailable ? (
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
              <div className="hidden min-w-0 flex-1 md:block">{conversationCard}</div>
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
