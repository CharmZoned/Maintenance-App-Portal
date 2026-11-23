import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * In-page introduction repeated on landlord screens (Figma documents intro
 * `2037:545`–`2037:547`, and the same stack on maintenance and properties).
 *
 * Phone order is eyebrow, title, description, action. From the `md` breakpoint
 * the action sits on the title row and the description drops below.
 * This is the page's heading, separate from the Phase 0 toolbar title.
 */
export function LandlordPageIntro({
  eyebrow,
  title,
  description,
  action,
  className,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex flex-col gap-2", className)}>
      <p className="lg-label uppercase text-muted-foreground">{eyebrow}</p>
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between md:gap-4">
        <h1 className="lg-heading text-foreground md:lg-display">{title}</h1>
        {description ? (
          <p className="order-2 lg-body text-muted-foreground md:hidden">{description}</p>
        ) : null}
        {action ? (
          <div className="order-3 md:order-none md:shrink-0 [&_button]:w-full md:[&_button]:w-auto">
            {action}
          </div>
        ) : null}
      </div>
      {description ? (
        <p className="hidden lg-body text-muted-foreground md:block">{description}</p>
      ) : null}
    </header>
  );
}
