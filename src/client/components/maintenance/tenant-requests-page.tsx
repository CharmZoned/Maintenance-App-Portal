import { useEffect, useMemo, useRef, useState } from "react";
import { Wrench } from "lucide-react";
import { useApp } from "@/context";
import {
  createSingleFlightLoader,
  type DeepLinkProps,
} from "@/lib/deep-link";
import { useDeepLinkOpen } from "@/hooks/use-deep-link-open";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/page-shell";
import {
  EmptyState,
  ErrorRetry,
  SkeletonRow,
  StatusChip,
} from "@/components/patterns";
import { cn } from "@/lib/utils";
import {
  formatActivityStamp,
  requestNextStep,
  toRequestStatus,
  unitPropertyLabel,
} from "@/lib/request-status";
import type { TenantHomeContext, WorkOrder } from "@/types";
import { TenantSubmitDialog } from "./tenant-submit-dialog";
import { TenantRequestDetailPanel } from "./tenant-request-detail-panel";

type TenantFilter = "open" | "completed";

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex min-h-11 items-center rounded-sm px-3 py-1.5 text-xs sm:min-h-7 sm:py-1",
        active
          ? "bg-brand-tint font-medium text-brand-text"
          : "bg-muted text-muted-foreground hover:bg-muted/80",
      )}
    >
      {label}
    </button>
  );
}

/**
 * Tenant Requests — list + inline detail (Figma M/T/D).
 * Routes stay `/maintenance` (+ optional `?wo=` selection).
 */
