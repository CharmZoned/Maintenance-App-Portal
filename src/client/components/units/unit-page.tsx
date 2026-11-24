import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, DoorOpen, MapPin, Plus } from "lucide-react";
import { useApp } from "@/context";
import { cn, colorClasses } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageShell } from "@/components/page-shell";
import { ErrorRetry, SkeletonRow } from "@/components/patterns";
import { LandlordDocumentRow } from "@/components/landlord";
import { landlordDocumentRowModel } from "@/lib/landlord-documents";
import { isOpenRequest } from "@/lib/request-status";
import { WorkOrderDialog } from "@/components/maintenance/work-order-dialog";
import {
  LandlordSubmitDialog,
  unitDisplayName,
} from "@/components/maintenance/landlord-submit-dialog";
import { RequestGroups } from "@/components/properties/request-groups";
import type { Property, PropertyDocument, Unit, WorkOrder } from "@/types";

const STATUS_TONE: Record<string, string> = {
  vacant: "bg-warning-tint text-warning",
  occupied: "bg-success-tint text-success",
};

/** "Shared with" words for staff; the landlord copy says "you" for the landlord. */
function staffAudienceLabel(visibility: PropertyDocument["visibility"]): string {
  switch (visibility) {
    case "tenant":
      return "Tenant, landlord and staff";
    case "landlord":
      return "Landlord and staff";
    default:
      return "Staff only";
  }
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

/**
 * Unit page (`/properties/:id/units/:unitId`, LG-E).
 *
 * Unit facts, the current tenant's name (never their contact details), open
 * and completed requests, the unit's documents, and "New request for this
 * unit". Landlords file through `LandlordSubmitDialog`; admins use the
 * work-order dialog. Other staff read only.
 */
export function UnitPage({
  propertyId,
  unitId,
  navigate,
}: {
  propertyId: number;
  unitId: number;
  navigate: (to: string) => void;
}) {
  const app = useApp();
  const {
    getProperty,
    listUnits,
    listWorkOrders,
    listPropertyDocuments,
    getPropertyDocumentDownloadUrl,
    setError,
  } = app;
  const [property, setProperty] = useState<Property | null>(null);
  const [unit, setUnit] = useState<Unit | null>(null);
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [docs, setDocs] = useState<PropertyDocument[]>([]);
  const [docsFailed, setDocsFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [landlordSubmitOpen, setLandlordSubmitOpen] = useState(false);
  const [woDialogOpen, setWoDialogOpen] = useState(false);

  const load = useCallback(
    async (opts?: { quiet?: boolean }) => {
      try {
        if (!opts?.quiet) setLoading(true);
        setLoadFailed(false);
        const [p, units, wos] = await Promise.all([
          getProperty(propertyId),
          listUnits(propertyId),
          listWorkOrders({ property_id: propertyId }),
        ]);
        const u = units.find((row) => row.id === unitId && row.property_id === propertyId) ?? null;
        setProperty(p);
        setUnit(u);
        setOrders(wos.filter((w) => w.unit_id === unitId));
        try {
          setDocsFailed(false);
          const list = await listPropertyDocuments({ property_id: propertyId });
          setDocs(list.filter((d) => d.unit_id === unitId));
        } catch {
          setDocsFailed(true);
          setDocs([]);
        }
      } catch (err) {
        setLoadFailed(true);
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [getProperty, listUnits, listWorkOrders, listPropertyDocuments, setError, propertyId, unitId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Stable object: the dialog resets its fields whenever `defaults` changes.
  const woDefaults = useMemo(
    () => ({ property_id: propertyId, unit_id: unitId }),
    [propertyId, unitId],
  );

  async function downloadDoc(doc: PropertyDocument) {
    try {
      setDownloadingId(doc.id);
      const url = await getPropertyDocumentDownloadUrl(doc);
      const a = document.createElement("a");
      a.href = url;
      a.download = doc.file_name;
      a.rel = "noreferrer";
      a.target = "_blank";
      a.click();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDownloadingId(null);
    }
  }

  const propertyPath = `/properties/${propertyId}`;
  const backLabel = property?.name?.trim() || "Property";
  const title = (
    <button
      type="button"
      onClick={() => navigate(propertyPath)}
      className="inline-flex max-w-full items-center gap-1.5 text-[1.375rem] font-semibold leading-tight tracking-[-0.01em] transition-colors duration-150 hover:text-muted-foreground"
    >
      <ArrowLeft className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="truncate">{backLabel}</span>
    </button>
  );

  if (loading) {
    return (
      <PageShell title={title} width="max-w-6xl">
        <div className="space-y-3" aria-busy="true" aria-live="polite">
          <p className="text-sm text-muted-foreground">Loading unit…</p>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </div>
      </PageShell>
    );
  }

  if (loadFailed) {
    return (
      <PageShell title={title} width="max-w-6xl">
        <ErrorRetry message="This unit could not load. Please try again." onRetry={() => void load()} />
      </PageShell>
    );
  }

  if (!property || !unit) {
    return (
      <PageShell title={title} width="max-w-6xl">
        <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
          <p className="text-sm text-muted-foreground">We couldn’t find this unit.</p>
          <Button variant="outline" onClick={() => navigate(property ? propertyPath : "/properties")}>
            {property ? `Back to ${backLabel}` : "Back to properties"}
          </Button>
        </div>
      </PageShell>
    );
  }

  const palette = colorClasses(property.color);
  const unitName = unitDisplayName(unit.name);
  const openCount = orders.filter((w) => isOpenRequest(w)).length;
  const address = [property.address, property.city, property.state, property.zip]
    .filter(Boolean)
    .join(", ");
  const canFileForUnit = app.isLandlord ? app.canSubmitRequest : app.canCreateWorkOrders;
  const tenantName = unit.active_tenant_name?.trim() || null;

  return (
    <PageShell title={title} width="max-w-6xl">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className={cn("flex size-12 shrink-0 items-center justify-center rounded-md", palette.bg, palette.text)}>
            <DoorOpen className="size-6" aria-hidden />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[1.375rem] font-semibold leading-tight tracking-[-0.01em]">{unitName}</h2>
              <span
                className={cn(
                  "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold capitalize",
                  STATUS_TONE[unit.status],
                )}
              >
                {unit.status}
              </span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{property.name}</p>
            {address ? (
              <p className="mt-0.5 flex items-center gap-1 text-sm text-muted-foreground">
                <MapPin className="h-3 w-3 shrink-0" aria-hidden />
                <span className="truncate">{address}</span>
              </p>
            ) : null}
          </div>
        </div>
        {canFileForUnit ? (
          <Button
            variant="brand"
            size="touch"
            className="w-full sm:w-auto"
            onClick={() => (app.isLandlord ? setLandlordSubmitOpen(true) : setWoDialogOpen(true))}
          >
            <Plus className="h-4 w-4" aria-hidden /> New request for this unit
          </Button>
        ) : null}
      </header>

      <section aria-label="Unit facts" className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Fact label="Bedrooms" value={String(unit.bedrooms)} />
        <Fact label="Bathrooms" value={String(unit.bathrooms)} />
        <Fact label="Size" value={unit.sqft ? `${unit.sqft} sqft` : "Not recorded"} />
        <Fact label="Open requests" value={String(openCount)} tone={openCount > 0 ? "warn" : "default"} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-[1.0625rem] font-semibold leading-tight">Current tenant</h2>
        <Card className="flex items-center gap-3 p-4">
          {tenantName ? (
            <>
              <span
                className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground"
                aria-hidden
              >
                {initials(tenantName)}
              </span>
              <p className="min-w-0 truncate text-sm font-medium">{tenantName}</p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No current tenant. This unit is vacant.</p>
          )}
        </Card>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-[1.0625rem] font-semibold leading-tight">Requests</h2>
        <RequestGroups
          orders={orders}
          showPlace={false}
          navigate={navigate}
          emptyText="No requests for this unit yet."
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-[1.0625rem] font-semibold leading-tight">Documents</h2>
        {docsFailed ? (
          <ErrorRetry
            message="Documents could not load. Please try again."
            onRetry={() => void load({ quiet: true })}
          />
        ) : docs.length === 0 ? (
          <p className="rounded-md border border-border bg-card px-6 py-8 text-center text-sm text-muted-foreground">
            No documents for this unit yet.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {docs.map((doc) => (
              <LandlordDocumentRow
                key={doc.id}
                model={
                  app.isLandlord
                    ? landlordDocumentRowModel(doc)
                    : { ...landlordDocumentRowModel(doc), audienceLabel: staffAudienceLabel(doc.visibility) }
                }
                showScope={false}
                onDownload={() => void downloadDoc(doc)}
                downloading={downloadingId === doc.id}
              />
            ))}
          </div>
        )}
      </section>

      {app.isLandlord ? (
        <LandlordSubmitDialog
          open={landlordSubmitOpen}
          onOpenChange={setLandlordSubmitOpen}
          presetPropertyId={propertyId}
          presetUnitId={unitId}
          onCreated={() => void load({ quiet: true })}
        />
      ) : app.canCreateWorkOrders ? (
        <WorkOrderDialog
          open={woDialogOpen}
          onOpenChange={(o) => {
            setWoDialogOpen(o);
            if (!o) void load({ quiet: true });
          }}
          defaults={woDefaults}
        />
      ) : null}
    </PageShell>
  );
}

function Fact({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "warn" }) {
  return (
    <Card className="p-4">
      <div className="stat-label">{label}</div>
      <div className={cn("mt-1 text-xl font-semibold tabular-nums", tone === "warn" && "text-warning")}>{value}</div>
    </Card>
  );
}
