import { Building2, MapPin, Pencil, UserRound } from "lucide-react";
import { cn, colorClasses } from "@/lib/utils";
import { AdminButton, navProps } from "@/components/dashboard/dashboard-primitives";
import { PROPERTY_TYPE_LABELS, type Property } from "@/types";

/**
 * Admin property card (Properties page). The whole card opens the property:
 * the name is the link, stretched over the card, so it reads as one link to
 * assistive tech and still opens in a new tab on middle/⌘-click. Edit is a
 * real 44px secondary button that sits above the stretched link.
 *
 * The card is a container-query root: in a wide grid cell (few properties
 * stretched across the page) identity and figures sit side by side instead of
 * stacking.
 */
export function PropertyCard({
  property: p,
  owner,
  onNavigate,
  onEdit,
}: {
  property: Property;
  /** Owner (landlord) name shown on the card. */
  owner: string;
  onNavigate: (href: string) => void;
  /** Absent when the viewer can't edit properties. */
  onEdit?: () => void;
}) {
  const palette = colorClasses(p.color);
  const units = p.unit_count ?? 0;
  const occupied = p.occupied_count ?? 0;
  // No units yet: there's no occupancy to speak of, so a dash rather than 0%.
  const occupancy = units ? `${Math.round((occupied / units) * 100)}%` : "—";
  const address = [p.address, p.city, p.state].filter(Boolean).join(", ");
  const href = `/properties/${p.id}`;

  return (
    <li className="@container min-w-0">
      <article
        className={cn(
          "group relative flex h-full min-w-0 flex-col gap-4 rounded-md border border-border bg-card p-4",
          "transition-colors duration-150 hover:border-ring",
          "has-[[data-card-link]:focus-visible]:border-ring has-[[data-card-link]:focus-visible]:ring-[3px] has-[[data-card-link]:focus-visible]:ring-ring/40",
          "@[40rem]:flex-row @[40rem]:items-center @[40rem]:gap-6",
        )}
      >
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-sm",
              palette.bg,
              palette.text,
            )}
          >
            <Building2 aria-hidden size={20} strokeWidth={2} absoluteStrokeWidth />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-start gap-2">
              <h3 className="lg-section line-clamp-2 min-w-0 flex-1 break-words text-foreground @[40rem]:flex-none">
                <a
                  {...navProps(href, onNavigate)}
                  data-card-link
                  title={p.name}
                  className="outline-none after:absolute after:inset-0 after:rounded-md after:content-[''] group-hover:underline group-hover:decoration-border group-hover:underline-offset-4"
                >
                  {p.name}
                </a>
              </h3>
              <span className="chip mt-0.5">{PROPERTY_TYPE_LABELS[p.type] ?? p.type}</span>
            </div>
            {address ? (
              <p className="lg-body mt-1 flex min-w-0 items-center gap-1.5 text-muted-foreground">
                <MapPin aria-hidden size={14} strokeWidth={2} absoluteStrokeWidth className="shrink-0" />
                <span className="truncate" title={address}>
                  {address}
                </span>
              </p>
            ) : null}
            <p className="lg-body mt-0.5 flex min-w-0 items-center gap-1.5 text-muted-foreground">
              <UserRound aria-hidden size={14} strokeWidth={2} absoluteStrokeWidth className="shrink-0" />
              <span className="sr-only">Owner: </span>
              <span className="truncate text-foreground" title={owner}>
                {owner}
              </span>
            </p>
            {p.year_built ? (
              <p className="lg-caption mt-1 text-muted-foreground">Built {p.year_built}</p>
            ) : null}
          </div>
        </div>

        <div className="mt-auto flex min-w-0 flex-wrap items-center gap-x-4 gap-y-3 border-t border-border pt-4 @[40rem]:mt-0 @[40rem]:shrink-0 @[40rem]:flex-nowrap @[40rem]:border-l @[40rem]:border-t-0 @[40rem]:pl-6 @[40rem]:pt-0">
          <dl className="grid min-w-60 flex-1 grid-cols-3 gap-2 @[40rem]:w-64 @[40rem]:flex-none">
            <Figure label="Units" value={units} />
            <Figure label="Occupied" value={`${occupied}/${units}`} />
            <Figure label="Occupancy" value={occupancy} />
          </dl>
          {onEdit ? (
            <AdminButton
              type="button"
              onClick={onEdit}
              aria-label={`Edit ${p.name}`}
              className="relative z-10 ml-auto"
            >
              <Pencil aria-hidden />
              Edit
            </AdminButton>
          ) : null}
        </div>
      </article>
    </li>
  );
}

function Figure({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-w-0">
      <dt className="stat-label">{label}</dt>
      <dd className="mt-1 text-base font-semibold tabular-nums text-foreground">{value}</dd>
    </div>
  );
}
