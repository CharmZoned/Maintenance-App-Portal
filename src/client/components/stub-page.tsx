import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * "Coming soon" panel for an admin feature the portal does not have yet.
 *
 * Says it plainly, in the office's words: a real icon, a short title, one
 * sentence on what the feature will do, and — where there is one — the place
 * to go today (`children`, usually one or two buttons). Never developer copy.
 *
 * Renders inside the admin frame (paper background, `lg-admin` palette), as a
 * white card so it reads as part of the page rather than as an empty screen.
 */
export function ComingSoonPanel({
  icon: Icon,
  title,
  description,
  children,
  className,
}: {
  icon: LucideIcon;
  /** "Publishing listings is coming soon" */
  title: string;
  /** One sentence on what the feature will do once it is here. */
  description: ReactNode;
  /** The next step available today (buttons or links). */
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-label={title}
      className={cn(
        "flex min-w-0 flex-col items-start gap-4 rounded-md border border-border bg-card p-4 sm:flex-row sm:p-6",
        className,
      )}
    >
      <div className="flex size-11 shrink-0 items-center justify-center rounded-sm bg-brand-tint text-brand-text">
        <Icon aria-hidden size={20} strokeWidth={2} absoluteStrokeWidth />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="lg-section text-foreground">{title}</p>
        <p className="lg-body max-w-2xl text-muted-foreground">{description}</p>
        {children ? <div className="mt-3 flex flex-wrap items-center gap-3">{children}</div> : null}
      </div>
    </section>
  );
}
