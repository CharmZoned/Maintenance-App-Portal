import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Building2, Calendar, ChevronLeft, Wrench } from "lucide-react";
import { useApp } from "@/context";
import {
  LandlordDocumentRow,
  LandlordPageIntro,
  LandlordScopeHeading,
  StatusBanner,
  ToneBadge,
  documentScopeGroupLabel,
  groupLandlordDocuments,
  landlordDocumentRowModel,
  sectionCardClass,
} from "@/components/landlord";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import {
  PROPERTY_ERROR,
  PROPERTY_UNAVAILABLE,
  buildPropertyDetailModel,
  isMissingPropertyError,
  type AttentionItem,
  type FactChip,
  type MessageRowModel,
  type PropertyDetailModel,
  type PropertyTab,
  type RequestRowModel,
  type UnitCardModel,
} from "@/lib/landlord-properties";
import { cn, currentPeriod } from "@/lib/utils";
import type { Lease, Property, PropertyDocument, RentCharge, Unit, WorkOrder } from "@/types";

/** Leases.unit_id can take several ids in one query. There is no property_id column. */
async function listActiveLeases(
  listLeases: (params?: { unit_ids?: number[]; status?: string }) => Promise<Lease[]>,
  units: Unit[],
): Promise<Lease[]> {
  const unitIds = [...new Set(units.map((unit) => unit.id))];
  if (unitIds.length === 0) return [];
  return listLeases({ unit_ids: unitIds, status: "active" });
}

