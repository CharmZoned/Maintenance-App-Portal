import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Building2, ChevronRight, MapPin, Pencil, Plus } from "lucide-react";
import { useApp } from "@/context";
import { cn, colorClasses, formatMoney } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PropertyDialog } from "./property-dialog";
import { UnitDialog } from "./unit-dialog";
import { PropertyDocumentsPanel } from "./property-documents-panel";
import { WorkOrderDialog } from "../maintenance/work-order-dialog";
import { LandlordSubmitDialog, unitDisplayName } from "../maintenance/landlord-submit-dialog";
import { RequestGroups } from "./request-groups";
import { openRequestCountByUnit, openRequestsLabel, unitPagePath } from "./property-requests";
import { PROPERTY_TYPE_LABELS, UNIT_READINESS_LABELS, type Property, type Unit, type WorkOrder } from "@/types";
import { isOpenRequest } from "@/lib/request-status";
import { PageShell } from "@/components/page-shell";

const STATUS_TONE: Record<string, string> = {
  vacant: "bg-warning-tint text-warning",
  occupied: "bg-success-tint text-success",
};

const READINESS_TONE: Record<string, string> = {
  ready: "bg-success-tint text-success",
  turnover_needed: "bg-info-tint text-info",
  turnover_in_progress: "bg-info-tint text-info",
  rehab_needed: "bg-warning-tint text-warning",
  rehab_in_progress: "bg-warning-tint text-warning",
};

