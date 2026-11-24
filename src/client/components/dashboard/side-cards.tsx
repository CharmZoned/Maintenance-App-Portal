import * as React from "react";
import { cn } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type {
  ActivityModel,
  MaintenanceSnapshotModel,
  MessagesModel,
  RentModel,
  RequestSummary,
  ThreadSummary,
} from "./admin-dashboard-model";
import { ActivityList } from "./activity-card";
import { AdminButton, AdminIcon, SCROLL_REGION, navProps } from "./dashboard-primitives";

/**
 * Right column of the admin Dashboard: one "Snapshot" card with a tab each for
 * Rent this month, Maintenance, Messages and Recent activity (Figma
 * "001 - Admin Pages" · AH — Dashboard · Side column, folded into tabs so the
 * page fits one screen). Website listings and the portfolio list are covered
 * by the KPI tiles and the Properties page.
 *
 * The column is ~22rem on desktop and ~350px on tablet and phone, so every
 * panel is a single fluid stack: text wraps, nothing has a fixed width.
 */

type Nav = { onNavigate: (href: string) => void };

const TABS = [
  { value: "rent", label: "Rent" },
  { value: "maintenance", label: "Maintenance" },
  { value: "messages", label: "Messages" },
  { value: "activity", label: "Activity" },
] as const;

export type SnapshotTab = (typeof TABS)[number]["value"];

export function SnapshotCard({
  rent,
  maintenance,
  messages,
  activity,
  onNavigate,
  fill,
  defaultTab = "rent",
  className,
}: {
  rent: RentModel;
  maintenance: MaintenanceSnapshotModel;
  messages: MessagesModel;
  activity: ActivityModel;
  onNavigate: (href: string) => void;
  /** Fill the grid cell from `xl`; the open panel scrolls inside. */
  fill?: boolean;
  defaultTab?: SnapshotTab;
  className?: string;
}) {
  const headingId = React.useId();
  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        "@container flex min-w-0 flex-col gap-3 rounded-md border border-border bg-card p-4",
        fill && "xl:h-full xl:min-h-0",
        className,
      )}
    >
      <h2 id={headingId} className="sr-only">
        Snapshot
      </h2>
      <Tabs defaultValue={defaultTab} className="flex min-h-0 flex-1 flex-col gap-4">
        <TabsList aria-label="Snapshot" className="flex h-auto w-full gap-0.5">
          {TABS.map((tab) => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className="min-h-9 min-w-0 flex-auto px-1.5 text-xs data-[state=active]:text-foreground"
            >
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <Panel value="rent" fill={fill} footer={<CardFooterLink href={rent.href} onNavigate={onNavigate}>Open rent</CardFooterLink>}>
          <RentPanel rent={rent} />
        </Panel>
        <Panel value="maintenance" fill={fill} footer={<CardFooterLink href={maintenance.href} onNavigate={onNavigate}>View queue</CardFooterLink>}>
          <MaintenancePanel maintenance={maintenance} onNavigate={onNavigate} />
        </Panel>
        <Panel value="messages" fill={fill} footer={<CardFooterLink href={messages.href} onNavigate={onNavigate}>Open messages</CardFooterLink>}>
          <MessagesPanel messages={messages} onNavigate={onNavigate} />
        </Panel>
        <Panel value="activity" fill={fill}>
          <ActivityList activity={activity} onNavigate={onNavigate} />
        </Panel>
      </Tabs>
    </section>
  );
}

/** One tab panel: the scrolling content, then its closing link pinned under it. */
function Panel({
  value,
  fill,
  footer,
  children,
}: {
  value: SnapshotTab;
  fill?: boolean;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <TabsContent
      value={value}
      className="mt-0 flex min-h-0 flex-col gap-4 data-[state=inactive]:hidden xl:flex-1"
    >
      <div className={cn("flex min-w-0 flex-col gap-4", fill && cn(SCROLL_REGION, "xl:min-h-0 xl:flex-1"))}>
        {children}
      </div>
      {footer}
    </TabsContent>
  );
}

