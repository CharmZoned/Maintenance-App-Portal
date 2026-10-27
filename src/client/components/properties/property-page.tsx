import { useEffect, useState } from "react";
import { ArrowLeft, Building2, MapPin, Pencil, Plus, Wrench } from "lucide-react";
import { useApp } from "@/context";
import { api } from "@/api";
import { cn, colorClasses, formatDate, formatMoney } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PropertyDialog } from "./property-dialog";
import { UnitDialog } from "./unit-dialog";
import { MaintenanceRequestDialog } from "../maintenance/maintenance-request-dialog";
import { TestDataBadge } from "@/components/test-data-badge";
import type { MaintenanceRequest, Property, Unit } from "@/types";
import { PageShell } from "@/components/page-shell";

const STATUS_TONE: Record<string, string> = {
  Vacant: "bg-warning-tint text-warning",
  Occupied: "bg-success-tint text-success",
};

export function PropertyPage({ id, navigate }: { id: number; navigate: (to: string) => void }) {
  const app = useApp();
  const [property, setProperty] = useState<Property | null>(null);
  const [units, setUnits] = useState<Unit[]>([]);
  const [requests, setRequests] = useState<MaintenanceRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingProperty, setEditingProperty] = useState(false);
  const [editingUnit, setEditingUnit] = useState<Unit | undefined>(undefined);
  const [unitDialogOpen, setUnitDialogOpen] = useState(false);
  const [requestDialogOpen, setRequestDialogOpen] = useState(false);

  async function load() {
    try {
      setLoading(true);
      const [{ property: p }, ulist, wlist] = await Promise.all([
        api<{ property: Property }>("GET", `/api/properties/${id}`),
        app.listUnits(id),
        app.listMaintenanceRequests({ property_id: id }),
      ]);
      setProperty(p);
      setUnits(ulist);
      setRequests(wlist);
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
  const occupied = units.filter((u) => u.status === "Occupied").length;
  const totalRent = units.reduce((sum, u) => sum + (u.market_rent ?? 0), 0);
  const openRequests = requests.filter((w) => w.status !== "Closed");

  return (
    <PageShell
      title={
        <button
          type="button"
          onClick={() => navigate("/properties")}
          className="inline-flex items-center gap-1.5 text-[1.375rem] font-semibold leading-tight tracking-[-0.01em] transition-colors duration-150 hover:text-muted-foreground"
        >
          <ArrowLeft className="size-4 text-muted-foreground" aria-hidden />
          Properties
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
                <h1 className="text-[1.375rem] font-semibold leading-tight tracking-[-0.01em]">{property.property_name || property.street_address}</h1>
                <span className="chip">{property.property_type}</span>
                <TestDataBadge show={property.is_test_data} />
              </div>
              <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
                <MapPin className="h-3 w-3" />
                {[property.street_address, property.city, property.state, property.zip].filter(Boolean).join(", ")}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge variant={property.management_status === "Active" ? "success" : property.management_status === "Partially Managed" ? "warning" : "neutral"}>
                  {property.management_status}
                </Badge>
                <Badge variant="neutral">{property.occupancy_status}</Badge>
                {property.source_id && (
                  <span className="text-xs text-muted-foreground">Source ID <span className="font-mono">{property.source_id}</span></span>
                )}
              </div>
            </div>
          </div>
          <Button variant="outline" onClick={() => setEditingProperty(true)}>
            <Pencil className="mr-1 h-4 w-4" /> Edit property
          </Button>
        </header>

        <Card className="p-5">
          <h2 className="mb-3 text-[1.0625rem] font-semibold leading-tight">Details</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Detail label="Landlord">
              {[property.landlord_first_name, property.landlord_last_name].filter(Boolean).join(" ") || "—"}
              {property.landlord_company_name ? ` · ${property.landlord_company_name}` : ""}
            </Detail>
            <Detail label="Landlord email">{property.landlord_email || "—"}</Detail>
            <Detail label="Year built">{property.year_built ?? "—"}</Detail>
            <Detail label="Management end date">{property.management_end_date ? formatDate(property.management_end_date) : "—"}</Detail>
          </div>
          {property.notes && (
            <>
              <div className="mt-4 text-[0.9375rem] font-semibold leading-tight">Notes</div>
              <p className="mt-1 whitespace-pre-wrap text-sm">{property.notes}</p>
            </>
          )}
        </Card>

        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <SummaryCard label="Units" value={String(units.length)} />
          <SummaryCard label="Occupied" value={`${occupied}/${units.length}`} />
          <SummaryCard label="Market rent" value={formatMoney(totalRent, app.settings.currency)} />
          <SummaryCard label="Open requests" value={String(openRequests.length)} tone={openRequests.length > 0 ? "warn" : "default"} />
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[1.0625rem] font-semibold leading-tight">Units</h2>
            <Button size="sm" onClick={() => { setEditingUnit(undefined); setUnitDialogOpen(true); }}>
              <Plus className="mr-1 h-4 w-4" /> New unit
            </Button>
          </div>
          {units.length === 0 ? (
            <Card className="p-8 text-center text-sm text-muted-foreground">
              No units yet. Add one to start tracking leases and rent.
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              {units.map((u) => (
                <Card key={u.id} className="cursor-pointer p-4 transition-colors duration-150 hover:bg-muted" onClick={() => { setEditingUnit(u); setUnitDialogOpen(true); }}>
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold">{u.unit_label}</h3>
                        <TestDataBadge show={u.is_test_data} />
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {u.bedrooms ?? "—"} bd · {u.bathrooms ?? "—"} ba{u.sqft ? ` · ${u.sqft} sqft` : ""}
                      </p>
                    </div>
                    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold", STATUS_TONE[u.status])}>
                      {u.status}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Badge variant={u.readiness_status === "Ready" ? "success" : "warning"}>{u.readiness_status}</Badge>
                    {u.management_status !== "Active" && <Badge variant="neutral">{u.management_status}</Badge>}
                    {u.currently_being_marketed && <Badge variant="info">Marketed</Badge>}
                  </div>
                  <div className="mt-3 flex items-end justify-between border-t pt-3">
                    <div>
                      <div className="stat-label">Market rent</div>
                      <div className="text-sm font-semibold tabular-nums">{formatMoney(u.market_rent, app.settings.currency)}</div>
                    </div>
                    <div className="text-right text-xs text-muted-foreground">
                      {u.active_tenant_name && <div>{u.active_tenant_name}</div>}
                      {u.expected_move_out_date && <div>Move-out {formatDate(u.expected_move_out_date)}</div>}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[1.0625rem] font-semibold leading-tight">Maintenance requests</h2>
            <Button size="sm" variant="outline" onClick={() => setRequestDialogOpen(true)}>
              <Plus className="mr-1 h-4 w-4" /> New request
            </Button>
          </div>
          {requests.length === 0 ? (
            <Card className="p-8 text-center text-sm text-muted-foreground">No maintenance requests for this property.</Card>
          ) : (
            <Card className="divide-y">
              {requests.map((w) => (
                <div key={w.id} className="flex items-center justify-between gap-4 p-4">
                  <div className="flex min-w-0 items-start gap-3">
                    <Wrench className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{w.title}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {[w.request_number, w.category, w.unit_name, w.vendor_name, formatDate(w.created_at)].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant="neutral">{w.priority}</Badge>
                    <Badge variant="secondary">{w.status}</Badge>
                  </div>
                </div>
              ))}
            </Card>
          )}
        </section>

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
      <MaintenanceRequestDialog
        open={requestDialogOpen}
        onOpenChange={(o) => { setRequestDialogOpen(o); if (!o) load(); }}
        defaults={{ property_id: property.id }}
      />
    </PageShell>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="section-label">{label}</div>
      <div className="mt-0.5 text-sm font-medium">{children}</div>
    </div>
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
