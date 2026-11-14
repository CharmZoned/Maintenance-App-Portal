import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@/context";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/page-shell";
import {
  EmptyState,
  ErrorRetry,
  ListRow,
  PriorityChip,
  SkeletonRow,
  StatusChip,
} from "@/components/patterns";
import * as data from "@/lib/data";
import { toCalendarDay } from "@/lib/calendar-events";
import {
  formatActivityStamp,
  isOpenRequest,
  priorityLevel,
  requestContextLine,
  requestNextStep,
  toRequestStatus,
} from "@/lib/request-status";
import { cn, toIsoDate } from "@/lib/utils";
import type { DashboardSummary, Property, WorkOrder, WorkOrderPriority } from "@/types";
import { WorkOrderDialog } from "@/components/maintenance/work-order-dialog";

/**
 * Admin U5 Dashboard (Figma 04 Homes) — needs-attention counters, open requests,
 * upcoming (calendar visits live here), recent activity stub, portfolio strip.
 * No rent / lease KPI tiles per Figma Q1 note.
 */

function priorityRank(priority: WorkOrderPriority): number {
  if (priority === "urgent") return 0;
  if (priority === "high") return 1;
  return 2;
}

/** Emergency/high first, then oldest created_at. Equal timestamps → 0. */
function compareOpenForDashboard(a: WorkOrder, b: WorkOrder): number {
  const pr = priorityRank(a.priority) - priorityRank(b.priority);
  if (pr !== 0) return pr;
  if (a.created_at === b.created_at) return 0;
  return a.created_at < b.created_at ? -1 : 1;
}

/** Newest created_at first for Recent activity. Equal timestamps → 0. */
function compareCreatedDesc(a: WorkOrder, b: WorkOrder): number {
  if (a.created_at === b.created_at) return 0;
  return a.created_at < b.created_at ? 1 : -1;
}

function addLocalDays(isoDay: string, days: number): string {
  const [y, m, d] = isoDay.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return toIsoDate(dt);
}

