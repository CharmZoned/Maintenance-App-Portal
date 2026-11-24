import * as React from "react";
import {
  Building2,
  Calendar,
  CircleCheck,
  Clock,
  DollarSign,
  FileText,
  Globe,
  House,
  Key,
  LogIn,
  MessageSquare,
  Plus,
  Settings,
  TriangleAlert,
  User,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AdminIconName } from "./admin-dashboard-model";

/**
 * Shared building blocks for the admin Dashboard cards (Figma "001 - Admin
 * Pages"). Keep card chrome, buttons and icons here so the sections stay
 * consistent with each other.
 */

const ICONS: Record<AdminIconName, LucideIcon> = {
  home: House,
  dollar: DollarSign,
  wrench: Wrench,
  user: User,
  calendar: Calendar,
  building: Building2,
  file: FileText,
  check: CircleCheck,
  message: MessageSquare,
  clock: Clock,
  key: Key,
  login: LogIn,
  globe: Globe,
  settings: Settings,
  plus: Plus,
};

/**
 * Props for an in-app link: a real `href` (so it can be opened in a new tab
 * and reads as a link) that the router handles on a plain click.
 *
 *   <a {...navProps("/rent", onNavigate)}>Open rent</a>
 *   <AdminButton asChild><a {...navProps(href, onNavigate)}>Open rent</a></AdminButton>
 */
export function navProps(href: string, onNavigate: (href: string) => void) {
  return {
    href,
    onClick: (event: React.MouseEvent<HTMLAnchorElement>) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      event.preventDefault();
      onNavigate(href);
    },
  };
}

/**
 * Lucide icon by admin name. The design draws every icon with a 2px stroke at
 * its output size (20px, or 16px inside small icon boxes), so the stroke is
 * absolute rather than scaled down from Lucide's 24px grid — pass `size`
 * instead of a `size-*` class.
 */
export function AdminIcon({
  name,
  size = 20,
  className,
}: {
  name: AdminIconName;
  /** Rendered size in px. */
  size?: number;
  className?: string;
}) {
  const Icon = ICONS[name];
  return (
    <Icon
      aria-hidden
      size={size}
      strokeWidth={2}
      absoluteStrokeWidth
      className={cn("shrink-0", className)}
    />
  );
}

/**
 * 44px admin button. `default` is the one solid action, `secondary` the quiet
 * raised button used inside cards, `outline` the 2px-ring button (Quick add).
 */
export const AdminButton = React.forwardRef<
  HTMLButtonElement,
  Omit<ButtonProps, "variant" | "size"> & {
    variant?: "default" | "secondary" | "outline";
  }
>(({ variant = "secondary", className, ...props }, ref) => (
  <Button
    ref={ref}
    size="touch"
    variant={variant === "outline" ? "secondary" : variant}
    className={cn(
      "text-sm font-medium",
      variant !== "default" && "text-secondary-foreground",
      variant === "outline" && "border-2 border-ring",
      className,
    )}
    {...props}
  />
));
AdminButton.displayName = "AdminButton";

/**
 * A region that scrolls inside a card. It bleeds 8px into the card padding
 * (and pads it back) so row hover fills and focus rings that reach past the
 * text are not clipped by the scroll box.
 */
export const SCROLL_REGION = "overflow-y-auto overscroll-contain -mx-2 px-2 -my-1 py-1";

/**
 * White card with a 1px border and 12px radius. `title` renders the section
 * heading (18/26) with an optional 12/18 muted summary line under it, and
 * `actions` sits on the right of the heading.
 *
 * `fill`: from `xl` the card takes its grid cell's full height and its body
 * scrolls inside it, so the dashboard fits one screen however long the lists
 * are. `footer` stays pinned under the body. Below `xl` the card is as tall as
 * its content. Pass `scrollBody={false}` when part of the body must stay put
 * and the card scrolls a region of its own (use SCROLL_REGION for it).
 *
 * The card is a container-query root (`@container`): lay out by the card's
 * own width, because the same card sits in columns of very different widths.
 */
export function DashboardCard({
  title,
  summary,
  actions,
  footer,
  fill = false,
  scrollBody = true,
  bodyClassName,
  className,
  children,
  ...rest
}: {
  title: string;
  summary?: React.ReactNode;
  actions?: React.ReactNode;
  footer?: React.ReactNode;
  fill?: boolean;
  scrollBody?: boolean;
  bodyClassName?: string;
  className?: string;
  children: React.ReactNode;
} & Omit<React.HTMLAttributes<HTMLElement>, "title">) {
  const headingId = React.useId();
  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        "@container flex min-w-0 flex-col gap-4 rounded-md border border-border bg-card p-4",
        fill && "xl:h-full xl:min-h-0",
        className,
      )}
      {...rest}
    >
      <div className="flex min-w-0 items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 id={headingId} className="lg-section text-foreground">
            {title}
          </h2>
          {summary ? <p className="lg-caption text-muted-foreground">{summary}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
      </div>
      <div
        className={cn(
          "flex min-w-0 flex-col gap-4",
          fill && "xl:min-h-0 xl:flex-1",
          fill &&
            scrollBody &&
            "xl:overflow-y-auto xl:overscroll-contain xl:-mx-2 xl:px-2 xl:-my-1 xl:py-1",
          bodyClassName,
        )}
      >
        {children}
      </div>
      {footer}
    </section>
  );
}

const NOTICE_TONES = {
  success: { box: "bg-success-tint", text: "text-success", Icon: CircleCheck },
  error: { box: "bg-destructive-tint", text: "text-destructive", Icon: TriangleAlert },
  neutral: { box: "bg-muted", text: "text-foreground", Icon: CircleCheck },
} as const;

/**
 * AD / Notice — tinted strip with an icon and one medium-weight sentence.
 * Success and all-clear use `success`; errors use `error` (announced
 * assertively); `neutral` is for filtered-empty hints.
 */
export function DashboardNotice({
  tone = "success",
  icon,
  children,
  action,
  className,
}: {
  tone?: keyof typeof NOTICE_TONES;
  /** Replace the default tone icon. */
  icon?: React.ReactNode;
  children: React.ReactNode;
  /** Optional trailing control (e.g. a Clear filters button). */
  action?: React.ReactNode;
  className?: string;
}) {
  const t = NOTICE_TONES[tone];
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex min-h-16 items-start gap-3 rounded-sm p-4",
        t.box,
        t.text,
        className,
      )}
    >
      {icon ?? (
        <t.Icon aria-hidden size={20} strokeWidth={2} absoluteStrokeWidth className="mt-px shrink-0" />
      )}
      <div className="lg-body-medium min-w-0 flex-1">{children}</div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
