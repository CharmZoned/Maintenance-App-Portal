import { useEffect, useMemo, useState } from "react";
import { Building2, MapPin, Plus } from "lucide-react";
import { useApp } from "@/context";
import { cn, colorClasses } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PropertyDialog } from "./property-dialog";
import { PROPERTY_TYPE_LABELS, type Property, type Unit, type WorkOrder } from "@/types";
import { unitDisplayName } from "../maintenance/landlord-submit-dialog";
import { openRequestCountByProperty, singlePropertyRedirect } from "./property-requests";
import { PageShell } from "@/components/page-shell";

export function PropertiesList({
  navigate,
}: {
  navigate: (to: string, opts?: { replace?: boolean }) => void;
}) {
  const { properties, canMutatePortfolio, isLandlord, loading, listUnits, listWorkOrders } = useApp();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Property | undefined>(undefined);
  const [landlordUnits, setLandlordUnits] = useState<Unit[]>([]);
  const [openOrders, setOpenOrders] = useState<WorkOrder[]>([]);

  // A landlord with exactly one property goes straight to it. `replace`, so
  // Back from the property page doesn't land here and bounce again.
  const redirectTo = singlePropertyRedirect({ isLandlord, loading, properties });
  useEffect(() => {
    if (redirectTo) navigate(redirectTo, { replace: true });
  }, [redirectTo, navigate]);

  // Landlords with several properties: unit names and open-request counts per card.
  const showLandlordDetail = isLandlord && !loading && properties.length > 1;
  useEffect(() => {
    if (!showLandlordDetail) return;
    let cancelled = false;
    void Promise.all([
      listUnits(),
      listWorkOrders({ open_only: true, skip_staff_notes: true }),
    ])
      .then(([units, orders]) => {
        if (cancelled) return;
        setLandlordUnits(units);
        setOpenOrders(orders);
      })
      .catch(() => {
        // Counts are extra detail; the cards still work without them.
      });
    return () => {
      cancelled = true;
    };
  }, [showLandlordDetail, listUnits, listWorkOrders]);

  const openByProperty = useMemo(() => openRequestCountByProperty(openOrders), [openOrders]);
  const unitsByProperty = useMemo(() => {
    const map = new Map<number, Unit[]>();
    for (const u of landlordUnits) {
      const list = map.get(u.property_id) ?? [];
      list.push(u);
      map.set(u.property_id, list);
    }
    return map;
  }, [landlordUnits]);

  if (redirectTo) {
    return (
      <PageShell title="Properties">
        <p className="text-sm text-muted-foreground">Opening your property…</p>
      </PageShell>
    );
  }

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
          <div className="flex flex-col items-center justify-center gap-2 px-6 py-20 text-center">
            <Building2 className="size-8 text-faint" aria-hidden />
            <p className="font-medium">No properties yet</p>
            <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
              {canMutatePortfolio
                ? "Add your first property to start managing units, leases, and rent."
                : "Properties linked to your landlord account will appear here."}
            </p>
            {canMutatePortfolio && (
              <Button className="mt-2" onClick={() => { setEditing(undefined); setDialogOpen(true); }}>
                <Plus className="h-4 w-4" /> New property
              </Button>
            )}
          </div>
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
                    {isLandlord ? (
                      <Stat label="Open requests" value={openByProperty.get(p.id) ?? 0} />
                    ) : (
                      <Stat label="Occupancy" value={`${occRate}%`} />
                    )}
                  </div>
                  {isLandlord && (unitsByProperty.get(p.id)?.length ?? 0) > 0 ? (
                    <p className="mt-3 truncate text-xs text-muted-foreground">
                      {unitsByProperty
                        .get(p.id)!
                        .map((u) => unitDisplayName(u.name))
                        .join(" · ")}
                    </p>
                  ) : null}
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