export function PropertyPage({ id, navigate }: { id: number; navigate: (to: string) => void }) {
  const app = useApp();
  const [property, setProperty] = useState<Property | null>(null);
  const [units, setUnits] = useState<Unit[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingProperty, setEditingProperty] = useState(false);
  const [editingUnit, setEditingUnit] = useState<Unit | undefined>(undefined);
  const [unitDialogOpen, setUnitDialogOpen] = useState(false);
  const [woDialogOpen, setWoDialogOpen] = useState(false);
  const [landlordSubmitOpen, setLandlordSubmitOpen] = useState(false);

  async function load() {
    try {
      setLoading(true);
      const [p, ulist, wlist] = await Promise.all([
        app.getProperty(id),
        app.listUnits(id),
        app.listWorkOrders({ property_id: id }),
      ]);
      setProperty(p);
      setUnits(ulist);
      setWorkOrders(wlist);
    } catch (err) {
      app.setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Stable object: the dialog resets its fields whenever `defaults` changes.
  const woDefaults = useMemo(() => ({ property_id: id }), [id]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        Loading property…
      </div>
    );
  }
  if (!property) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2">
        <p className="text-sm text-muted-foreground">Property not found.</p>
        <Button variant="outline" onClick={() => navigate("/properties")}>Back to properties</Button>
      </div>
    );
  }

  const palette = colorClasses(property.color);
  const occupied = units.filter((u) => u.status === "occupied").length;
  const totalRent = units.reduce((sum, u) => sum + (u.market_rent ?? 0), 0);
  const openRequests = workOrders.filter((w) => isOpenRequest(w));
  const openByUnit = openRequestCountByUnit(workOrders);
  // A landlord with one property never sees the list (it sends them here), so
  // the back link goes Home instead of bouncing straight back to this page.
  const backToHome = app.isLandlord && app.properties.length === 1;
  const canNewRequest = app.canCreateWorkOrders || (app.isLandlord && app.canSubmitRequest);
  function openNewRequest() {
    if (app.canCreateWorkOrders) setWoDialogOpen(true);
    else setLandlordSubmitOpen(true);
  }

  return (
    <PageShell
      title={
        <button
          type="button"
          onClick={() => navigate(backToHome ? "/home" : "/properties")}
          className="inline-flex items-center gap-1.5 text-[1.375rem] font-semibold leading-tight tracking-[-0.01em] transition-colors duration-150 hover:text-muted-foreground"
        >
          <ArrowLeft className="size-4 text-muted-foreground" aria-hidden />
          {backToHome ? "Home" : "Properties"}
        </button>
      }
      width="max-w-7xl"
    >
        <header className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className={cn("flex size-12 items-center justify-center rounded-md", palette.bg, palette.text)}>
              <Building2 className="size-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-[1.375rem] font-semibold leading-tight tracking-[-0.01em]">{property.name}</h1>
                <span className="rounded-full border bg-muted/30 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {PROPERTY_TYPE_LABELS[property.type] ?? property.type}
                </span>
              </div>
              {(property.address || property.city) && (
                <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
                  <MapPin className="h-3 w-3" />
                  {[property.address, property.city, property.state, property.zip].filter(Boolean).join(", ")}
                </p>
              )}
              {property.landlord_name && (
                <p className="mt-1 text-sm text-muted-foreground">
                  Landlord: {property.landlord_name}
                </p>
              )}
            </div>
          </div>
          {app.canMutatePortfolio && (
            <Button variant="outline" onClick={() => setEditingProperty(true)}>
              <Pencil className="mr-1 h-4 w-4" /> Edit property
            </Button>
          )}
        </header>

        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <SummaryCard label="Units" value={String(units.length)} />
          <SummaryCard label="Occupied" value={`${occupied}/${units.length}`} />
          <SummaryCard label="Market rent" value={formatMoney(totalRent, app.settings.currency)} />
          <SummaryCard label="Open requests" value={String(openRequests.length)} tone={openRequests.length > 0 ? "warn" : "default"} />
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[1.0625rem] font-semibold leading-tight">Units</h2>
            {app.canMutatePortfolio && (
              <Button size="sm" onClick={() => { setEditingUnit(undefined); setUnitDialogOpen(true); }}>
                <Plus className="mr-1 h-4 w-4" /> New unit
              </Button>
            )}
          </div>
          {units.length === 0 ? (
            <Card className="p-8 text-center text-sm text-muted-foreground">
              No units yet. Add one to start tracking leases and rent.
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              {units.map((u) => {
                const href = unitPagePath(property.id, u.id);
                const openCount = openByUnit.get(u.id) ?? 0;
                return (
                  <Card key={u.id} className="relative p-4 transition-colors duration-150 hover:bg-muted">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="font-semibold">
                          {/* Stretched link: the whole card opens the unit page. */}
                          <a
                            href={href}
                            onClick={(e) => {
                              if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                              e.preventDefault();
                              navigate(href);
                            }}
                            className="outline-none after:absolute after:inset-0 after:rounded-[inherit] focus-visible:after:ring-[3px] focus-visible:after:ring-ring/40"
                          >
                            {unitDisplayName(u.name)}
                          </a>
                        </h3>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {u.bedrooms} bd · {u.bathrooms} ba{u.sqft ? ` · ${u.sqft} sqft` : ""}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold capitalize", STATUS_TONE[u.status])}>
                          {u.status}
                        </span>
                        {u.readiness_status !== "ready" && (
                          <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold", READINESS_TONE[u.readiness_status])}>
                            {UNIT_READINESS_LABELS[u.readiness_status] ?? u.readiness_status}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="mt-3 flex items-end justify-between gap-3 border-t pt-3">
                      <div className="min-w-0">
                        {app.isLandlord ? (
                          <>
                            <div className="stat-label">Tenant</div>
                            <div className="truncate text-sm font-medium">{u.active_tenant_name || "Vacant"}</div>
                          </>
                        ) : (
                          <>
                            <div className="stat-label">Market rent</div>
                            <div className="text-sm font-semibold tabular-nums">{formatMoney(u.market_rent, app.settings.currency)}</div>
                          </>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1 text-right text-xs text-muted-foreground">
                        <span className={cn(openCount > 0 && "font-medium text-foreground")}>{openRequestsLabel(openCount)}</span>
                        <ChevronRight className="size-3.5" aria-hidden />
                      </div>
                    </div>
                    {!app.isLandlord && (u.active_tenant_name || app.canMutatePortfolio) ? (
                      <div className="mt-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                        <span className="truncate">{u.active_tenant_name ? `Tenant: ${u.active_tenant_name}` : "Vacant"}</span>
                        {app.canMutatePortfolio && (
                          <button
                            type="button"
                            onClick={() => { setEditingUnit(u); setUnitDialogOpen(true); }}
                            className="relative z-10 shrink-0 hover:text-foreground"
                            aria-label={`Edit ${unitDisplayName(u.name)}`}
                          >
                            Edit unit
                          </button>
                        )}
                      </div>
                    ) : null}
                  </Card>
                );
              })}
            </div>
          )}
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-[1.0625rem] font-semibold leading-tight">Requests</h2>
            {canNewRequest && (
              <Button size="sm" variant="outline" onClick={openNewRequest}>
                <Plus className="mr-1 h-4 w-4" /> New request
              </Button>
            )}
          </div>
          <RequestGroups
            orders={workOrders}
            showPlace
            navigate={navigate}
            emptyText="No requests for this property yet."
          />
        </section>

        <PropertyDocumentsPanel propertyId={property.id} units={units} />

      <PropertyDialog
        open={editingProperty}
        onOpenChange={(o) => { setEditingProperty(o); if (!o) load(); }}
        property={property}
      />
      <UnitDialog
        open={unitDialogOpen}
        onOpenChange={(o) => { setUnitDialogOpen(o); if (!o) load(); }}
        propertyId={property.id}
        unit={editingUnit}
      />
      {app.canCreateWorkOrders ? (
        <WorkOrderDialog
          open={woDialogOpen}
          onOpenChange={(o) => { setWoDialogOpen(o); if (!o) load(); }}
          defaults={woDefaults}
        />
      ) : null}
      {app.isLandlord ? (
        <LandlordSubmitDialog
          open={landlordSubmitOpen}
          onOpenChange={setLandlordSubmitOpen}
          presetPropertyId={property.id}
          onCreated={() => void load()}
        />
      ) : null}
    </PageShell>
  );
}

function SummaryCard({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "warn" }) {
  return (
    <Card className="p-4">
      <div className="stat-label">{label}</div>
      <div className={cn("mt-1 text-xl font-semibold tabular-nums", tone === "warn" && "text-warning")}>{value}</div>
    </Card>
  );
}
