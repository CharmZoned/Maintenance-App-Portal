import { useMemo, useState } from "react";
import { Building2, MapPin, Plus } from "lucide-react";
import { useApp } from "@/context";
import { cn, colorClasses } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PropertyDialog } from "./property-dialog";
import { PROPERTY_TYPE_LABELS, type Property } from "@/types";
import { PageShell } from "@/components/page-shell";
import { useShellChrome } from "@/components/chrome/shell-chrome-context";
import type { NavigateOptions } from "@/hooks/use-router";
import { OwnerFilter } from "./owner-filter";
import { PropertyCard } from "./property-card";
import {
  buildPropertyOwners,
  landlordIndex,
  ownerIdentity,
  parseOwnerParam,
  portfolioSummary,
  withOwnerParam,
} from "./property-owners";

type Navigate = (to: string, opts?: NavigateOptions) => void;

/**
 * Properties page. In the admin workspace: owners filter + a grid that fills
 * the content width (`AdminPropertiesList`). Landlords keep their own view
 * (`LandlordPropertiesList`) — one owner, so no owner filter.
 */
export function PropertiesList({ navigate }: { navigate: Navigate }) {
  const inAdminWorkspace = Boolean(useShellChrome()?.onOpenNav);
  return inAdminWorkspace ? (
    <AdminPropertiesList navigate={navigate} />
  ) : (
    <LandlordPropertiesList navigate={navigate} />
  );
}

function AdminPropertiesList({ navigate }: { navigate: Navigate }) {
  const { properties, landlords, canMutatePortfolio } = useApp();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Property | undefined>(undefined);
  // The owner filter lives in the URL (?owner=<landlord id>), so coming back
  // from a property restores it. The router doesn't hand this page `search`,
  // so the initial value comes straight from the location.
  const [ownerFilter, setOwnerFilter] = useState<number | null>(() =>
    parseOwnerParam(window.location.search),
  );

  const byId = useMemo(() => landlordIndex(landlords), [landlords]);
  const owners = useMemo(() => buildPropertyOwners(properties, byId), [properties, byId]);
  const total = {
    propertyCount: properties.length,
    unitCount: properties.reduce((sum, p) => sum + (p.unit_count ?? 0), 0),
    occupiedCount: properties.reduce((sum, p) => sum + (p.occupied_count ?? 0), 0),
  };

  const showOwnerFilter = owners.length > 1;
  // A filter for an owner who no longer has properties shows everyone's.
  const activeOwner =
    showOwnerFilter && ownerFilter != null ? owners.find((o) => o.id === ownerFilter) ?? null : null;
  const visible = activeOwner
    ? properties.filter((p) => p.landlord_id === activeOwner.id)
    : properties;

  const selectOwner = (ownerId: number | null) => {
    setOwnerFilter(ownerId);
    navigate(window.location.pathname, {
      replace: true,
      search: withOwnerParam(window.location.search, ownerId),
    });
  };

  const openNew = () => {
    setEditing(undefined);
    setDialogOpen(true);
  };

  return (
    <PageShell
      title="Properties"
      meta={portfolioSummary(total)}
      actions={
        canMutatePortfolio && properties.length > 0 ? (
          <Button onClick={openNew}>
            <Plus className="h-4 w-4" />
            New property
          </Button>
        ) : null
      }
    >
      {properties.length === 0 ? (
        <EmptyProperties canMutate={canMutatePortfolio} onNew={openNew} />
      ) : (
        <>
          {showOwnerFilter ? (
            <OwnerFilter
              owners={owners}
              total={total}
              selected={activeOwner?.id ?? null}
              onSelect={selectOwner}
            />
          ) : null}
          <ul
            aria-label={activeOwner ? `Properties owned by ${activeOwner.name}` : "Properties"}
            className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,20rem),1fr))] gap-4"
          >
            {visible.map((p) => (
              <PropertyCard
                key={p.id}
                property={p}
                owner={ownerIdentity(p.landlord_id, byId, p.landlord_name).name}
                onNavigate={navigate}
                onEdit={
                  canMutatePortfolio
                    ? () => {
                        setEditing(p);
                        setDialogOpen(true);
                      }
                    : undefined
                }
              />
            ))}
          </ul>
        </>
      )}

      <PropertyDialog open={dialogOpen} onOpenChange={setDialogOpen} property={editing} />
    </PageShell>
  );
}

