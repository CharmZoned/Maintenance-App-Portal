import { useEffect, useMemo, useState } from "react";
import { Building2, Wrench } from "lucide-react";
import { useApp } from "@/context";
import { PageShell } from "@/components/page-shell";
import {
  EmptyState,
  ErrorRetry,
  ListRow,
  SkeletonRow,
  StatusChip,
} from "@/components/patterns";
import {
  compareCreatedDesc,
  formatActivityStamp,
  isOpenRequest,
  requestContextLine,
  requestNextStep,
  toRequestStatus,
} from "@/lib/request-status";
import { cn } from "@/lib/utils";
import type { Property, WorkOrder } from "@/types";

/**
 * Landlord N2 Home — property cards, recent maintenance, stub messages
 * (Figma 04 Homes). Portfolio remains mutate-gated elsewhere.
 */
export function LandlordHomePage({ navigate }: { navigate: (to: string) => void }) {
  const {
    properties,
    listWorkOrders,
    setError,
    loading: portfolioLoading,
    error: portfolioError,
  } = useApp();
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setOrdersLoading(true);
      setOrdersError(null);
      try {
        const list = await listWorkOrders({
          open_only: true,
          skip_staff_notes: true,
        });
        if (!cancelled) setOrders(list);
      } catch (err) {
        if (!cancelled) {
          const message = (err as Error).message;
          setOrdersError(message);
          setError(message);
        }
      } finally {
        if (!cancelled) setOrdersLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [listWorkOrders, setError, reloadKey]);

  const openByProperty = useMemo(() => {
    const map = new Map<number, number>();
    for (const wo of orders) {
      if (!isOpenRequest(wo) || wo.property_id == null) continue;
      map.set(wo.property_id, (map.get(wo.property_id) ?? 0) + 1);
    }
    return map;
  }, [orders]);

  const lastActivityByProperty = useMemo(() => {
    const map = new Map<number, string>();
    for (const wo of orders) {
      if (wo.property_id == null || !wo.created_at) continue;
      const prev = map.get(wo.property_id);
      if (!prev || wo.created_at > prev) map.set(wo.property_id, wo.created_at);
    }
    return map;
  }, [orders]);

  const recentOpen = useMemo(
    () =>
      orders
        .filter(isOpenRequest)
        .slice()
        .sort(compareCreatedDesc)
        .slice(0, 5),
    [orders],
  );

  const bootstrapping = portfolioLoading;
  const meta = bootstrapping
    ? "Loading portfolio…"
    : properties.length === 0
      ? "No properties"
      : `${properties.length} ${properties.length === 1 ? "property" : "properties"}`;

  return (
    <PageShell title="Home" meta={meta} width="max-w-3xl">
      {bootstrapping ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading home">
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </div>
      ) : portfolioError && properties.length === 0 ? (
        <ErrorRetry
          message={portfolioError}
          onRetry={() => {
            window.location.reload();
          }}
        />
      ) : properties.length === 0 ? (
        <EmptyState
          message="Properties linked to your landlord account will appear here."
          icon={<Building2 className="size-5" aria-hidden />}
        />
      ) : (
        <div className="space-y-6">
          <section className="space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Your properties
            </h2>
            <div className="space-y-3">
              {properties.map((p) => (
                <PropertyCard
                  key={p.id}
                  property={p}
                  openCount={openByProperty.get(p.id) ?? 0}
                  lastActivity={lastActivityByProperty.get(p.id)}
                  onClick={() => navigate(`/properties/${p.id}`)}
                />
              ))}
            </div>
          </section>

          <section className="space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Recent maintenance
            </h2>
            {ordersLoading ? (
              <div className="space-y-2" aria-busy="true" aria-label="Loading maintenance">
                <SkeletonRow />
                <SkeletonRow />
              </div>
            ) : ordersError ? (
              <ErrorRetry
                message={ordersError}
                onRetry={() => setReloadKey((k) => k + 1)}
              />
            ) : recentOpen.length === 0 ? (
              <EmptyState
                message="No open maintenance across your portfolio."
                icon={<Wrench className="size-5" aria-hidden />}
                actionLabel="Open maintenance"
                onAction={() => navigate("/maintenance")}
              />
            ) : (
              <div className="overflow-hidden rounded-md border border-border">
                {recentOpen.map((wo) => {
                  const unitBit = wo.unit_name ? ` · Unit ${wo.unit_name}` : "";
                  return (
                    <ListRow
                      key={wo.id}
                      title={`${wo.title}${unitBit}`}
                      context={requestContextLine(wo, {
                        includeProperty: true,
                        titleIncludesUnit: Boolean(wo.unit_name),
                      })}
                      status={
                        <StatusChip
                          status={toRequestStatus(wo)}
                          nextStep={requestNextStep(wo)}
                        />
                      }
                      onClick={() => navigate(`/maintenance?wo=${wo.id}`)}
                    />
                  );
                })}
              </div>
            )}
          </section>

          <section className="space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Messages
            </h2>
            {/* Messaging UI ships in Messages/People group. */}
            <button
              type="button"
              onClick={() => navigate("/messages")}
              className="flex w-full items-center gap-2.5 rounded-md border border-border bg-card p-3 text-left transition-colors hover:bg-muted/60"
            >
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-foreground">Messages</p>
                <p className="text-xs text-muted-foreground">
                  No new messages. Messages will show up here.
                </p>
              </div>
            </button>
          </section>
        </div>
      )}
    </PageShell>
  );
}

function PropertyCard({
  property,
  openCount,
  lastActivity,
  onClick,
}: {
  property: Property;
  openCount: number;
  lastActivity?: string;
  onClick: () => void;
}) {
  const units = property.unit_count ?? 0;
  const occupied = property.occupied_count ?? 0;
  const vacant = Math.max(0, units - occupied);
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full flex-col gap-2 rounded-md border border-border bg-card p-3 text-left transition-colors hover:bg-muted/60"
    >
      <p className="text-[15px] font-semibold leading-5 text-foreground">{property.name}</p>
      <div className="flex flex-wrap gap-2">
        <MetaChip>{units} {units === 1 ? "unit" : "units"}</MetaChip>
        <MetaChip>
          {occupied} occupied{vacant > 0 ? ` · ${vacant} vacant` : ""}
        </MetaChip>
        <MetaChip tone={openCount > 0 ? "info" : "muted"}>
          {openCount} open
        </MetaChip>
      </div>
      {lastActivity ? (
        <p className="text-xs text-muted-foreground">
          Last activity {formatActivityStamp(lastActivity)}
        </p>
      ) : null}
    </button>
  );
}

function MetaChip({
  children,
  tone = "muted",
}: {
  children: React.ReactNode;
  tone?: "muted" | "info";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm px-2 py-1 text-[11px] font-medium",
        tone === "info" ? "bg-info-tint text-info" : "bg-muted text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}
