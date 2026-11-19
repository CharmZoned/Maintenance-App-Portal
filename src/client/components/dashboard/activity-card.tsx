import * as React from "react";
import type { ActivityGroup, ActivityItem, ActivityModel } from "./admin-dashboard-model";
import { AdminIcon, DashboardCard, navProps } from "./dashboard-primitives";

/**
 * "Recent activity" card (Figma AH — Dashboard · Main column).
 *
 * What happened across the portfolio, newest first, grouped by day: an
 * uppercase day label, then "LH / Activity item" rows (round icon, sentence,
 * context line). A row with an `href` is a link to the record it is about.
 */
export function ActivityCard({
  activity,
  onNavigate,
  className,
}: {
  activity: ActivityModel;
  onNavigate: (href: string) => void;
  className?: string;
}) {
  return (
    <DashboardCard title="Recent activity" summary={activity.summaryLine} className={className}>
      {activity.groups.length === 0 ? (
        <p className="lg-caption text-muted-foreground">No recent activity yet.</p>
      ) : (
        activity.groups.map((group) => (
          <ActivityDay key={group.id} group={group} onNavigate={onNavigate} />
        ))
      )}
    </DashboardCard>
  );
}

/** One day of activity: the day label as a heading over its list of items. */
function ActivityDay({
  group,
  onNavigate,
}: {
  group: ActivityGroup;
  onNavigate: (href: string) => void;
}) {
  const headingId = React.useId();
  return (
    <section className="flex min-w-0 flex-col gap-4">
      <h3 id={headingId} className="lg-label uppercase text-muted-foreground">
        {group.label}
      </h3>
      <ul aria-labelledby={headingId} className="flex flex-col gap-4">
        {group.items.map((item) => (
          <li key={item.id} className="min-w-0">
            <ActivityRow item={item} onNavigate={onNavigate} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Figma "LH / Activity item": 32px round icon box, 14/22 sentence, 12/18 context. */
function ActivityRow({
  item,
  onNavigate,
}: {
  item: ActivityItem;
  onNavigate: (href: string) => void;
}) {
  const titleId = React.useId();
  const contextId = React.useId();

  const content = (
    <>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-foreground">
        {/* 2px stroke at 16px, as drawn (Lucide's 2 is relative to its 24px grid). */}
        <AdminIcon name={item.icon} className="size-4 [stroke-width:3]" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span id={titleId} className="lg-body break-words text-foreground">
          {item.title}
        </span>
        <span id={contextId} className="lg-caption break-words text-muted-foreground">
          {item.context}
        </span>
      </span>
    </>
  );

  if (!item.href) {
    return <div className="flex items-start gap-3 py-2">{content}</div>;
  }

  // The hover wash is wider than the row (-mx-2/px-2) so the text keeps the
  // card's 16px inset at rest.
  return (
    <a
      {...navProps(item.href, onNavigate)}
      aria-labelledby={titleId}
      aria-describedby={contextId}
      className="-mx-2 flex items-start gap-3 rounded-sm px-2 py-2 transition-colors duration-150 hover:bg-muted active:bg-muted"
    >
      {content}
    </a>
  );
}