/** Row/block link inside a card: bleeds 8px into the card padding so the hover fill has room. */
const ROW_LINK =
  "-mx-2 rounded-sm px-2 py-3 transition-colors duration-150 hover:bg-muted active:bg-muted motion-reduce:transition-none";

/** Full-width secondary link-button that closes a panel ("Open rent", "View queue", …). */
function CardFooterLink({
  href,
  onNavigate,
  children,
}: {
  href: string;
  onNavigate: (href: string) => void;
  children: React.ReactNode;
}) {
  return (
    <AdminButton asChild className="h-9 w-full shrink-0">
      <a {...navProps(href, onNavigate)}>{children}</a>
    </AdminButton>
  );
}

/** Consecutive lines of one text block (Figma multi-line text layers). */
function TextLines({ lines, className }: { lines: string[]; className?: string }) {
  if (lines.length === 0) return null;
  return (
    <div className={cn("break-words", className)}>
      {lines.map((line, index) => (
        <p key={`${index}-${line}`}>{line}</p>
      ))}
    </div>
  );
}

/** Figma "Rent this month": scope, collected headline, progress, breakdown. */
function RentPanel({ rent }: { rent: RentModel }) {
  return (
    <>
      <div className="flex flex-col gap-1">
        <h3 className="lg-body-medium text-foreground">Rent this month</h3>
        {rent.scopeLine ? <p className="lg-caption text-muted-foreground">{rent.scopeLine}</p> : null}
      </div>
      <p className="lg-section break-words text-foreground">{rent.headline}</p>
      {rent.progress ? <RentProgress progress={rent.progress} /> : null}
      {rent.lines.length > 0 ? (
        <ul className="lg-body break-words text-foreground">
          {rent.lines.map((line, index) => (
            <li key={`${index}-${line}`}>{line}</li>
          ))}
        </ul>
      ) : null}
      <TextLines lines={rent.noteLines ?? []} className="lg-caption text-muted-foreground" />
    </>
  );
}

/** Figma "AD / Portfolio rent progress": label, 8px track with the collected share, caption. */
function RentProgress({ progress }: { progress: NonNullable<RentModel["progress"]> }) {
  const labelId = React.useId();
  const captionId = React.useId();
  const percent = Number.isFinite(progress.percent)
    ? Math.min(100, Math.max(0, progress.percent))
    : 0;

  return (
    <div className="flex flex-col gap-2">
      <p id={labelId} className="lg-body-medium break-words text-foreground">
        {progress.label}
      </p>
      <div
        role="progressbar"
        aria-labelledby={labelId}
        aria-describedby={captionId}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
        aria-valuetext={progress.label}
        className="h-2 overflow-hidden rounded-full bg-muted forced-colors:border forced-colors:border-[CanvasText]"
      >
        <div
          className="h-full rounded-full bg-success-solid forced-colors:bg-[Highlight]"
          style={{ width: `${percent}%` }}
        />
      </div>
      <p id={captionId} className="lg-caption break-words text-muted-foreground">
        {progress.caption}
      </p>
    </div>
  );
}

/** Figma "Maintenance snapshot": status counts, spend, open request summaries. */
function MaintenancePanel({
  maintenance,
  onNavigate,
}: { maintenance: MaintenanceSnapshotModel } & Nav) {
  return (
    <>
      <div className="flex flex-col gap-1">
        <h3 className="lg-body-medium text-foreground">Maintenance snapshot</h3>
        {maintenance.summaryLine ? (
          <p className="lg-caption text-muted-foreground">{maintenance.summaryLine}</p>
        ) : null}
      </div>
      <TextLines lines={maintenance.countLines} className="lg-body text-foreground" />
      {maintenance.spendLine ? (
        <p className="lg-caption break-words text-muted-foreground">{maintenance.spendLine}</p>
      ) : null}
      {maintenance.requests.length > 0 ? (
        <ul className="flex flex-col">
          {maintenance.requests.map((request) => (
            <RequestSummaryLink key={request.id} request={request} onNavigate={onNavigate} />
          ))}
        </ul>
      ) : (
        <p className="lg-caption text-muted-foreground">No open requests.</p>
      )}
    </>
  );
}