export function LandlordPropertyPage({ id, navigate }: { id: number; navigate: (to: string) => void }) {
  const {
    getProperty,
    listUnits,
    listLeases,
    listCharges,
    listWorkOrders,
    listPropertyDocuments,
    getPropertyDocumentDownloadUrl,
    setError,
    settings,
  } = useApp();
  const [property, setProperty] = useState<Property | null>(null);
  const [units, setUnits] = useState<Unit[]>([]);
  const [leases, setLeases] = useState<Lease[]>([]);
  const [charges, setCharges] = useState<RentCharge[]>([]);
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [documents, setDocuments] = useState<PropertyDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [error, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [tab, setTab] = useState<PropertyTab>("overview");
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  useEffect(() => {
    setTab("overview");
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setMissing(false);
      setLoadError(null);
      try {
        const nextProperty = await getProperty(id);
        const nextUnits = await listUnits(id);
        const nextLeases = await listActiveLeases(listLeases, nextUnits);
        const leaseIds = nextLeases.map((lease) => lease.id);
        const [nextCharges, nextOrders, nextDocs] = await Promise.all([
          listCharges(currentPeriod(), { lease_ids: leaseIds }),
          listWorkOrders({ property_id: id, skip_staff_notes: true }),
          listPropertyDocuments({ property_id: id }),
        ]);
        if (cancelled) return;
        const unitIds = new Set(nextUnits.map((unit) => unit.id));
        const leaseIdSet = new Set(leaseIds);
        setProperty(nextProperty);
        setUnits(nextUnits);
        setLeases(nextLeases.filter((lease) => unitIds.has(lease.unit_id) && lease.status === "active"));
        setCharges(
          nextCharges.filter((charge) => charge.property_id === id && leaseIdSet.has(charge.lease_id)),
        );
        setOrders(nextOrders);
        setDocuments(nextDocs);
      } catch (err) {
        if (cancelled) return;
        const message = (err as Error).message;
        if (isMissingPropertyError(message)) setMissing(true);
        else setLoadError(message);
        setProperty(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, reloadKey, getProperty, listUnits, listLeases, listCharges, listWorkOrders, listPropertyDocuments]);

  const model = useMemo(() => {
    if (!property) return null;
    return buildPropertyDetailModel({
      property,
      units,
      charges,
      leases,
      workOrders: orders,
      documents,
      currency: settings.currency,
    });
  }, [property, units, charges, leases, orders, documents, settings.currency]);

  function messageGopher() {
    navigate("/messages");
  }

  async function downloadDoc(doc: PropertyDocument) {
    try {
      setDownloadingId(doc.id);
      const url = await getPropertyDocumentDownloadUrl(doc);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = doc.file_name;
      anchor.rel = "noreferrer";
      anchor.target = "_blank";
      anchor.click();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <PageShell title={property?.name ?? "Property"} width="max-w-6xl">
      <Button type="button" variant="ghost" size="touch" className="-ml-2" onClick={() => navigate("/properties")}>
        <ChevronLeft aria-hidden />
        Back to properties
      </Button>

      {loading ? (
        <div className="space-y-4" aria-busy="true" aria-label="Loading property">
          <div className="h-24 animate-pulse rounded-sm bg-muted" />
          <div className="h-11 animate-pulse rounded-sm bg-muted" />
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <div className="h-28 animate-pulse rounded-sm bg-muted" />
            <div className="h-28 animate-pulse rounded-sm bg-muted" />
            <div className="h-28 animate-pulse rounded-sm bg-muted" />
            <div className="h-28 animate-pulse rounded-sm bg-muted" />
          </div>
        </div>
      ) : missing ? (
        <Unavailable
          onHome={() => navigate("/home")}
          onProperties={() => navigate("/properties")}
        />
      ) : error || !model ? (
        <StatusBanner
          title={PROPERTY_ERROR.title}
          body={PROPERTY_ERROR.body}
          actions={
            <>
              <Button type="button" variant="secondary" size="touch" onClick={() => setReloadKey((key) => key + 1)}>
                Try again
              </Button>
              <Button type="button" variant="secondary" size="touch" onClick={messageGopher}>
                Message Landlord Gopher
              </Button>
            </>
          }
        />
      ) : (
        <PropertyBody
          model={model}
          tab={tab}
          onTab={setTab}
          documents={documents}
          units={units}
          downloadingId={downloadingId}
          onDownload={(doc) => void downloadDoc(doc)}
          onMessage={messageGopher}
          onMaintenance={() => navigate("/maintenance")}
          onRequest={(requestId) => navigate(`/maintenance/${requestId}`)}
        />
      )}
    </PageShell>
  );
}

function PropertyBody({
  model,
  tab,
  onTab,
  documents,
  units,
  downloadingId,
  onDownload,
  onMessage,
  onMaintenance,
  onRequest,
}: {
  model: PropertyDetailModel;
  tab: PropertyTab;
  onTab: (tab: PropertyTab) => void;
  documents: PropertyDocument[];
  units: Unit[];
  downloadingId: number | null;
  onDownload: (doc: PropertyDocument) => void;
  onMessage: () => void;
  onMaintenance: () => void;
  onRequest: (id: number) => void;
}) {
  return (
    <>
      <LandlordPageIntro
        eyebrow={model.eyebrow}
        title={model.title}
        description={model.description}
        action={
          <div className="flex flex-col gap-2 md:flex-row">
            <Button type="button" variant="secondary" size="touch" onClick={onMessage}>
              Message Landlord Gopher
            </Button>
            <Button type="button" variant="secondary" size="touch" className="hidden md:inline-flex" onClick={() => onTab("documents")}>
              Share a document
            </Button>
            <Button type="button" variant="secondary" size="touch" className="hidden md:inline-flex" onClick={() => onTab("requests")}>
              Report an issue
            </Button>
          </div>
        }
      />

      <div role="tablist" aria-label="Property sections" className="-mt-2 flex gap-1 overflow-x-auto border-b border-border">
        {model.tabs.map((item) => {
          const selected = item.id === tab;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={selected}
              className={cn(
                "h-11 shrink-0 border-b-2 px-3 lg-body-medium",
                selected ? "border-foreground text-foreground" : "border-transparent text-muted-foreground",
              )}
              onClick={() => onTab(item.id)}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      {tab === "overview" ? (
        <Overview model={model} onRequests={() => onTab("requests")} onMessage={onMessage} onRequest={onRequest} />
      ) : null}
      {tab === "units" ? (
        <UnitsPanel model={model} onMessage={onMessage} onDocuments={() => onTab("documents")} />
      ) : null}
      {tab === "requests" ? (
        <RequestsPanel model={model} onRequest={onRequest} onMaintenance={onMaintenance} onMessage={onMessage} />
      ) : null}
      {tab === "messages" ? (
        <MessagesPanel model={model} onMessage={onMessage} onRequest={onRequest} />
      ) : null}
      {tab === "documents" ? (
        <DocumentsPanel
          propertyName={model.title}
          documents={documents}
          units={units}
          downloadingId={downloadingId}
          onDownload={onDownload}
          onMessage={onMessage}
        />
      ) : null}
    </>
  );
}

function Overview({
  model,
  onRequests,
  onMessage,
  onRequest,
}: {
  model: PropertyDetailModel;
  onRequests: () => void;
  onMessage: () => void;
  onRequest: (id: number) => void;
}) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {model.kpis.map((kpi) => (
          <div key={kpi.label} className="rounded-sm border border-border bg-card p-5">
            <p className="lg-label uppercase text-muted-foreground">{kpi.label}</p>
            <p className="mt-1.5 lg-heading text-foreground">{kpi.value}</p>
            <p className="mt-1.5 lg-caption text-muted-foreground">{kpi.caption}</p>
          </div>
        ))}
      </div>

      {model.attention.length > 0 ? (
        <section className={sectionCardClass()}>
          <h2 className="lg-section text-foreground">Needs your attention</h2>
          <ul className="flex flex-col gap-3">
            {model.attention.map((item, index) => (
              <li key={item.id} className={cn(index > 0 && "border-t border-border pt-3")}>
                <AttentionRow item={item} onMessage={onMessage} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex flex-col gap-6">
          <section className={sectionCardClass("gap-3.5")}>
            <h2 className="lg-section text-foreground">{model.rent.title}</h2>
            <p className="lg-heading text-foreground">{model.rent.headline}</p>
            {model.rent.percent != null ? (
              <div>
                <div className="h-2 overflow-hidden rounded-sm bg-muted" aria-hidden>
                  <div className="h-full rounded-sm bg-success" style={{ width: `${model.rent.percent}%` }} />
                </div>
                <p className="mt-2 lg-caption text-muted-foreground">{model.rent.caption}</p>
              </div>
            ) : (
              <p className="lg-caption text-muted-foreground">{model.rent.caption}</p>
            )}
            {model.rent.rows.map((row) => (
              <div key={row.id} className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="lg-body-medium text-foreground">{row.title}</p>
                  <p className="lg-caption text-muted-foreground">{row.detail}</p>
                </div>
                <ToneBadge chip={row.badge} />
              </div>
            ))}
          </section>

          <section className={sectionCardClass()}>
            <h2 className="lg-section text-foreground">Property details</h2>
            {model.details.map((field) => (
              <div key={field.label} className="flex flex-col gap-1 sm:flex-row sm:gap-4">
                <p className="w-[140px] shrink-0 lg-body text-muted-foreground">{field.label}</p>
                <p className="lg-body-medium text-foreground">{field.value}</p>
              </div>
            ))}
          </section>
        </div>

        <div className="flex flex-col gap-6">
          <section className={sectionCardClass()}>
            <h2 className="lg-section text-foreground">Maintenance</h2>
            <p className="lg-body-medium text-foreground">{model.maintenance.summary}</p>
            <div className="rounded-sm bg-muted p-3">
              <p className="lg-label uppercase text-muted-foreground">Spend this year</p>
              <p className="mt-0.5 lg-heading text-foreground">{model.maintenance.spendValue}</p>
              <p className="mt-0.5 lg-caption text-muted-foreground">{model.maintenance.spendCaption}</p>
            </div>
            {model.maintenance.rows.map((row) => (
              <RequestLine key={row.id} row={row} onOpen={() => onRequest(row.id)} />
            ))}
            <Button type="button" variant="secondary" size="touch" className="w-full" onClick={onRequests}>
              View requests
            </Button>
          </section>

          <section className="flex flex-col gap-2 rounded-sm border border-border bg-muted p-6">
            <h2 className="lg-section text-foreground">A little help, when you need it.</h2>
            <p className="lg-body-medium text-foreground">Landlord Gopher</p>
            <p className="lg-caption text-muted-foreground">
              Message us about this property. We keep the details up to date.
            </p>
            <Button type="button" variant="secondary" size="touch" className="mt-1 w-full" onClick={onMessage}>
              Message Landlord Gopher
            </Button>
          </section>
        </div>
      </div>
    </div>
  );
}

function AttentionRow({ item, onMessage }: { item: AttentionItem; onMessage: () => void }) {
  const Icon = item.kind === "lease" ? Calendar : AlertTriangle;
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <span className="flex size-[34px] shrink-0 items-center justify-center rounded-sm bg-warning-tint text-warning">
        <Icon className="size-[18px]" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="lg-body-medium text-foreground">{item.title}</p>
        <p className="lg-caption text-muted-foreground">{item.detail}</p>
      </div>
      {item.badge ? <ToneBadge chip={item.badge} /> : null}
      {item.kind === "lease" ? (
        <Button type="button" variant="secondary" size="touch" onClick={onMessage}>
          Message Landlord Gopher
        </Button>
      ) : null}
    </div>
  );
}

function UnitsPanel({
  model,
  onMessage,
  onDocuments,
}: {
  model: PropertyDetailModel;
  onMessage: () => void;
  onDocuments: () => void;
}) {
  return (
    <section className="space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="lg-section text-foreground">Units</h2>
        <p className="lg-body text-muted-foreground">{model.unitsHeading}</p>
      </div>
      {model.units.length === 0 ? (
        <p className="rounded-sm border border-border bg-card p-6 lg-body text-muted-foreground">No units on this property yet.</p>
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {model.units.map((unit) => (
            <UnitCard key={unit.id} unit={unit} onMessage={onMessage} onDocuments={onDocuments} />
          ))}
        </div>
      )}
    </section>
  );
}

function UnitCard({
  unit,
  onMessage,
  onDocuments,
}: {
  unit: UnitCardModel;
  onMessage: () => void;
  onDocuments: () => void;
}) {
  return (
    <article className={sectionCardClass("gap-4")}>
      <div className="flex items-start justify-between gap-3">
        <h3 className="lg-section text-foreground">{unit.name}</h3>
        {unit.badge ? <ToneBadge chip={unit.badge} /> : null}
      </div>
      <div className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-full bg-muted lg-label text-muted-foreground" aria-hidden>
          {unit.initials ?? "—"}
        </span>
        <div>
          <p className="lg-body-medium text-foreground">{unit.person}</p>
          <p className="lg-caption text-muted-foreground">{unit.personLine}</p>
        </div>
      </div>
      <div className="border-t border-border" />
      {unit.leaseLine ? (
        <div>
          <p className="lg-label uppercase text-muted-foreground">Lease</p>
          <p className="mt-1 lg-body text-foreground">{unit.leaseLine}</p>
          {unit.leaseBadge ? <div className="mt-2"><ToneBadge chip={unit.leaseBadge} /></div> : null}
        </div>
      ) : null}
      <div>
        <p className="lg-label uppercase text-muted-foreground">{unit.rentLabel}</p>
        <p className="mt-1 lg-body text-foreground">{unit.rentLine}</p>
      </div>
      <div>
        <p className="lg-label uppercase text-muted-foreground">Open requests</p>
        <p className="mt-1 lg-body text-foreground">{unit.requestsLine}</p>
        {unit.requestBadge ? <div className="mt-2"><ToneBadge chip={unit.requestBadge} /></div> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" size="touch" onClick={onMessage}>
          Message Landlord Gopher
        </Button>
        <Button type="button" variant="secondary" size="touch" onClick={onDocuments}>
          Share document
        </Button>
      </div>
    </article>
  );
}

function RequestsPanel({
  model,
  onRequest,
  onMaintenance,
  onMessage,
}: {
  model: PropertyDetailModel;
  onRequest: (id: number) => void;
  onMaintenance: () => void;
  onMessage: () => void;
}) {
  return (
    <section className="space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="lg-section text-foreground">Open · {model.openRequests.length}</h2>
        <p className="lg-caption text-muted-foreground">Open first, then completed</p>
      </div>
      <RequestGroup rows={model.openRequests} empty="No open requests." onRequest={onRequest} />
      <h2 className="lg-section text-foreground">Completed · {model.completedRequests.length}</h2>
      <RequestGroup rows={model.completedRequests} empty="No completed requests." onRequest={onRequest} />
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="button" variant="secondary" size="touch" onClick={onMaintenance}>
          View all maintenance
        </Button>
        <Button type="button" variant="secondary" size="touch" onClick={onMessage}>
          Report an issue
        </Button>
      </div>
    </section>
  );
}

function RequestGroup({
  rows,
  empty,
  onRequest,
}: {
  rows: RequestRowModel[];
  empty: string;
  onRequest: (id: number) => void;
}) {
  if (rows.length === 0) {
    return <p className="rounded-sm border border-border bg-card p-5 lg-body text-muted-foreground">{empty}</p>;
  }
  return (
    <div className="overflow-hidden rounded-sm border border-border bg-card">
      {rows.map((row) => (
        <button
          key={row.id}
          type="button"
          className="flex w-full items-start gap-4 border-b border-border p-4 text-left last:border-b-0 hover:bg-muted/60"
          onClick={() => onRequest(row.id)}
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-sm bg-muted text-muted-foreground">
            {row.open ? <Wrench className="size-5" aria-hidden /> : <span className="lg-label">OK</span>}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block lg-body-medium text-foreground">{row.title}</span>
            <span className="mt-1 block lg-caption text-muted-foreground">{row.meta}</span>
            {row.next ? <span className="mt-1 block lg-caption text-muted-foreground">{row.next}</span> : null}
          </span>
          <ToneBadge chip={statusChip(row.status)} />
        </button>
      ))}
    </div>
  );
}

function RequestLine({ row, onOpen }: { row: RequestRowModel; onOpen: () => void }) {
  return (
    <button type="button" className="flex w-full items-start justify-between gap-3 text-left" onClick={onOpen}>
      <span className="min-w-0">
        <span className="block lg-body-medium text-foreground">{row.title}</span>
        <span className="block lg-caption text-muted-foreground">{[row.meta, row.next].filter(Boolean).join(" · ")}</span>
      </span>
      <ToneBadge chip={statusChip(row.status)} />
    </button>
  );
}

function MessagesPanel({
  model,
  onMessage,
  onRequest,
}: {
  model: PropertyDetailModel;
  onMessage: () => void;
  onRequest: (id: number) => void;
}) {
  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 rounded-sm border border-border bg-card p-5 sm:flex-row sm:items-center">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted lg-label text-muted-foreground" aria-hidden>
          LG
        </span>
        <div className="min-w-0 flex-1">
          <p className="lg-body-medium text-foreground">Questions about {model.title}?</p>
          <p className="lg-caption text-muted-foreground">Your Landlord Gopher conversation stays in Messages.</p>
        </div>
        <Button type="button" variant="secondary" size="touch" onClick={onMessage}>
          Message Landlord Gopher
        </Button>
      </div>
      <div className="flex items-center justify-between gap-3">
        <h2 className="lg-section text-foreground">Conversations · {model.title}</h2>
        <Button type="button" variant="secondary" size="touch" onClick={onMessage}>
          New message
        </Button>
      </div>
      {model.messages.length === 0 ? (
        <p className="rounded-sm border border-border bg-card p-5 lg-body text-muted-foreground">
          No request conversations for this property yet.
        </p>
      ) : (
        <div className="overflow-hidden rounded-sm border border-border bg-card">
          {model.messages.map((row) => (
            <MessageRow key={row.id} row={row} onOpen={() => (row.requestId != null ? onRequest(row.requestId) : onMessage())} />
          ))}
        </div>
      )}
      <p className="lg-caption text-muted-foreground">
        Request threads on this property are listed here. Direct tenant conversations are not connected yet.
      </p>
    </section>
  );
}

function MessageRow({ row, onOpen }: { row: MessageRowModel; onOpen: () => void }) {
  return (
    <button type="button" className="flex w-full items-start gap-4 border-b border-border p-4 text-left last:border-b-0 hover:bg-muted/60" onClick={onOpen}>
      <span className="flex size-10 shrink-0 items-center justify-center rounded-sm bg-muted text-muted-foreground">
        <Wrench className="size-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate lg-body-medium text-foreground">{row.title}</span>
        <span className="mt-1 block truncate lg-caption text-foreground">{row.preview}</span>
        <span className="mt-1 block lg-caption text-muted-foreground">{row.meta}</span>
      </span>
      <span className="shrink-0 text-right">
        {row.unread ? <span className="mb-1 block lg-caption text-brand-text">● unread</span> : null}
        <span className="lg-caption text-muted-foreground">{row.time}</span>
      </span>
    </button>
  );
}

function DocumentsPanel({
  propertyName,
  documents,
  units,
  downloadingId,
  onDownload,
  onMessage,
}: {
  propertyName: string;
  documents: PropertyDocument[];
  units: Unit[];
  downloadingId: number | null;
  onDownload: (doc: PropertyDocument) => void;
  onMessage: () => void;
}) {
  const occupants = useMemo(() => {
    const map = new Map<number, string>();
    for (const unit of units) {
      const name = unit.active_tenant_name?.trim();
      if (name) map.set(unit.id, name);
    }
    return map;
  }, [units]);
  const grouped = groupLandlordDocuments(documents, { occupantNameByUnitId: occupants });
  const groups = grouped[0]?.groups ?? [];
  const building = groups.find((group) => group.key === "building");
  const byUnit = new Map(groups.filter((group) => group.key.startsWith("unit:")).map((group) => [group.key, group]));
  const knownUnitKeys = new Set(units.map((unit) => `unit:${unit.id}`));
  const extraGroups = groups.filter((group) => group.key !== "building" && !knownUnitKeys.has(group.key));

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="lg-section text-foreground">Documents · {propertyName}</h2>
        <Button type="button" variant="secondary" size="touch" onClick={onMessage}>
          Share a document
        </Button>
      </div>
      <p className="lg-caption text-muted-foreground">
        Download files shared with you. Uploading stays with Landlord Gopher.
      </p>
      <DocumentGroup
        label={documentScopeGroupLabel({ unit_id: null })}
        docs={building?.documents ?? []}
        empty="No documents for the whole building yet."
        downloadingId={downloadingId}
        onDownload={onDownload}
        onMessage={onMessage}
      />
      {units.map((unit) => {
        const group = byUnit.get(`unit:${unit.id}`);
        const who = unit.active_tenant_name?.trim();
        return (
          <DocumentGroup
            key={unit.id}
            label={documentScopeGroupLabel({ unit_id: unit.id, unit_name: unit.name }, who)}
            docs={group?.documents ?? []}
            empty={`No documents for Unit ${unit.name} yet.`}
            hint={who ? `Ask Landlord Gopher to share a lease, notice, or addendum with ${who}.` : "Ask Landlord Gopher to share a lease, notice, or addendum."}
            downloadingId={downloadingId}
            onDownload={onDownload}
            onMessage={onMessage}
          />
        );
      })}
      {extraGroups.map((group) => (
        <DocumentGroup
          key={group.key}
          label={group.label}
          docs={group.documents}
          empty="No documents in this group yet."
          downloadingId={downloadingId}
          onDownload={onDownload}
          onMessage={onMessage}
        />
      ))}
    </section>
  );
}

function DocumentGroup({
  label,
  docs,
  empty,
  hint,
  downloadingId,
  onDownload,
  onMessage,
}: {
  label: string;
  docs: PropertyDocument[];
  empty: string;
  hint?: string;
  downloadingId: number | null;
  onDownload: (doc: PropertyDocument) => void;
  onMessage: () => void;
}) {
  return (
    <div className="space-y-3">
      <LandlordScopeHeading label={label} />
      {docs.length === 0 ? (
        <div className="rounded-sm border border-border bg-card p-5">
          <p className="lg-body text-foreground">{empty}</p>
          {hint ? <p className="mt-2 lg-caption text-muted-foreground">{hint}</p> : null}
          <Button type="button" variant="secondary" size="touch" className="mt-3" onClick={onMessage}>
            Share a document
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {docs.map((doc) => (
            <LandlordDocumentRow
              key={doc.id}
              model={landlordDocumentRowModel(doc)}
              showScope={false}
              downloading={downloadingId === doc.id}
              onDownload={() => onDownload(doc)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Unavailable({ onHome, onProperties }: { onHome: () => void; onProperties: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-sm border border-border bg-card px-6 py-12 text-center">
      <div className="flex size-14 items-center justify-center rounded-sm bg-muted text-muted-foreground">
        <Building2 className="size-6" aria-hidden />
      </div>
      <h2 className="lg-section text-foreground">{PROPERTY_UNAVAILABLE.title}</h2>
      <p className="max-w-xl lg-body text-muted-foreground">{PROPERTY_UNAVAILABLE.body}</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="button" variant="secondary" size="touch" onClick={onHome}>Go to Home</Button>
        <Button type="button" variant="secondary" size="touch" onClick={onProperties}>View properties</Button>
      </div>
    </div>
  );
}

function statusChip(status: RequestRowModel["status"]): FactChip {
  if (status === "Completed") return { label: status, tone: "success" };
  if (status === "On hold") return { label: status, tone: "neutral" };
  if (status === "In progress") return { label: status, tone: "brand" };
  if (status === "Assigned") return { label: status, tone: "info" };
  return { label: status, tone: "info" };
}
