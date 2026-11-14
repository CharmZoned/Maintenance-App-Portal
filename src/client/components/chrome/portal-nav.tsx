import { cn } from "@/lib/utils";
import { PORTAL_BRAND, type PortalNavItem } from "@/lib/portal-nav";

/**
 * Desktop AppNav rail — 275px, brand row 56px, 28px items, brand count pills
 * (Figma 01 Chrome). Active state uses sidebar-accent, never brand hue.
 */
export function PortalNav({
  items,
  active,
  homeHref,
  onNavigate,
  className,
}: {
  items: PortalNavItem[];
  active: string;
  homeHref: string;
  onNavigate: (href: string) => void;
  className?: string;
}) {
  return (
    <aside
      className={cn(
        "lg-nav flex w-full shrink-0 flex-col border-b border-sidebar-border bg-sidebar md:h-full md:w-nav md:border-b-0 md:border-r",
        className,
      )}
    >
      <a
        href={homeHref}
        onClick={(e) => {
          e.preventDefault();
          onNavigate(homeHref);
        }}
        className="flex h-toolbar shrink-0 items-center gap-2 border-b border-sidebar-border px-4"
      >
        <span className="app-icon size-5 rounded-xs text-[0.625rem] font-semibold" aria-hidden>
          LG
        </span>
        <span className="truncate text-[0.9375rem] font-semibold text-foreground">{PORTAL_BRAND}</span>
      </a>
      <nav
        aria-label="Primary"
        className="flex gap-1 overflow-x-auto p-2 md:flex-1 md:flex-col md:overflow-y-auto"
      >
        {items.map((item) => {
          const isActive = item.id === active;
          const showCount = typeof item.count === "number" && item.count > 0;
          return (
            <a
              key={item.id}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              data-active={isActive || undefined}
              onClick={(e) => {
                e.preventDefault();
                onNavigate(item.href);
              }}
              className={cn(
                "flex h-nav-item shrink-0 items-center justify-between gap-2 rounded-sm pl-2 pr-4 text-sm font-medium text-foreground md:w-full",
                isActive ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/70",
              )}
            >
              <span className="truncate">{item.label}</span>
              {showCount ? (
                <span className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-brand px-1.5 py-px text-[0.6875rem] font-medium text-on-brand">
                  {item.count}
                </span>
              ) : null}
            </a>
          );
        })}
      </nav>
    </aside>
  );
}
