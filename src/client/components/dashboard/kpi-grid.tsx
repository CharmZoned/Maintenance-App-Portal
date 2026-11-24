import { cn } from "@/lib/utils";
import type { KpiTile } from "./admin-dashboard-model";
import { navProps } from "./dashboard-primitives";

// Compact tile (~100px tall): the dashboard has to fit one screen, and the
// value is what the eye is after. 16px sides; 20px from the designed 173px up.
const TILE =
  "flex h-full min-w-0 flex-col gap-0.5 rounded-lg border border-border bg-card px-4 py-3 @[172px]:px-5";

/**
 * Portfolio KPIs (Figma "Portfolio KPIs" · LH / KPI tile): label, value and a
 * detail line. The detail line keeps to one line on wide screens (the full
 * text is in the tooltip and stays in the accessible name). Two across on phone, three from `md`, six from `xl`. A tile
 * with an `href` is one link — the whole tile is the target.
 */
export function KpiGrid({
  tiles,
  onNavigate,
  className,
}: {
  tiles: KpiTile[];
  onNavigate: (href: string) => void;
  className?: string;
}) {
  return (
    <ul
      aria-label="Portfolio KPIs"
      className={cn("grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6", className)}
    >
      {tiles.map((tile) => {
        const body = (
          <>
            <span className="lg-caption break-words font-medium text-muted-foreground">
              {tile.label}
            </span>
            <span className="lg-heading break-words text-foreground">{tile.value}</span>
            <span
              title={tile.detail}
              className="lg-caption break-words text-muted-foreground xl:line-clamp-2"
            >
              {tile.detail}
            </span>
          </>
        );
        return (
          <li key={tile.id} className="@container min-w-0">
            {tile.href ? (
              <a
                {...navProps(tile.href, onNavigate)}
                className={cn(
                  TILE,
                  "transition-colors duration-150 hover:border-ring hover:bg-brand-tint focus-visible:border-ring",
                )}
              >
                {body}
              </a>
            ) : (
              <div className={TILE}>{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