export function TenantRequestsPage({
  search = "",
  replace,
  navigate,
}: DeepLinkProps & { navigate?: (to: string) => void } = {}) {
  const app = useApp();
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [filter, setFilter] = useState<TenantFilter>("open");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [home, setHome] = useState<TenantHomeContext | null>(null);
  /** Prefer this id after submit until it appears in the loaded list. */
  const pendingSelectIdRef = useRef<number | null>(null);
  /** Skip the dialog-close reload when onSaved already refreshed. */
  const skipCloseReloadRef = useRef(false);
  /** True after at least one successful list fetch — failed refreshes keep rows. */
  const hasLoadedOnceRef = useRef(false);
  const ordersRef = useRef(orders);
  ordersRef.current = orders;

  const listWorkOrders = app.listWorkOrders;
  const setError = app.setError;
  const flight = useMemo(
    () => createSingleFlightLoader(() => listWorkOrders()),
    [listWorkOrders],
  );

  /**
   * Fetch the queue. Initial failure clears the list + shows ErrorRetry.
   * Background refresh failure keeps current rows (banner via setError only).
   */
  async function load(): Promise<WorkOrder[]> {
    const isInitial = !hasLoadedOnceRef.current;
    if (isInitial) setLoading(true);
    try {
      const list = await flight.load();
      setListError(null);
      setError(null);
      setOrders(list);
      hasLoadedOnceRef.current = true;
      return list;
    } catch (err) {
      const message = (err as Error).message;
      setError(message);
      if (!hasLoadedOnceRef.current) {
        setListError(message);
        setOrders([]);
        return [] as WorkOrder[];
      }
      // Keep on-screen rows; do not set listError (that swaps in ErrorRetry).
      return ordersRef.current;
    } finally {
      if (isInitial) setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const list = await flight.load();
        if (cancelled) return;
        setListError(null);
        setError(null);
        setOrders(list);
        hasLoadedOnceRef.current = true;
      } catch (err) {
        if (cancelled) return;
        const message = (err as Error).message;
        setError(message);
        if (!hasLoadedOnceRef.current) {
          setListError(message);
          setOrders([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [flight, setError]);

  const getTenantHomeContext = app.getTenantHomeContext;
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ctx = await getTenantHomeContext();
        if (!cancelled) setHome(ctx);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getTenantHomeContext]);

  useDeepLinkOpen({
    search,
    param: "wo",
    items: orders,
    loadList: () => flight.load(),
    onList: setOrders,
    onFound: (found) => {
      setSelectedId(found.id);
      setFilter(found.status === "closed" ? "completed" : "open");
      replace?.("/maintenance");
    },
    onMiss: () => replace?.("/maintenance"),
  });

  const openCount = useMemo(
    () => orders.filter((o) => o.status !== "closed").length,
    [orders],
  );
  const completedCount = useMemo(
    () => orders.filter((o) => o.status === "closed").length,
    [orders],
  );

  const filtered = useMemo(() => {
    return filter === "completed"
      ? orders.filter((o) => o.status === "closed")
      : orders.filter((o) => o.status !== "closed");
  }, [orders, filter]);

  useEffect(() => {
    if (filtered.length === 0) {
      // Keep a pending post-submit id; don't clear until the list catches up.
      if (pendingSelectIdRef.current != null) return;
      setSelectedId(null);
      return;
    }
    const pending = pendingSelectIdRef.current;
    if (pending != null && filtered.some((o) => o.id === pending)) {
      pendingSelectIdRef.current = null;
      if (selectedId !== pending) setSelectedId(pending);
      return;
    }
    if (selectedId != null && filtered.some((o) => o.id === selectedId)) return;
    // Don't fall back to filtered[0] while waiting for the submitted request.
    if (pending != null) return;
    setSelectedId(filtered[0]!.id);
  }, [filtered, selectedId]);

  const selected = filtered.find((o) => o.id === selectedId) ?? null;
  const noUnit = home != null && home.unit_id == null;
  const placeLabel = unitPropertyLabel(home?.unit_label, home?.property_name);
  const go = navigate ?? (() => undefined);

  function selectRequest(w: WorkOrder) {
    setSelectedId(w.id);
  }

  function openFullDetail(w: WorkOrder) {
    go(`/maintenance/${w.id}`);
  }

  return (
    <PageShell title="Requests" meta="Care for your home" width="max-w-7xl">
      <div className="space-y-6">
        <header className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Care for your home
          </p>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <h2 className="text-[2.125rem] font-semibold leading-[2.625rem] tracking-[-0.01em] text-foreground">
                Requests
              </h2>
              <p className="mt-1 text-sm text-muted-foreground md:hidden">
                Track the repairs you submitted for your unit.
              </p>
              <p className="mt-1 hidden text-sm text-muted-foreground md:block">
                Track repairs and stay in touch with the people helping.
              </p>
            </div>
            {/* Desktop: CTA beside display title (Figma 1440). */}
            <Button
              variant="brand"
              className="hidden h-11 min-h-11 w-[236px] shrink-0 text-sm lg:inline-flex"
              onClick={() => setSubmitOpen(true)}
              disabled={noUnit}
              title={noUnit ? "Ask staff to assign a unit first" : undefined}
            >
              New maintenance request
            </Button>
          </div>
          {/* Mobile + tablet: full-width primary (≥44px). */}
          <Button
            variant="brand"
            className="h-11 min-h-11 w-full text-sm lg:hidden"
            onClick={() => setSubmitOpen(true)}
            disabled={noUnit}
            title={noUnit ? "Ask staff to assign a unit first" : undefined}
          >
            New maintenance request
          </Button>
        </header>

        {noUnit ? (
          <p className="rounded-sm border border-warning bg-warning-tint px-3 py-2 text-sm text-warning">
            Your account isn’t linked to a unit yet. Ask staff to assign a unit before
            submitting requests.
          </p>
        ) : null}

        {loading ? (
          <div className="grid gap-6 lg:grid-cols-2" aria-busy="true">
            <div className="space-y-3 rounded-lg border border-border bg-card p-5">
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
            </div>
            <div className="hidden space-y-3 rounded-lg border border-border bg-card p-5 lg:block">
              <SkeletonRow />
              <SkeletonRow />
            </div>
          </div>
        ) : listError ? (
          <ErrorRetry message={listError} onRetry={() => void load()} />
        ) : (
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
            <section className="rounded-lg border border-border bg-card p-5 sm:p-6">
              <h3 className="text-lg font-semibold leading-[1.625rem] text-foreground">
                Your requests
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Requests you submitted for your unit.
              </p>

              <div className="mt-4 flex flex-wrap gap-2">
                <FilterChip
                  label={`Open · ${openCount}`}
                  active={filter === "open"}
                  onClick={() => setFilter("open")}
                />
                <FilterChip
                  label={
                    completedCount > 0 ? `Completed · ${completedCount}` : "Completed"
                  }
                  active={filter === "completed"}
                  onClick={() => setFilter("completed")}
                />
              </div>

              {filtered.length === 0 ? (
                <div className="mt-4">
                  <EmptyState
                    icon={<Wrench className="size-5" aria-hidden />}
                    message={
                      orders.length === 0
                        ? "Submit a request when something needs fixing in your unit."
                        : filter === "completed"
                          ? "No completed requests yet."
                          : "No open requests right now."
                    }
                    actionLabel={
                      orders.length === 0 && !noUnit
                        ? "New maintenance request"
                        : undefined
                    }
                    onAction={
                      orders.length === 0 && !noUnit
                        ? () => setSubmitOpen(true)
                        : undefined
                    }
                  />
                </div>
              ) : (
                <ul className="mt-4 space-y-3">
                  {filtered.map((w) => {
                    const status = toRequestStatus(w);
                    const selectedRow = w.id === selectedId;
                    const reporter =
                      [w.tenant_first_name, w.tenant_last_name]
                        .filter(Boolean)
                        .join(" ") || "You";
                    const when = formatActivityStamp(w.created_at);
                    const next = requestNextStep(w);
                    return (
                      <li key={w.id}>
                        <button
                          type="button"
                          onClick={() => selectRequest(w)}
                          onDoubleClick={() => openFullDetail(w)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                              e.preventDefault();
                              openFullDetail(w);
                            }
                          }}
                          aria-current={selectedRow ? "true" : undefined}
                          className={cn(
                            "flex w-full min-h-11 flex-col gap-2 rounded-lg border px-4 py-4 text-left transition-colors",
                            selectedRow
                              ? "border-transparent bg-brand-tint"
                              : "border-border bg-card hover:bg-muted/40",
                          )}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <p className="text-lg font-semibold leading-[1.625rem] text-foreground">
                              {w.title}
                            </p>
                            <StatusChip status={status} />
                          </div>
                          <p className="text-sm text-muted-foreground">
                            Reported by {reporter} · {when}
                          </p>
                          <p
                            className={cn(
                              "text-xs",
                              selectedRow
                                ? "text-brand-text"
                                : "text-muted-foreground",
                            )}
                          >
                            {selectedRow
                              ? next === "Needs assignment"
                                ? "Waiting for assignment"
                                : next || "Selected"
                              : "Select a request to see details and updates."}
                          </p>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}

              <p className="mt-6 text-sm text-muted-foreground">
                Only requests you submitted appear here.
                {placeLabel && placeLabel !== "Your home" ? (
                  <span className="sr-only"> ({placeLabel})</span>
                ) : null}
              </p>
              {selected ? (
                <button
                  type="button"
                  className="mt-3 min-h-11 text-sm font-medium text-brand-text hover:underline"
                  onClick={() => openFullDetail(selected)}
                >
                  Open full request
                </button>
              ) : null}
            </section>

            <section className="min-h-[20rem]">
              {selected ? (
                <TenantRequestDetailPanel
                  key={selected.id}
                  order={selected}
                  navigate={go}
                  compact
                  onOpenFullDetail={() => openFullDetail(selected)}
                />
              ) : (
                <div className="flex h-full min-h-[16rem] items-center justify-center rounded-lg border border-border bg-card p-6">
                  <p className="text-sm text-muted-foreground">
                    Select a request to see details and updates.
                  </p>
                </div>
              )}
            </section>
          </div>
        )}

        <aside
          className="rounded-sm bg-warning-tint px-5 py-4 text-sm text-warning"
          role="note"
        >
          <p className="font-medium md:font-normal">
            <span className="md:hidden">Immediate danger?</span>
            <span className="hidden md:inline">
              Immediate danger? Contact local emergency services. Do not wait for a
              portal response.
            </span>
          </p>
          <p className="mt-1 md:hidden">
            Contact local emergency services. Do not wait for a portal response.
          </p>
        </aside>
      </div>

      <TenantSubmitDialog
        open={submitOpen}
        onOpenChange={(o) => {
          setSubmitOpen(o);
          if (!o) {
            if (skipCloseReloadRef.current) {
              skipCloseReloadRef.current = false;
              return;
            }
            void load();
          }
        }}
        onSaved={async (created) => {
          skipCloseReloadRef.current = true;
          pendingSelectIdRef.current = created.id;
          setFilter("open");
          setSelectedId(created.id);
          // Optimistic insert so list + detail show the new request immediately.
          setOrders((prev) =>
            prev.some((o) => o.id === created.id) ? prev : [created, ...prev],
          );
          const list = await load();
          if (!list.some((o) => o.id === created.id)) {
            setOrders((prev) =>
              prev.some((o) => o.id === created.id) ? prev : [created, ...prev],
            );
          }
          setSelectedId(created.id);
        }}
      />
    </PageShell>
  );
}