/** Figma "AD / Request summary": the status is always followed by the next step. */
function RequestSummaryLink({
  request,
  onNavigate,
}: {
  request: RequestSummary;
  onNavigate: (href: string) => void;
}) {
  const headingId = React.useId();
  const detailId = React.useId();

  return (
    <li className="min-w-0">
      <a
        {...navProps(request.href, onNavigate)}
        aria-labelledby={headingId}
        aria-describedby={detailId}
        className={cn(ROW_LINK, "flex flex-col gap-1 break-words")}
      >
        <span id={headingId} className="lg-body-medium text-foreground">
          {request.heading}
        </span>
        <span id={detailId} className="flex flex-col gap-0.5">
          <span className="lg-caption text-muted-foreground">{request.context}</span>
          <span className="lg-body text-warning">{request.statusLine}</span>
          <span className="lg-caption text-muted-foreground">{request.meta}</span>
        </span>
      </a>
    </li>
  );
}

/** Figma "Messages": latest conversations as thread rows. */
function MessagesPanel({ messages, onNavigate }: { messages: MessagesModel } & Nav) {
  // Keep the time column aligned when only some rows carry the unread dot.
  const anyUnread = messages.threads.some((thread) => thread.unread);

  return (
    <>
      <div className="flex flex-col gap-1">
        <h3 className="lg-body-medium text-foreground">Messages</h3>
        {messages.summaryLine ? (
          <p className="lg-caption text-muted-foreground">{messages.summaryLine}</p>
        ) : null}
      </div>
      {messages.threads.length > 0 ? (
        <ul className="flex flex-col">
          {messages.threads.map((thread) => (
            <ThreadRow
              key={thread.id}
              thread={thread}
              reserveDot={anyUnread}
              onNavigate={onNavigate}
            />
          ))}
        </ul>
      ) : (
        <p className="lg-caption text-muted-foreground">No conversations yet.</p>
      )}
    </>
  );
}

/**
 * Figma "LH / Thread row": round type icon, name with the time on the right,
 * one-line preview, unread dot. Unread is also said in text and carried by the
 * heavier name, so it never depends on the dot alone.
 */
function ThreadRow({
  thread,
  reserveDot,
  onNavigate,
}: {
  thread: ThreadSummary;
  reserveDot: boolean;
  onNavigate: (href: string) => void;
}) {
  return (
    <li className="min-w-0">
      <a
        {...navProps(thread.href, onNavigate)}
        className={cn(ROW_LINK, "flex min-h-14 items-center gap-3")}
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-tint text-brand-text">
          <AdminIcon name={thread.icon} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          {/* Time sits right of the name; in a very narrow card it drops under it. */}
          <span className="flex flex-col @[18rem]:flex-row @[18rem]:items-center @[18rem]:gap-2">
            <span
              className={cn(
                "min-w-0 break-words text-foreground @[18rem]:flex-1",
                thread.unread ? "lg-body-medium" : "lg-body",
              )}
            >
              {thread.unread ? <span className="sr-only">Unread: </span> : null}
              {thread.name}
            </span>
            <span className="lg-caption shrink-0 whitespace-nowrap text-muted-foreground">
              {thread.time}
            </span>
          </span>
          <span className="lg-caption truncate text-muted-foreground">{thread.preview}</span>
        </span>
        {thread.unread || reserveDot ? (
          <span
            aria-hidden
            className={cn("size-2.5 shrink-0 rounded-full", thread.unread && "bg-primary")}
          />
        ) : null}
      </a>
    </li>
  );
}
