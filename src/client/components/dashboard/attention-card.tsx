import * as React from "react";
import { cn } from "@/lib/utils";
import type { AttentionItem, AttentionModel } from "./admin-dashboard-model";
import {
  AdminButton,
  AdminIcon,
  DashboardCard,
  DashboardNotice,
  navProps,
} from "./dashboard-primitives";

/**
 * "Needs your attention" card (Figma AH — Dashboard · Main column).
 *
 * A ranked list of the things only the office can resolve; each entry is an
 * "Attention action": the row opens the record, the button beside it starts
 * the one action that resolves it. With no items the card shows the
 * "All clear" state instead.
 *
 * The button sits beside the row at every width (compact, so it fits a phone
 * column too). From `xl` the card fills its grid cell and the list scrolls
 * inside it.
 */
export function AttentionCard({
  attention,
  onNavigate,
  className,
  fill,
}: {
  attention: AttentionModel;
  onNavigate: (href: string) => void;
  className?: string;
  /** Fill the grid cell from `xl` and scroll the list inside (see DashboardCard). */
  fill?: boolean;
}) {
  if (attention.items.length === 0) {
    // Figma "All clear" frame: heading only (no summary line), the notice,
    // what was checked (worded by the data layer, so it only claims what the
    // portal knows) and the "Resolved today" caption.
    return (
      <DashboardCard title="Needs your attention" className={className} fill={fill}>
        <DashboardNotice tone="success">All clear · Nothing needs your attention.</DashboardNotice>
        {attention.clearedLine ? (
          <p className="lg-body text-foreground">{attention.clearedLine}</p>
        ) : null}
        {attention.resolvedLine ? (
          <p className="lg-caption text-muted-foreground">{attention.resolvedLine}</p>
        ) : null}
      </DashboardCard>
    );
  }

  return (
    <DashboardCard
      title="Needs your attention"
      summary={attention.summaryLine}
      className={className}
      fill={fill}
    >
      <ol className="flex flex-col divide-y divide-border">
        {attention.items.map((item) => (
          <AttentionAction key={item.id} item={item} onNavigate={onNavigate} />
        ))}
      </ol>
    </DashboardCard>
  );
}

/** Figma "Priority N" → "Attention action": LH / Attention item row + its action button. */
function AttentionAction({
  item,
  onNavigate,
}: {
  item: AttentionItem;
  onNavigate: (href: string) => void;
}) {
  const titleId = React.useId();
  const contextId = React.useId();

  return (
    <li className="flex min-w-0 items-center gap-2 py-1">
      <a
        {...navProps(item.href, onNavigate)}
        aria-labelledby={titleId}
        aria-describedby={contextId}
        className={cn(
          "flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-sm px-2 py-2",
          "transition-colors duration-150 hover:bg-muted active:bg-muted",
        )}
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-warning-tint text-foreground">
          {/* 2px stroke at 16px, as drawn (Lucide's 2 is relative to its 24px grid). */}
          <AdminIcon name={item.icon} size={16} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span id={titleId} className="lg-body-medium break-words text-foreground">
            {item.title}
          </span>
          <span id={contextId} className="lg-caption break-words text-muted-foreground">
            {item.context}
          </span>
        </span>
      </a>
      <AdminButton asChild className="h-9 shrink-0 px-3">
        <a
          {...navProps(item.actionHref ?? item.href, onNavigate)}
          aria-label={`${item.actionLabel} — ${item.title}`}
        >
          {item.actionLabel}
        </a>
      </AdminButton>
    </li>
  );
}
