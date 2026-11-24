import { MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { LandlordPortfolio } from "@/lib/landlord-portfolio";
import { cn } from "@/lib/utils";
import { PortalStatus } from "./portal-status";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "Maple Court, Birch House", or a plain note when the landlord has none yet. */
export function landlordPropertiesLine(l: Pick<LandlordPortfolio, "properties">): string {
  if (l.properties.length === 0) return "No properties yet";
  return l.properties.map((p) => p.name).join(", ");
}

/** "2 units · 1 open request" */
export function landlordCountsLine(l: Pick<LandlordPortfolio, "unit_count" | "open_requests">): string {
  return `${plural(l.unit_count, "unit", "units")} · ${plural(l.open_requests, "open request", "open requests")}`;
}

/**
 * Desktop column layout shared by the header and every row (Figma U14
 * Landlords table: Name · Properties · Units · Open requests · Portal status).
 */
export const LANDLORD_GRID =
  "lg:grid lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1.6fr)_4.5rem_7rem_8rem_7.5rem] lg:items-center lg:gap-4";

/** Column headings, shown on wide screens. */
export function LandlordTableHeader() {
  return (
    <div
      className={cn(
        "hidden border-b border-border bg-card px-4 py-3 text-[13px] text-muted-foreground",
        LANDLORD_GRID,
      )}
    >
      <span>Name</span>
      <span>Properties</span>
      <span>Units</span>
      <span>Open requests</span>
      <span>Portal status</span>
      <span className="sr-only">Actions</span>
    </div>
  );
}

/**
 * People → Landlords row: name and contact, property names, unit and open
 * request counts, portal status, and a Message button into the office thread.
 * The Message button only shows once the landlord has a portal login.
 * Phone: a stacked card. Wide screens: one table row.
 */
export function LandlordRow({
  landlord,
  onEdit,
  onMessage,
  className,
}: {
  landlord: LandlordPortfolio;
  onEdit?: () => void;
  onMessage?: (userId: string) => void;
  className?: string;
}) {
  const contact = [landlord.email, landlord.phone].filter(Boolean).join(" · ") || "—";
  const propertiesLine = landlordPropertiesLine(landlord);
  const propertyCount = landlord.properties.length;
  const userId = landlord.user_id;

  const nameBlock = (
    <>
      <p className="truncate text-sm font-medium text-foreground">{landlord.name}</p>
      <p className="truncate text-xs text-muted-foreground">{contact}</p>
    </>
  );

  return (
    <div
      data-testid="landlord-row"
      className={cn(
        "flex w-full flex-col gap-2 border-b border-border bg-card px-4 py-3 last:border-b-0 lg:min-h-[64px]",
        LANDLORD_GRID,
        className,
      )}
    >
      {onEdit ? (
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Edit ${landlord.name}`}
          className="min-w-0 rounded-xs text-left outline-none hover:opacity-80 focus-visible:ring-[3px] focus-visible:ring-ring/40"
        >
          {nameBlock}
        </button>
      ) : (
        <div className="min-w-0">{nameBlock}</div>
      )}

      <p className="min-w-0 truncate text-sm text-muted-foreground" title={propertiesLine}>
        {propertyCount > 0 ? (
          <span className="text-foreground lg:mr-1.5">
            <span className="lg:hidden">{`${plural(propertyCount, "property", "properties")} · `}</span>
            <span className="hidden lg:inline">{propertyCount}</span>
          </span>
        ) : null}
        {propertiesLine}
      </p>

      {/* Phone: one counts line. Desktop: one cell per count. */}
      <p className="text-sm text-muted-foreground lg:hidden">{landlordCountsLine(landlord)}</p>
      <span className="hidden text-sm text-foreground lg:block">
        {landlord.unit_count}
        <span className="sr-only">{landlord.unit_count === 1 ? " unit" : " units"}</span>
      </span>
      <span className="hidden text-sm text-foreground lg:block">
        {landlord.open_requests}
        <span className="sr-only">{landlord.open_requests === 1 ? " open request" : " open requests"}</span>
      </span>

      <div className="flex flex-wrap items-center justify-between gap-3 lg:contents">
        <div>
          <PortalStatus status={landlord.portal_status} />
        </div>
        <div className="lg:flex lg:justify-end">
          {userId && onMessage ? (
            <Button
              variant="secondary"
              size="sm"
              type="button"
              onClick={() => onMessage(userId)}
              aria-label={`Message ${landlord.name}`}
            >
              <MessageSquare /> Message
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
