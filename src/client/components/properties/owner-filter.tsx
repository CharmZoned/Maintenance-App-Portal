import { cn } from "@/lib/utils";
import { portfolioSummary, type PropertyOwner } from "./property-owners";

/**
 * The portfolio by owner, as a filter: an "All owners" tile, then one tile per
 * landlord with their totals. Pressing a tile shows only that owner's
 * properties; pressing it again (or "All owners") shows everyone's.
 *
 * A row that scrolls sideways on phones (so the properties stay near the top),
 * a wrapping grid from `md`.
 */
export function OwnerFilter({
  owners,
  total,
  selected,
  onSelect,
}: {
  owners: PropertyOwner[];
  total: { propertyCount: number; unitCount: number; occupiedCount: number };
  /** Selected landlord id; null for all owners. */
  selected: number | null;
  onSelect: (ownerId: number | null) => void;
}) {
  return (
    <section aria-labelledby="owner-filter-heading" className="flex min-w-0 flex-col gap-3">
      <h2 id="owner-filter-heading" className="lg-label text-muted-foreground">
        Owners · {owners.length}
      </h2>
      <div
        role="group"
        aria-label="Filter properties by owner"
        className={cn(
          "-mx-4 flex snap-x scroll-px-4 gap-3 overflow-x-auto px-4 pb-1",
          "md:mx-0 md:grid md:grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] md:overflow-visible md:px-0 md:pb-0",
        )}
      >
        <OwnerTile
          pressed={selected == null}
          onClick={() => onSelect(null)}
          name="All owners"
          detail={portfolioSummary(total)}
        />
        {owners.map((owner) => (
          <OwnerTile
            key={owner.id}
            pressed={selected === owner.id}
            onClick={() => onSelect(selected === owner.id ? null : owner.id)}
            name={owner.name}
            company={owner.company}
            detail={portfolioSummary(owner)}
          />
        ))}
      </div>
    </section>
  );
}

function OwnerTile({
  pressed,
  onClick,
  name,
  company,
  detail,
}: {
  pressed: boolean;
  onClick: () => void;
  name: string;
  company?: string | null;
  detail: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "flex w-64 shrink-0 snap-start flex-col items-start gap-0.5 rounded-md border bg-card px-4 py-3 text-left md:w-auto",
        "outline-none transition-colors duration-150 focus-visible:ring-[3px] focus-visible:ring-ring/40",
        pressed
          ? "border-ring bg-brand-tint shadow-[inset_0_0_0_1px_var(--ring)]"
          : "border-border hover:border-ring",
      )}
    >
      <span className="lg-body-medium w-full truncate text-foreground">{name}</span>
      {company ? (
        <span className="lg-caption w-full truncate text-muted-foreground">{company}</span>
      ) : null}
      <span className="lg-caption w-full text-muted-foreground">{detail}</span>
    </button>
  );
}