export function DashboardPage({ navigate }: { navigate: (to: string) => void }) {
  const app = useApp();
  const { getDashboardSummary, listWorkOrders, properties, setError, isAdmin } = app;
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  /** null = never loaded / failed (show —); keep last good count on refresh failure. */
  const [pendingApprovals, setPendingApprovals] = useState<number | null>(null);
  const [pendingFailed, setPendingFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const hasLoadedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const background = hasLoadedRef.current;
      if (background) setRefreshing(true);
      else setLoading(true);
      setLoadError(null);
      try {
        const [dash, woList] = await Promise.all([
          getDashboardSummary(),
          listWorkOrders(),
        ]);
        if (cancelled) return;
        setSummary(dash);
        setOrders(woList);
        hasLoadedRef.current = true;

        if (isAdmin) {
          try {
            // Prefer listing accounts (RPC) over a direct user_roles count — RLS only
            // exposes own row to authenticated; admin queue is via RPC.
            const accounts = await data.listUserAccounts();
            if (!cancelled) {
              setPendingApprovals(
                accounts.filter((a) => a.account_status === "pending").length,
              );
              setPendingFailed(false);
            }
          } catch {
            // Do not coerce to 0 — keep previous count and flag the tile.
            if (!cancelled) setPendingFailed(true);
          }
        } else if (!cancelled) {
          setPendingApprovals(0);
          setPendingFailed(false);
        }
      } catch (err) {
        if (!cancelled) {
          const message = (err as Error).message;
          if (hasLoadedRef.current) {
            // Keep mounted dashboard; surface via app banner.
            setError(message);
          } else {
            setLoadError(message);
            setError(message);
          }
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getDashboardSummary, listWorkOrders, setError, isAdmin, reloadKey]);

  const openOrders = useMemo(
    () =>
      orders
        .filter(isOpenRequest)
        .slice()
        .sort(compareOpenForDashboard)
        .slice(0, 6),
    [orders],
  );

  const recentActivity = useMemo(
    () =>
      orders
        .filter(isOpenRequest)
        .slice()
        .sort(compareCreatedDesc)
        .slice(0, 5),
    [orders],
  );

  const newToAssign = useMemo(
    () =>
      orders.filter(
        (o) => isOpenRequest(o) && !o.assigned_staff_id && o.status === "open",
      ).length,
    [orders],
  );

  const emergenciesOpen = summary?.urgent_work_orders ?? 0;

  const upcoming = useMemo(() => {
    const today = toIsoDate(new Date());
    const until = addLocalDays(today, 14);
    return orders
      .filter((o) => {
        if (!isOpenRequest(o) || !o.scheduled_at) return false;
        const day = toCalendarDay(o.scheduled_at);
        return day != null && day >= today && day <= until;
      })
      .slice()
      .sort((a, b) => {
        const da = a.scheduled_at!;
        const db = b.scheduled_at!;
        if (da === db) return 0;
        return da < db ? -1 : 1;
      })
      .slice(0, 5);
  }, [orders]);

  const openByProperty = useMemo(() => {
    const map = new Map<number, number>();
    for (const o of orders) {
      if (!isOpenRequest(o) || o.property_id == null) continue;
      map.set(o.property_id, (map.get(o.property_id) ?? 0) + 1);
    }
    return map;
  }, [orders]);

  if (loading) {
    return (
      <PageShell title="Dashboard" meta="Needs attention · portfolio overview">
        <div className="space-y-3" aria-busy="true">
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </div>
      </PageShell>
    );
  }

  if (loadError || !summary) {
    return (
      <PageShell title="Dashboard" meta="Needs attention · portfolio overview">
        <ErrorRetry
          message={loadError ?? "Couldn’t load dashboard."}
          onRetry={() => setReloadKey((k) => k + 1)}
        />
      </PageShell>
    );
  }

  const pendingDisplay =
    pendingFailed && pendingApprovals == null
      ? "—"
      : pendingFailed && pendingApprovals != null
        ? String(pendingApprovals)
        : pendingApprovals == null
          ? "—"
          : String(pendingApprovals);

  return (
    <PageShell
      title="Dashboard"
      meta="Needs attention · portfolio overview"
      actions={
        app.canCreateWorkOrders ? (
          <Button variant="brand" size="header" onClick={() => setCreateOpen(true)}>
            New request
          </Button>
        ) : null
      }
    >
      <div
        className="space-y-4"
        aria-busy={refreshing || undefined}
        data-refreshing={refreshing ? "true" : undefined}
      >
        {/* U5 counters: Awaiting approval · New to assign · Emergencies · Unread */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Counter
            value={pendingDisplay}
            label="Awaiting approval"
            muted={pendingDisplay === "0" || pendingDisplay === "—"}
            tone={pendingFailed ? "warn" : undefined}
            onClick={() => navigate("/users")}
          />
          <Counter
            value={newToAssign}
            label="New requests to assign"
            muted={newToAssign === 0}
            onClick={() => navigate("/maintenance?filter=unassigned")}
          />
          <Counter
            value={emergenciesOpen}
            label="Emergencies open"
            muted={emergenciesOpen === 0}
            onClick={() => navigate("/maintenance?filter=urgent")}
          />
          {/* Stub: unread messages — /messages route not wired yet (Group C). */}
          <Counter value={0} label="Unread messages" muted />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="space-y-4">
            <section className="rounded-md border border-border bg-card p-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-foreground">Open requests</h2>
                <button
                  type="button"
                  onClick={() => navigate("/maintenance")}
                  className="text-xs font-medium text-brand-text hover:underline"
                >
                  View all
                </button>
              </div>
              {openOrders.length === 0 ? (
                <EmptyState message="No open requests right now." className="py-8" />
              ) : (
                <div className="mt-3 overflow-hidden rounded-md border border-border">
                  {openOrders.map((wo) => {
                    const status = toRequestStatus(wo);
                    const pri = priorityLevel(wo.priority);
                    const next = requestNextStep(wo);
                    const unitBit = wo.unit_name ? ` · Unit ${wo.unit_name}` : "";
                    return (
                      <ListRow
                        key={wo.id}
                        title={`${wo.title}${unitBit}`}
                        context={requestContextLine(wo, {
                          includeProperty: true,
                          titleIncludesUnit: Boolean(wo.unit_name),
                        })}
                        priority={pri ? <PriorityChip level={pri} /> : undefined}
                        status={<StatusChip status={status} nextStep={next} />}
                        onClick={() => navigate(`/maintenance?wo=${wo.id}`)}
                      />
                    );
                  })}
                </div>
              )}
            </section>

            <section className="rounded-md border border-border bg-card p-4">
              {/* Calendar D5 visits surface here as Upcoming · next 14 days. */}
              <h2 className="text-sm font-semibold text-foreground">
                Upcoming · next 14 days
              </h2>
              {upcoming.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">No scheduled visits.</p>
              ) : (
                <ul className="mt-3 space-y-3">
                  {upcoming.map((wo) => (
                    <li key={wo.id} className="flex gap-3">
                      <p className="w-[88px] shrink-0 text-xs font-semibold text-brand-text">
                        {formatActivityStamp(wo.scheduled_at)}
                      </p>
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left"
                        onClick={() => navigate(`/maintenance?wo=${wo.id}`)}
                      >
                        <p className="truncate text-[13px] font-medium text-foreground">
                          {wo.title}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {[wo.property_name, wo.unit_name ? `Unit ${wo.unit_name}` : null]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <div className="space-y-4">
            <section className="rounded-md border border-border bg-card p-4">
              <h2 className="text-sm font-semibold text-foreground">Recent activity</h2>
              {/* Stub: no activity feed API — newest open WOs by created_at. */}
              <ul className="mt-3 space-y-2">
                {recentActivity.map((wo) => (
                  <li key={wo.id} className="flex gap-2 text-[13px]">
                    <p className="min-w-0 flex-1 text-foreground">
                      {wo.title} · {toRequestStatus(wo)}
                    </p>
                    <p className="shrink-0 text-[11px] text-muted-foreground">
                      {formatActivityStamp(wo.created_at)}
                    </p>
                  </li>
                ))}
                {recentActivity.length === 0 ? (
                  <li className="text-sm text-muted-foreground">No recent activity.</li>
                ) : null}
              </ul>
            </section>

            <section className="rounded-md border border-border bg-card p-4">
              <h2 className="text-sm font-semibold text-foreground">Portfolio</h2>
              <div className="mt-3 flex flex-wrap gap-2">
                {(properties as Property[]).slice(0, 8).map((p) => {
                  const open = openByProperty.get(p.id) ?? 0;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => navigate(`/properties/${p.id}`)}
                      className="min-w-[140px] flex-1 rounded-sm bg-muted p-3 text-left transition-colors hover:bg-muted/80"
                    >
                      <p className="text-[13px] font-semibold text-foreground">{p.name}</p>
                      <p
                        className={cn(
                          "text-[11px]",
                          open > 0 ? "text-info" : "text-faint",
                        )}
                      >
                        {open > 0
                          ? `${open} open request${open === 1 ? "" : "s"}`
                          : "No open requests"}
                      </p>
                    </button>
                  );
                })}
                {properties.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No properties yet.</p>
                ) : null}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                {summary.occupied}/{summary.units} units occupied ·{" "}
                <button
                  type="button"
                  className="font-medium text-brand-text hover:underline"
                  onClick={() => navigate("/properties")}
                >
                  View all
                </button>
              </p>
            </section>
          </div>
        </div>
      </div>

      <WorkOrderDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSaved={() => setReloadKey((k) => k + 1)}
      />
    </PageShell>
  );
}

function Counter({
  value,
  label,
  muted = false,
  tone,
  onClick,
}: {
  value: number | string;
  label: string;
  muted?: boolean;
  tone?: "warn";
  onClick?: () => void;
}) {
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "flex flex-col gap-1.5 rounded-md border border-border p-4 text-left",
        muted ? "bg-muted text-faint" : "bg-card text-foreground",
        tone === "warn" && "border-warning/40",
        onClick && "transition-colors hover:bg-muted/60",
      )}
    >
      <p className="text-[28px] font-semibold leading-[38px]">{value}</p>
      <p
        className={cn(
          "text-xs font-medium",
          muted ? "text-faint" : "text-muted-foreground",
        )}
      >
        {label}
      </p>
    </Comp>
  );
}
