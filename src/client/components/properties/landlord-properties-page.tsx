import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Building2, Search } from "lucide-react";
import { useApp } from "@/context";
import { LandlordPageIntro } from "@/components/landlord";
import { PageShell } from "@/components/page-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  PROPERTIES_EMPTY,
  PROPERTIES_ERROR,
  PROPERTIES_READ_ONLY_NOTE,
  RENT_FILTERS,
  buildPortfolioCards,
  filterPropertyCards,
  portfolioDescription,
  showingPropertiesLabel,
  type FactChip,
  type PropertyCardModel,
  type RentFilter,
} from "@/lib/landlord-properties";
import { cn, currentPeriod } from "@/lib/utils";
import type { PropertyDocument, RentCharge, Unit, WorkOrder } from "@/types";

export function LandlordPropertiesPage({ navigate }: { navigate: (to: string) => void }) {
  const {
    properties,
    loading,
    error,
    refreshLookups,
    listUnits,
    listCharges,
    listWorkOrders,
    listPropertyDocuments,
    settings,
    setError,
  } = useApp();
  const [units, setUnits] = useState<Unit[]>([]);
  const [charges, setCharges] = useState<RentCharge[]>([]);
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [documents, setDocuments] = useState<PropertyDocument[]>([]);
  const [detailLoading, setDetailLoading] = useState(true);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [query, setQuery] = useState("");
  const [rent, setRent] = useState<RentFilter>("all");

  useEffect(() => {
    if (loading) return;
    let cancelled = false;
    (async () => {
      setDetailLoading(true);
      setDetailError(null);
      try {
        const [nextUnits, nextCharges, nextOrders, nextDocs] = await Promise.all([
          listUnits(),
          listCharges(currentPeriod()),
          listWorkOrders({ skip_staff_notes: true }),
          listPropertyDocuments(),
        ]);
        if (cancelled) return;
        setUnits(nextUnits);
        setCharges(nextCharges);
        setOrders(nextOrders);
        setDocuments(nextDocs);
      } catch (err) {
        if (!cancelled) setDetailError((err as Error).message);
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loading, listUnits, listCharges, listWorkOrders, listPropertyDocuments, reloadKey]);

  const cards = useMemo(
    () =>
      buildPortfolioCards({
        properties,
        units,
        charges,
        workOrders: orders,
        documents,
        currency: settings.currency,
        unitsLoaded: !detailLoading && !detailError,
      }),
    [properties, units, charges, orders, documents, settings.currency, detailLoading, detailError],
  );
  const visible = useMemo(() => filterPropertyCards(cards, { query, rent }), [cards, query, rent]);
  const unitCount = properties.reduce((sum, property) => sum + (property.unit_count ?? 0), 0);
  const occupied = properties.reduce((sum, property) => sum + (property.occupied_count ?? 0), 0);
  const detailsReady = !detailLoading && !detailError;
  const description = portfolioDescription({
    properties: properties.length,
    units: detailsReady ? units.length : unitCount,
    occupied: detailsReady
      ? units.filter((unit) => unit.status === "occupied").length
      : occupied,
  });

  function messageGopher() {
    navigate("/messages");
  }

  async function retry() {
    setError(null);
    try {
      await refreshLookups();
    } catch (err) {
      setError((err as Error).message);
    }
    setReloadKey((key) => key + 1);
  }

  const failed = !loading && Boolean(error) && properties.length === 0;

  return (
    <PageShell title="Properties" width="max-w-6xl">
      <LandlordPageIntro
        eyebrow="Your portfolio"
        title="Properties"
        description={
          loading || failed ? undefined : properties.length === 0 ? "0 properties" : detailLoading ? undefined : description
        }
      />

      {loading || (detailLoading && properties.length > 0 && !error) ? (
        <PropertiesSkeleton />
      ) : failed ? (
        <StatusBanner
          title={PROPERTIES_ERROR.title}
          body={PROPERTIES_ERROR.body}
          actions={
            <>
              <Button type="button" variant="secondary" size="touch" onClick={() => void retry()}>
                Try again
              </Button>
              <Button type="button" variant="secondary" size="touch" onClick={messageGopher}>
                Message Landlord Gopher
              </Button>
            </>
          }
        />
      ) : properties.length === 0 ? (
        <EmptyProperties onMessage={messageGopher} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative w-full md:max-w-[360px] md:flex-1">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search properties or addresses"
                aria-label="Search properties or addresses"
                className="h-11 pl-11"
              />
            </div>
            <Select value={rent} onValueChange={(value) => setRent(value as RentFilter)}>
              <SelectTrigger aria-label="Rent status" className="h-11 w-full md:w-[220px] lg:w-[344px]">
                <SelectValue placeholder="Rent status: All" />
              </SelectTrigger>
              <SelectContent>
                {RENT_FILTERS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="w-full lg-caption text-muted-foreground lg:ml-auto lg:w-auto">
              {showingPropertiesLabel(visible.length, cards.length)}
            </p>
          </div>

          {detailError ? (
            <p className="lg-caption text-muted-foreground" role="status">
              Rent and request details didn't load. Property names are still listed.{" "}
              <button type="button" className="underline" onClick={() => setReloadKey((key) => key + 1)}>
                Try again
              </button>
            </p>
          ) : null}

          {visible.length === 0 ? (
            <div className="rounded-sm border border-border bg-card px-6 py-10 text-center">
              <p className="lg-body-medium text-foreground">No properties match.</p>
              <Button
                type="button"
                variant="secondary"
                size="touch"
                className="mt-4"
                onClick={() => {
                  setQuery("");
                  setRent("all");
                }}
              >
                Clear filters
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              {visible.map((card) => (
                <PropertyCard key={card.id} card={card} onOpen={() => navigate(`/properties/${card.id}`)} />
              ))}
            </div>
          )}

          <div className="flex flex-col gap-3 rounded-sm bg-muted p-5 md:flex-row md:items-center">
            <div className="min-w-0 flex-1">
              <p className="lg-body-medium text-foreground">{PROPERTIES_READ_ONLY_NOTE.title}</p>
              <p className="mt-1 lg-body text-muted-foreground">{PROPERTIES_READ_ONLY_NOTE.body}</p>
            </div>
            <Button type="button" variant="secondary" size="touch" className="w-full md:w-auto" onClick={messageGopher}>
              {PROPERTIES_READ_ONLY_NOTE.action}
            </Button>
          </div>
        </>
      )}
    </PageShell>
  );
}

export function PropertyCard({ card, onOpen }: { card: PropertyCardModel; onOpen: () => void }) {
  return (
    <article className="flex flex-col overflow-hidden rounded-md border border-border bg-card">
      <div className="flex h-[140px] flex-col items-center justify-center gap-2 bg-muted text-muted-foreground">
        <Building2 className="size-7" aria-hidden />
        <p className="lg-caption">Property photo</p>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-5">
        <div className="flex items-start justify-between gap-3">
          <h2 className="lg-section text-foreground">{card.name}</h2>
          {card.unreadLabel ? (
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-tint px-2.5 py-1 lg-caption text-brand-text">
              <span className="size-2 rounded-full bg-brand" aria-hidden />
              {card.unreadLabel}
            </span>
          ) : null}
        </div>
        <p className="lg-body text-muted-foreground">{card.address}</p>
        <div className="flex flex-wrap gap-2">
          {card.chips.map((chip) => (
            <ToneBadge key={chip.label} chip={chip} />
          ))}
        </div>
        <dl className="flex flex-col gap-2">
          {card.facts.map((fact) => (
            <div key={fact.label} className="flex items-start justify-between gap-4">
              <dt className="shrink-0 lg-body text-muted-foreground">{fact.label}</dt>
              <dd className="text-right lg-body-medium text-foreground">{fact.value}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-auto flex items-center justify-between gap-3 border-t border-border pt-3">
          <p className="lg-caption text-muted-foreground">{card.footer}</p>
          <Button type="button" variant="secondary" size="touch" onClick={onOpen}>
            View property ›
          </Button>
        </div>
      </div>
    </article>
  );
}

function ToneBadge({ chip }: { chip: FactChip }) {
  return <Badge variant={chip.tone}>{chip.label}</Badge>;
}

function EmptyProperties({ onMessage }: { onMessage: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-sm border border-border bg-card px-6 py-12 text-center">
      <div className="flex size-14 items-center justify-center rounded-sm bg-muted text-muted-foreground">
        <Building2 className="size-6" aria-hidden />
      </div>
      <h2 className="lg-section text-foreground">{PROPERTIES_EMPTY.title}</h2>
      <p className="max-w-xl lg-body text-muted-foreground">{PROPERTIES_EMPTY.body}</p>
      <Button type="button" variant="secondary" size="touch" onClick={onMessage}>
        {PROPERTIES_EMPTY.action}
      </Button>
    </div>
  );
}

export function StatusBanner({
  title,
  body,
  actions,
}: {
  title: string;
  body: string;
  actions: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-sm border border-border bg-card p-5 md:flex-row md:items-center" role="alert">
      <div className="min-w-0 flex-1">
        <p className="lg-body-medium text-foreground">{title}</p>
        <p className="mt-1 lg-body text-muted-foreground">{body}</p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">{actions}</div>
    </div>
  );
}

function PropertiesSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2" aria-busy="true" aria-label="Loading properties">
      <div className="h-[368px] animate-pulse rounded-md bg-muted" />
      <div className="h-[368px] animate-pulse rounded-md bg-muted" />
    </div>
  );
}

export function sectionCardClass(className?: string) {
  return cn("flex flex-col gap-3 rounded-sm border border-border bg-card p-6", className);
}
