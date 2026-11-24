import type { MouseEvent, ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Clickable list row (Figma Patterns / List row): optional leading slot
 * (thumbnail), title, one context line, optional extra lines, status slot and
 * a trailing chevron. The whole row is ONE link or button.
 *
 * Pass `href` to render a real link (middle-click / open-in-new-tab work);
 * `onClick` then handles plain left clicks in-app. Without `href`, an
 * `onClick` row is a button; with neither it is static.
 */
export function ListRow({
  title,
  context,
  meta,
  status,
  priority,
  leading,
  chevron,
  href,
  onClick,
  ariaLabel,
  className,
}: {
  title: ReactNode;
  context?: ReactNode;
  /** Extra lines under the context line (phone stacks status, priority, date here). */
  meta?: ReactNode;
  status?: ReactNode;
  priority?: ReactNode;
  /** Left slot, e.g. a photo thumbnail. */
  leading?: ReactNode;
  /** Trailing chevron; defaults to on for interactive rows. */
  chevron?: boolean;
  href?: string;
  onClick?: () => void;
  ariaLabel?: string;
  className?: string;
}) {
  const interactive = Boolean(onClick || href);
  const showChevron = chevron ?? interactive;
  const rowClass = cn(
    "flex w-full items-center gap-3 border-b border-border bg-card px-4 py-3 text-left transition-colors last:border-b-0",
    interactive &&
      "cursor-pointer hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/40",
    className,
  );

  const body = (
    <>
      {leading ? <div className="shrink-0">{leading}</div> : null}
      <div className="flex min-w-0 flex-1 items-start gap-2">
        {priority ? <div className="shrink-0 pt-0.5">{priority}</div> : null}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold leading-[22px] text-foreground">{title}</div>
          {context ? (
            <div className="truncate text-sm leading-5 text-muted-foreground">{context}</div>
          ) : null}
          {meta ? <div className="mt-1 flex flex-col items-start gap-1">{meta}</div> : null}
        </div>
      </div>
      {status ? <div className="shrink-0">{status}</div> : null}
      {showChevron ? (
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      ) : null}
    </>
  );

  if (href) {
    return (
      <a
        href={href}
        aria-label={ariaLabel}
        className={rowClass}
        onClick={(e: MouseEvent<HTMLAnchorElement>) => {
          if (!onClick) return;
          if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
            return;
          }
          e.preventDefault();
          onClick();
        }}
      >
        {body}
      </a>
    );
  }
  if (onClick) {
    return (
      <button type="button" aria-label={ariaLabel} onClick={onClick} className={rowClass}>
        {body}
      </button>
    );
  }
  return <div className={rowClass}>{body}</div>;
}
