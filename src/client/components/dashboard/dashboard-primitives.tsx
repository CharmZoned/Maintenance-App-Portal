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

/** Lucide icon by admin name — 20px with a 2px stroke unless sized by className. */
export function AdminIcon({
  name,
  className,
}: {
  name: AdminIconName;
  className?: string;
}) {
  const Icon = ICONS[name];
  return <Icon aria-hidden strokeWidth={2} className={cn("size-5 shrink-0", className)} />;
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
 * White card with a 1px border and 12px radius. `title` renders the section
 * heading (18/26) with an optional 12/18 muted summary line under it.
 * The card is a container-query root (`@container`): lay out by the card's
 * own width, because the same card sits in a 760px column on desktop and a
 * ~360px column on tablet and phone.
 */
export function DashboardCard({
  title,
  summary,
  className,
  children,
  ...rest
}: {
  title: string;
  summary?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
} & Omit<React.HTMLAttributes<HTMLElement>, "title">) {
  const headingId = React.useId();
  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        "@container flex min-w-0 flex-col gap-4 rounded-md border border-border bg-card p-4",
        className,
      )}
      {...rest}
    >
      <div className="flex flex-col gap-1">
        <h2 id={headingId} className="lg-section text-foreground">
          {title}
        </h2>
        {summary ? <p className="lg-caption text-muted-foreground">{summary}</p> : null}
      </div>
      {children}
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
      {icon ?? <t.Icon aria-hidden strokeWidth={2} className="mt-px size-5 shrink-0" />}
      <div className="lg-body-medium min-w-0 flex-1">{children}</div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
