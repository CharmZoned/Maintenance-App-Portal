import { cn } from "@/lib/utils";
import type { KpiTile } from "./admin-dashboard-model";
import { navProps } from "./dashboard-primitives";

// 24px side padding at the designed tile widths (173px and up); 16px when the
// tile is narrower, so labels keep to one line on small phones and at `xl`.
const TILE =
  "flex h-full min-h-[164px] min-w-0 flex-col gap-1 rounded-lg border border-border bg-card px-4 py-5 @[172px]:px-6";

/**
 * Portfolio KPIs (Figma "Portfolio KPIs" · LH / KPI tile): label, value and a
 * detail line. Two across on phone, three from `md`, six from `xl`. A tile
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
            <span className="lg-body-medium break-words text-muted-foreground">{tile.label}</span>
            <span className="lg-display break-words text-foreground">{tile.value}</span>
            <span className="lg-caption break-words text-muted-foreground">{tile.detail}</span>
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
