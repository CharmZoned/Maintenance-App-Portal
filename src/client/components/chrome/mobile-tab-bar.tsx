import { cn } from "@/lib/utils";
import type { PortalNavItem } from "@/lib/portal-nav";

/**
 * Phone bottom tab bar (Figma Tab bar item). Used under md for tenant /
 * landlord / worker shells. Admin uses the rail / drawer instead.
 */
export function MobileTabBar({
  items,
  active,
  onNavigate,
  className,
}: {
  items: PortalNavItem[];
  active: string;
  onNavigate: (href: string) => void;
  className?: string;
}) {
  return (
    <nav
      aria-label="Primary"
      className={cn(
        "flex shrink-0 items-stretch justify-around border-t border-border bg-background px-2 pb-[max(0.25rem,env(safe-area-inset-bottom))] pt-1 md:hidden",
        className,
      )}
    >
      {items.map((item) => {
        const isActive = item.id === active;
        const showCount = typeof item.count === "number" && item.count > 0;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onNavigate(item.href)}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "relative flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-[0.6875rem] font-medium",
              isActive ? "text-foreground" : "text-muted-foreground",
            )}
          >
            <span
              className={cn(
                "h-1 w-6 rounded-full",
                isActive ? "bg-brand" : "bg-transparent",
              )}
              aria-hidden
            />
            <span className="truncate">{item.label}</span>
            {showCount ? (
              <span className="absolute right-1 top-1 inline-flex min-w-[1rem] items-center justify-center rounded-full bg-brand px-1 text-[0.625rem] text-on-brand">
                {item.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}