function EmptyProperties({ canMutate, onNew }: { canMutate: boolean; onNew: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-20 text-center">
      <Building2 className="size-8 text-faint" aria-hidden />
      <p className="font-medium">No properties yet</p>
      <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
        {canMutate
          ? "Add your first property to start managing units, leases, and rent."
          : "Properties linked to your landlord account will appear here."}
      </p>
      {canMutate && (
        <Button className="mt-2" onClick={onNew}>
          <Plus className="h-4 w-4" /> New property
        </Button>
      )}
    </div>
  );
}

/** The landlord portal's Properties page — unchanged by the admin redesign. */
function LandlordPropertiesList({ navigate }: { navigate: Navigate }) {
  const { properties, canMutatePortfolio } = useApp();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Property | undefined>(undefined);

  const totalUnits = properties.reduce((sum, p) => sum + (p.unit_count ?? 0), 0);
  const occupied = properties.reduce((sum, p) => sum + (p.occupied_count ?? 0), 0);

  return (
    <PageShell
      title="Properties"
      meta={`${properties.length} ${properties.length === 1 ? "property" : "properties"} · ${totalUnits} ${totalUnits === 1 ? "unit" : "units"} · ${occupied}/${totalUnits || 0} occupied`}
      actions={
        canMutatePortfolio && properties.length > 0 ? (
          <Button onClick={() => { setEditing(undefined); setDialogOpen(true); }}>
            <Plus className="h-4 w-4" />
            New property
          </Button>
        ) : null
      }
    >
      {properties.length === 0 ? (
          <EmptyProperties
            canMutate={canMutatePortfolio}
            onNew={() => { setEditing(undefined); setDialogOpen(true); }}
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {properties.map((p) => {
              const palette = colorClasses(p.color);
              const occRate = p.unit_count
                ? Math.round(((p.occupied_count ?? 0) / p.unit_count) * 100)
                : 0;
              return (
                <Card
                  key={p.id}
                  className={cn(
                    "group relative cursor-pointer overflow-hidden p-5 transition-colors duration-150 hover:bg-muted",
                  )}
                  onClick={() => navigate(`/properties/${p.id}`)}
                >
                  <div className="mb-3 flex items-start justify-between">
                    <div className={cn("flex size-10 items-center justify-center rounded-md", palette.bg, palette.text)}>
                      <Building2 className="size-5" />
                    </div>
                    <span className="chip">
                      {PROPERTY_TYPE_LABELS[p.type] ?? p.type}
                    </span>
                  </div>
                  <h3 className="font-semibold tracking-tight">{p.name}</h3>
                  {(p.address || p.city) && (
                    <p className="mt-1 flex items-center gap-1 truncate text-sm text-muted-foreground">
                      <MapPin className="h-3 w-3 shrink-0" />
                      {[p.address, p.city, p.state].filter(Boolean).join(", ")}
                    </p>
                  )}
                  <div className="mt-4 grid grid-cols-3 gap-3 border-t pt-4 text-sm">
                    <Stat label="Units" value={p.unit_count ?? 0} />
                    <Stat label="Occupied" value={`${p.occupied_count ?? 0}/${p.unit_count ?? 0}`} />
                    <Stat label="Occupancy" value={`${occRate}%`} />
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    {canMutatePortfolio ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditing(p);
                          setDialogOpen(true);
                        }}
                        className="text-xs text-muted-foreground hover:text-foreground"
                      >
                        Edit
                      </button>
                    ) : (
                      <span />
                    )}
                    {p.year_built && (
                      <span className="text-xs text-muted-foreground">Built {p.year_built}</span>
                    )}
                  </div>
                </Card>
              );
          })}
        </div>
      )}

      <PropertyDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        property={editing}
      />
    </PageShell>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="stat-label">{label}</div>
      <div className="mt-0.5 text-base font-semibold tabular-nums">{value}</div>
    </div>
  );
}
