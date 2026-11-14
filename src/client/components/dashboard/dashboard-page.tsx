import { useEffect, useMemo, useState } from "react";
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
import {
  formatActivityStamp,
  isOpenRequest,
  priorityLevel,
  requestNextStep,
  toRequestStatus,
} from "@/lib/request-status";
import { cn } from "@/lib/utils";
import type { DashboardSummary, Property, WorkOrder } from "@/types";
import { WorkOrderDialog } from "@/components/maintenance/work-order-dialog";

/**
 * Admin U5 Dashboard (Figma 04 Homes) — needs-attention counters, open requests,
 * upcoming (replaces calendar tiles), recent activity stub, portfolio strip.
 * No rent / lease KPI tiles per Figma Q1 note.
 */
export function DashboardPage({ navigate }: { navigate: (to: string) => void }) {
  const app = useApp();
  const { getDashboardSummary, listWorkOrders, properties, setError, isAdmin } = app;
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const [dash, woList, accounts] = await Promise.all([
          getDashboardSummary(),
          listWorkOrders(),
          isAdmin
            ? data.listUserAccounts().catch(() => [] as data.UserAccountRow[])
            : Promise.resolve([] as data.UserAccountRow[]),
        ]);
        if (cancelled) return;
        setSummary(dash);
        setOrders(woList);
        setPendingApprovals(
          accounts.filter((a) => a.account_status === "pending").length,
        );
      } catch (err) {
        if (!cancelled) {
          const message = (err as Error).message;
          setLoadError(message);
          setError(message);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getDashboardSummary, listWorkOrders, setError, isAdmin, reloadKey]);

  const openOrders = useMemo(
    () => orders.filter(isOpenRequest).slice(0, 6),
    [orders],
  );

  const unassigned = useMemo(
    () =>
      orders.filter(
        (o) => isOpenRequest(o) && !o.assigned_staff_id && o.status === "open",
      ).length,
    [orders],
  );

  const overdueFollowUps = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return orders.filter(
      (o) =>
        o.status === "on_hold" &&
        o.next_follow_up_date != null &&
        o.next_follow_up_date.slice(0, 10) <= today,
    ).length;
  }, [orders]);

  const upcoming = useMemo(() => {
    return orders
      .filter((o) => o.scheduled_at && isOpenRequest(o))
      .slice()
      .sort((a, b) => (a.scheduled_at! < b.scheduled_at! ? -1 : 1))
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
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Counter value={unassigned} label="Unassigned requests" />
        <Counter value={pendingApprovals} label="Awaiting approval" />
        <Counter value={overdueFollowUps} label="Overdue follow-ups" />
        {/* Stub: unread messages — Messages group owns inbox counts. */}
        <Counter value={0} label="Unread messages" muted />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <section className="rounded-md border border-border bg-card p-4">
            <h2 className="text-sm font-semibold text-foreground">Open requests</h2>
            {openOrders.length === 0 ? (
              <EmptyState message="No open requests right now." className="py-8" />
            ) : (
              <div className="mt-3 overflow-hidden rounded-md border border-border">
                {openOrders.map((wo) => {
                  const status = toRequestStatus(wo);
                  const pri = priorityLevel(wo.priority);
                  const unitBit = wo.unit_name ? ` · Unit ${wo.unit_name}` : "";
                  return (
                    <div key={wo.id} className="border-b border-border last:border-b-0">
                      {pri === "Emergency" ? (
                        <div className="px-4 pt-2">
                          <PriorityChip level="Emergency" />
                        </div>
                      ) : null}
                      <ListRow
                        title={`${wo.title}${unitBit}`}
                        context={[
                          wo.property_name,
                          status,
                          requestNextStep(wo),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                        status={
                          <StatusChip status={status} nextStep={requestNextStep(wo)} />
                        }
                        onClick={() => navigate(`/maintenance?wo=${wo.id}`)}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="rounded-md border border-border bg-card p-4">
            <h2 className="text-sm font-semibold text-foreground">Upcoming</h2>
            {upcoming.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">
                No scheduled visits. (Replaces Calendar D5.)
              </p>
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
            <p className="mt-3 text-[11px] text-muted-foreground">Replaces Calendar (D5)</p>
          </section>
        </div>

        <div className="space-y-4">
          <section className="rounded-md border border-border bg-card p-4">
            <h2 className="text-sm font-semibold text-foreground">Recent activity</h2>
            {/* Stub: no activity feed API — derive light signals from open WOs. */}
            <ul className="mt-3 space-y-2">
              {openOrders.slice(0, 5).map((wo) => (
                <li key={wo.id} className="flex gap-2 text-[13px]">
                  <p className="min-w-0 flex-1 text-foreground">
                    {wo.title} · {toRequestStatus(wo)}
                  </p>
                  <p className="shrink-0 text-[11px] text-muted-foreground">
                    {formatActivityStamp(wo.created_at)}
                  </p>
                </li>
              ))}
              {openOrders.length === 0 ? (
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

      <WorkOrderDialog
        open={createOpen}
        onOpenChange={(o) => {
          setCreateOpen(o);
          if (!o) setReloadKey((k) => k + 1);
        }}
        onSaved={() => setReloadKey((k) => k + 1)}
      />
    </PageShell>
  );
}

function Counter({
  value,
  label,
  muted = false,
}: {
  value: number;
  label: string;
  muted?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 rounded-md border border-border p-4",
        muted ? "bg-muted text-faint" : "bg-card text-foreground",
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
    </div>
  );
}
