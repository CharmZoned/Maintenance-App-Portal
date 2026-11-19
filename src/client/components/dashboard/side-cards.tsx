import * as React from "react";
import { cn } from "@/lib/utils";
import type {
  ListingsModel,
  MaintenanceSnapshotModel,
  MessagesModel,
  PortfolioModel,
  RentModel,
  RequestSummary,
  ThreadSummary,
} from "./admin-dashboard-model";
import { AdminButton, AdminIcon, DashboardCard, navProps } from "./dashboard-primitives";

/**
 * Right-column cards of the admin Dashboard (Figma "001 - Admin Pages" ·
 * AH — Dashboard · Side column): Rent this month, Maintenance snapshot,
 * Messages, Website listings and Your portfolio.
 *
 * The column is 384px on desktop and ~350px on tablet and phone, so every
 * card is a single fluid stack: text wraps, nothing has a fixed width.
 */

type Nav = { onNavigate: (href: string) => void; className?: string };

/** Row/block link inside a card: bleeds 8px into the card padding so the hover fill has room. */
const ROW_LINK =
  "-mx-2 rounded-sm px-2 py-3 transition-colors duration-150 hover:bg-muted active:bg-muted motion-reduce:transition-none";

/** Full-width secondary link-button that closes a card ("Open rent", "View queue", …). */
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
    <AdminButton asChild className="w-full">
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

/** Figma "Rent this month" card: collected headline, progress, breakdown, "Open rent". */
export function RentCard({ rent, onNavigate, className }: { rent: RentModel } & Nav) {
  return (
    <DashboardCard
      title="Rent this month"
      summary={rent.scopeLine || undefined}
      className={className}
    >
      <p className="lg-heading break-words text-foreground">{rent.headline}</p>
      {rent.progress ? <RentProgress progress={rent.progress} /> : null}
      {rent.lines.length > 0 ? (
        <ul className="lg-body break-words text-foreground">
          {rent.lines.map((line, index) => (
            <li key={`${index}-${line}`}>{line}</li>
          ))}
        </ul>
      ) : null}
      <TextLines lines={rent.noteLines ?? []} className="lg-caption text-muted-foreground" />
      <CardFooterLink href={rent.href} onNavigate={onNavigate}>
        Open rent
      </CardFooterLink>
    </DashboardCard>
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

/** Figma "Maintenance snapshot" card: status counts, spend, open request summaries, "View queue". */
export function MaintenanceSnapshotCard({
  maintenance,
  onNavigate,
  className,
}: { maintenance: MaintenanceSnapshotModel } & Nav) {
  return (
    <DashboardCard
      title="Maintenance snapshot"
      summary={maintenance.summaryLine || undefined}
      className={className}
    >
      <TextLines lines={maintenance.countLines} className="lg-body text-foreground" />
      {maintenance.spendLine ? (
        <p className="lg-caption break-words text-muted-foreground">{maintenance.spendLine}</p>
      ) : null}
      {maintenance.requests.length > 0 ? (
        <ul className="flex flex-col gap-4">
          {maintenance.requests.map((request) => (
            <RequestSummaryLink key={request.id} request={request} onNavigate={onNavigate} />
          ))}
        </ul>
      ) : (
        <p className="lg-caption text-muted-foreground">No open requests.</p>
      )}
      <CardFooterLink href={maintenance.href} onNavigate={onNavigate}>
        View queue
      </CardFooterLink>
    </DashboardCard>
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
        className={cn(ROW_LINK, "flex min-h-[6.875rem] flex-col gap-2 break-words")}
      >
        <span id={headingId} className="lg-body-medium text-foreground">
          {request.heading}
        </span>
        <span id={detailId} className="flex flex-col gap-2">
          <span className="lg-caption text-muted-foreground">{request.context}</span>
          <span className="lg-body text-warning">{request.statusLine}</span>
          <span className="lg-caption text-muted-foreground">{request.meta}</span>
        </span>
      </a>
    </li>
  );
}

/** Figma "Messages" card: latest conversations as thread rows, "Open messages". */
export function MessagesCard({ messages, onNavigate, className }: { messages: MessagesModel } & Nav) {
  // Keep the time column aligned when only some rows carry the unread dot.
  const anyUnread = messages.threads.some((thread) => thread.unread);

  return (
    <DashboardCard
      title="Messages"
      summary={messages.summaryLine || undefined}
      className={className}
    >
      {messages.threads.length > 0 ? (
        <ul className="flex flex-col gap-4">
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
      <CardFooterLink href={messages.href} onNavigate={onNavigate}>
        Open messages
      </CardFooterLink>
    </DashboardCard>
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

/** Figma "Website listings" card: live/draft counts, inquiries, what is not marketed, "Manage listings". */
export function ListingsCard({ listings, onNavigate, className }: { listings: ListingsModel } & Nav) {
  return (
    <DashboardCard
      title="Website listings"
      summary={listings.summaryLine || undefined}
      className={className}
    >
      <p className="lg-section break-words text-foreground">{listings.headline}</p>
      {listings.inquiryLine ? (
        // A line break in the text is kept (the all-clear frame has two sentences on two lines).
        <p className="lg-body whitespace-pre-line break-words text-foreground">
          {listings.inquiryHref ? (
            // 44px target without moving the 22px line: the hit area extends into the card gaps.
            <a
              {...navProps(listings.inquiryHref, onNavigate)}
              className="relative inline-block rounded-sm underline-offset-4 after:absolute after:inset-x-0 after:-inset-y-[0.6875rem] after:content-[''] hover:underline"
            >
              {listings.inquiryLine}
            </a>
          ) : (
            listings.inquiryLine
          )}
        </p>
      ) : null}
      <TextLines lines={listings.noteLines} className="lg-caption text-muted-foreground" />
      <CardFooterLink href={listings.href} onNavigate={onNavigate}>
        Manage listings
      </CardFooterLink>
    </DashboardCard>
  );
}

/** Figma "Portfolio context" card ("Your portfolio"): each landlord with their properties, then totals. */
export function PortfolioCard({
  portfolio,
  className,
}: {
  portfolio: PortfolioModel;
  className?: string;
}) {
  return (
    <DashboardCard title="Your portfolio" className={className}>
      {portfolio.groups.length > 0 ? (
        // One blank 22px line between landlords, as in the Figma text block.
        <ul className="lg-body flex flex-col gap-[1.375rem] break-words text-foreground">
          {portfolio.groups.map((group) => (
            <li key={group.id}>
              <p>{group.owner}</p>
              {group.lines.length > 0 ? (
                <ul>
                  {group.lines.map((line, index) => (
                    <li key={`${index}-${line}`}>{line}</li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {portfolio.totalsLine ? (
        <p className="lg-caption break-words text-muted-foreground">{portfolio.totalsLine}</p>
      ) : null}
    </DashboardCard>
  );
}
