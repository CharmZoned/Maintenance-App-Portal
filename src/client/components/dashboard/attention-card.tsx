import * as React from "react";
import { ChevronRight } from "lucide-react";
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
 * Laid out by the card's own width: the button sits beside the row in the wide
 * desktop column and drops under it in the narrow tablet/phone columns.
 */
export function AttentionCard({
  attention,
  onNavigate,
  className,
}: {
  attention: AttentionModel;
  onNavigate: (href: string) => void;
  className?: string;
}) {
  if (attention.items.length === 0) {
    // Figma "All clear" frame: heading only (no summary line), the notice,
    // one sentence of reassurance and the "Resolved today" caption.
    return (
      <DashboardCard title="Needs your attention" className={className}>
        <DashboardNotice tone="success">All clear · Nothing needs your attention.</DashboardNotice>
        <p className="lg-body text-foreground">
          Payments verified, people approved and homes marketed. The team owns every open
          request.
        </p>
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
    >
      <ol className="flex flex-col gap-4">
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
    <li className="flex min-w-0 flex-col gap-2 @lg:flex-row @lg:items-center @lg:gap-3">
      <a
        {...navProps(item.href, onNavigate)}
        aria-labelledby={titleId}
        aria-describedby={contextId}
        className={cn(
          "group flex min-h-16 min-w-0 items-center gap-3 rounded-sm px-4 py-3 @lg:flex-1",
          "transition-colors duration-150 hover:bg-muted active:bg-muted",
        )}
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-warning-tint text-foreground">
          {/* 2px stroke at 20px, as drawn (Lucide's 2 is relative to its 24px grid). */}
          <AdminIcon name={item.icon} className="[stroke-width:2.4]" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span id={titleId} className="lg-body-medium break-words text-foreground">
            {item.title}
          </span>
          <span id={contextId} className="lg-caption break-words text-muted-foreground">
            {item.context}
          </span>
        </span>
        <ChevronRight
          aria-hidden
          strokeWidth={2.4}
          className="size-5 shrink-0 text-foreground transition-transform duration-150 group-hover:translate-x-0.5 motion-reduce:transition-none"
        />
      </a>
      <AdminButton
        asChild
        className="max-w-full min-w-36 self-start px-8 @lg:min-w-34 @lg:self-center @lg:px-4"
      >
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
