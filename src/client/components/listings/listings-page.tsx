import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Globe } from "lucide-react";
import { useApp } from "@/context";
import { PageShell } from "@/components/page-shell";
import { ComingSoonPanel } from "@/components/stub-page";
import { ErrorRetry, SkeletonRow } from "@/components/patterns";
import {
  AdminButton,
  DashboardCard,
  navProps,
} from "@/components/dashboard/dashboard-primitives";
import * as data from "@/lib/data";
import { liveUnits, vacantUnlistedUnits } from "@/lib/listings-overview";
import { UNIT_READINESS_LABELS, type Lease, type Property, type Unit } from "@/types";

/**
 * Website listings (admin).
 *
 * Publishing, editing and taking down listings is not in the portal yet, so
 * the page says so — and shows, read-only, what the website carries today:
 * the homes that are live and the vacant ones that are not. Each row opens
 * the property. The lists use the same rules as the Dashboard's "Homes live
 * online" tile and its vacancy items (lib/listings-overview.ts).
 */

interface Overview {
  live: Unit[];
  vacantUnlisted: Unit[];
  propertyById: Map<number, Property>;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function unitWord(label: string): string {
  return /^unit\b/i.test(label.trim()) ? label.trim() : `Unit ${label.trim()}`;
}

function placeOf(unit: Unit, propertyById: Map<number, Property>): string {
  const property = propertyById.get(unit.property_id)?.name ?? unit.property_name ?? null;
  return [property, unitWord(unit.name)].filter(Boolean).join(" · ");
}

function liveDetail(unit: Unit): string {
  if (unit.status === "occupied") {
    return unit.active_tenant_name ? `Occupied · ${unit.active_tenant_name}` : "Occupied";
  }
  return `Vacant · ${UNIT_READINESS_LABELS[unit.readiness_status]}`;
}

function vacantDetail(unit: Unit): string {
  return unit.readiness_status === "ready"
    ? "Ready for move-in"
    : UNIT_READINESS_LABELS[unit.readiness_status];
}

export function ListingsPage({ navigate }: { navigate: (to: string) => void }) {
  const { properties, setError } = useApp();
  const [units, setUnits] = useState<Unit[] | null>(null);
  const [marketed, setMarketed] = useState<Set<number> | null>(null);
  const [leases, setLeases] = useState<Lease[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoadFailed(false);
        setUnits(null);
        const [unitRows, flags, leaseRows] = await Promise.all([
          data.listUnits(),
          data.listUnitMarketingFlags(),
          // Only used to leave out vacant homes that already have a lease signed.
          data.listLeases().catch(() => null),
        ]);
        if (cancelled) return;
        setUnits(unitRows);
        setMarketed(new Set(flags.filter((f) => f.marketed).map((f) => f.unit_id)));
        setLeases(leaseRows);
      } catch (err) {
        if (cancelled) return;
        setLoadFailed(true);
        setError((err as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setError, reloadKey]);

  const overview = useMemo<Overview | null>(() => {
    if (!units || !marketed) return null;
    const propertyById = new Map(properties.map((p) => [p.id, p]));
    return {
      live: liveUnits({ units, marketedUnitIds: marketed, propertyById }),
      vacantUnlisted: vacantUnlistedUnits({ units, marketedUnitIds: marketed, leases, propertyById }),
      propertyById,
    };
  }, [units, marketed, leases, properties]);

  const meta = overview
    ? [
        `${plural(overview.live.length, "home")} live on your website`,
        overview.vacantUnlisted.length > 0
          ? `${overview.vacantUnlisted.length} vacant and not listed`
          : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "Homes advertised on your website";

  return (
    <PageShell title="Website listings" meta={meta}>
      <ComingSoonPanel
        icon={Globe}
        title="Publishing listings from the portal is coming soon"
        description="You’ll be able to put vacant homes on your website, edit what each listing shows and take it down once the home is let. Until then, this page shows what your website carries today."
      >
        <AdminButton asChild>
          <a {...navProps("/properties", navigate)}>Open properties</a>
        </AdminButton>
      </ComingSoonPanel>

      {loadFailed ? (
        <ErrorRetry
          message="Website listings could not load. Please try again."
          onRetry={() => setReloadKey((key) => key + 1)}
        />
      ) : !overview ? (
        <div className="space-y-2.5" aria-busy="true" aria-live="polite">
          <p className="lg-body text-muted-foreground">Loading website listings…</p>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </div>
      ) : (
        <div className="grid min-w-0 gap-6 lg:grid-cols-2 lg:items-start">
          <DashboardCard
            title="Live on your website"
            summary={
              overview.live.length > 0
                ? `${plural(overview.live.length, "home")} advertised right now`
                : undefined
            }
          >
            {overview.live.length === 0 ? (
              <p className="lg-body text-muted-foreground">No homes are on your website right now.</p>
            ) : (
              <UnitRows
                units={overview.live}
                detail={liveDetail}
                propertyById={overview.propertyById}
                navigate={navigate}
              />
            )}
          </DashboardCard>

          <DashboardCard
            title="Vacant, not on your website"
            summary={
              overview.vacantUnlisted.length > 0
                ? `${plural(overview.vacantUnlisted.length, "home")} with no lease signed`
                : undefined
            }
          >
            {overview.vacantUnlisted.length === 0 ? (
              <p className="lg-body text-muted-foreground">
                Every vacant home is either on your website or has a lease signed.
              </p>
            ) : (
              <UnitRows
                units={overview.vacantUnlisted}
                detail={vacantDetail}
                propertyById={overview.propertyById}
                navigate={navigate}
              />
            )}
          </DashboardCard>
        </div>
      )}
    </PageShell>
  );
}

function UnitRows({
  units,
  detail,
  propertyById,
  navigate,
}: {
  units: Unit[];
  detail: (unit: Unit) => string;
  propertyById: Map<number, Property>;
  navigate: (to: string) => void;
}) {
  return (
    <ul className="-mx-2 flex flex-col divide-y divide-border">
      {units.map((unit) => (
        <li key={unit.id}>
          <a
            {...navProps(`/properties/${unit.property_id}`, navigate)}
            className="flex min-h-14 items-center gap-3 rounded-sm px-2 py-2 outline-none transition-colors duration-150 hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/40"
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="lg-body-medium break-words text-foreground">
                {placeOf(unit, propertyById)}
              </span>
              <span className="lg-caption break-words text-muted-foreground">{detail(unit)}</span>
            </span>
            <ChevronRight
              aria-hidden
              size={20}
              strokeWidth={2}
              absoluteStrokeWidth
              className="shrink-0 text-muted-foreground"
            />
          </a>
        </li>
      ))}
    </ul>
  );
}
