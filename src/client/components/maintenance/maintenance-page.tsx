import { useEffect, useMemo, useState } from "react";
import { CircleAlert, Plus, Wrench } from "lucide-react";
import { useApp } from "@/context";
import { queryId } from "@/lib/deep-link";
import { cn, formatDate, formatMoney } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WorkOrderDialog } from "./work-order-dialog";
import { TenantSubmitDialog } from "./tenant-submit-dialog";
import type { TenantHomeContext, WorkOrder, WorkOrderStatus } from "@/types";
import { PageShell } from "@/components/page-shell";

const PRIORITY_TONE: Record<string, string> = {
  urgent: "bg-destructive-tint text-destructive",
  high: "bg-warning-tint text-warning",
  normal: "bg-info-tint text-info",
  low: "bg-muted text-muted-foreground",
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  open: "secondary",
  scheduled: "default",
  in_progress: "default",
  on_hold: "outline",
  closed: "outline",
};

type StaffFilter = WorkOrderStatus | "open_all" | "all";
type TenantFilter = "active" | "closed";

function tenantStatusLabel(status: WorkOrderStatus): string {
  switch (status) {
    case "open":
      return "Submitted";
    case "scheduled":
      return "Scheduled";
    case "in_progress":
      return "In progress";
    case "on_hold":
      return "On hold";
    case "closed":
      return "Closed";
    default:
      return status;
  }
}

export function MaintenancePage({
  search = "",
  replace,
}: {
  search?: string;
  replace?: (to: string) => void;
} = {}) {
  const app = useApp();
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [staffFilter, setStaffFilter] = useState<StaffFilter>("open_all");
  const [tenantFilter, setTenantFilter] = useState<TenantFilter>("active");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [tenantOpen, setTenantOpen] = useState(false);
  const [editing, setEditing] = useState<WorkOrder | undefined>(undefined);
  const [home, setHome] = useState<TenantHomeContext | null>(null);

  async function load() {
    try {
      setLoading(true);
      const list = await app.listWorkOrders();
      setOrders(list);
      return list;
    } catch (err) {
      app.setError((err as Error).message);
      return [] as WorkOrder[];
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, []);

  // Calendar (and other) deep-links: open existing WO without touching work-order-dialog.
  useEffect(() => {
    const woId = queryId(search, "wo");
    if (woId == null) return;
    let cancelled = false;
    (async () => {
      const list = orders.length ? orders : await load();
      if (cancelled) return;
      const found = list.find((w) => w.id === woId);
      if (found) {
        setEditing(found);
        setDialogOpen(true);
        if (staffFilter !== "all" && found.status === "closed") setStaffFilter("all");
      }
      replace?.("/maintenance");
    })();
    return () => {
      cancelled = true;
    };
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [search]);

  useEffect(() => {
    if (!app.isTenant) return;
    let cancelled = false;
    (async () => {
      try {
        const ctx = await app.getTenantHomeContext();
        if (!cancelled) setHome(ctx);
      } catch {
        /* ignore — submit dialog also loads */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [app.isTenant, app]);

  const counts = useMemo(() => {
    const c = {
      all: orders.length,
      open: 0,
      scheduled: 0,
      in_progress: 0,
      on_hold: 0,
      closed: 0,
      urgent: 0,
      active: 0,
    };
    for (const o of orders) {
      if (o.status === "open") c.open++;
      if (o.status === "scheduled") c.scheduled++;
      if (o.status === "in_progress") c.in_progress++;
      if (o.status === "on_hold") c.on_hold++;
      if (o.status === "closed") c.closed++;
      if (o.status !== "closed") c.active++;
      if (o.priority === "urgent" && o.status !== "closed") c.urgent++;
    }
    return c;
  }, [orders]);

  const filtered = useMemo(() => {
    if (app.isTenant) {
      if (tenantFilter === "closed") return orders.filter((o) => o.status === "closed");
      return orders.filter((o) => o.status !== "closed");
    }
    if (staffFilter === "all") return orders;
    if (staffFilter === "open_all") return orders.filter((o) => o.status !== "closed");
    return orders.filter((o) => o.status === staffFilter);
  }, [orders, staffFilter, tenantFilter, app.isTenant]);

  const title = app.isTenant ? "My requests" : "Maintenance";
  const metaOpen = app.isTenant ? counts.active : counts.open + counts.scheduled + counts.in_progress + counts.on_hold;
  const noUnit = app.isTenant && home != null && home.unit_id == null;
  const homeLabel =
    home &&
    [home.unit_label ? `Unit ${home.unit_label}` : null, home.property_name].filter(Boolean).join(" · ");

  return (
    <PageShell
      title={title}
      meta={
        <>
          {metaOpen} {app.isTenant ? "active" : "open"}
          {homeLabel && app.isTenant && (
            <span className="ml-2 text-muted-foreground">· {homeLabel}</span>
          )}
          {counts.urgent > 0 && (
            <span className="badge-tone tone-danger ml-2">
              <CircleAlert className="h-3 w-3" /> {counts.urgent} urgent
            </span>
          )}
        </>
      }
      actions={
        app.isTenant ? (
          <Button
            onClick={() => setTenantOpen(true)}
            disabled={noUnit}
            title={noUnit ? "Ask staff to assign a unit first" : undefined}
          >
            <Plus className="h-4 w-4" /> New request
          </Button>
        ) : app.canCreateWorkOrders && filtered.length > 0 ? (
          <Button
            onClick={() => {
              setEditing(undefined);
              setDialogOpen(true);
            }}
          >
            <Plus className="h-4 w-4" /> New work order
          </Button>
        ) : null
      }
    >
      {noUnit && (
        <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
          Your account isn’t linked to a unit yet. Ask staff to assign a unit before submitting requests.
        </p>
      )}

      {app.isTenant ? (
        <Tabs value={tenantFilter} onValueChange={(v) => setTenantFilter(v as TenantFilter)}>
          <TabsList>
            <TabsTrigger value="active">Active ({counts.active})</TabsTrigger>
            <TabsTrigger value="closed">Closed ({counts.closed})</TabsTrigger>
          </TabsList>
        </Tabs>
      ) : (
        <Tabs value={staffFilter} onValueChange={(v) => setStaffFilter(v as StaffFilter)}>
          <TabsList>
            <TabsTrigger value="open_all">Open</TabsTrigger>
            <TabsTrigger value="open">Unscheduled</TabsTrigger>
            <TabsTrigger value="scheduled">Scheduled</TabsTrigger>
            <TabsTrigger value="in_progress">In progress</TabsTrigger>
            <TabsTrigger value="on_hold">On hold</TabsTrigger>
            <TabsTrigger value="closed">Closed</TabsTrigger>
            <TabsTrigger value="all">All</TabsTrigger>
          </TabsList>
        </Tabs>
      )}

      {loading ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">Loading…</Card>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 px-6 py-20 text-center">
          <Wrench className="size-7 text-faint" aria-hidden />
          <p className="font-medium">Nothing here</p>
          <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
            {orders.length === 0
              ? app.isTenant
                ? "Submit a request when something needs fixing in your unit."
                : app.isLandlord
                  ? "Maintenance on your properties will show up here (read-only)."
                  : "Track repairs and turnover work for your properties."
              : "No work orders match this filter."}
          </p>
          {orders.length === 0 && app.isTenant && !noUnit && (
            <Button className="mt-2" onClick={() => setTenantOpen(true)}>
              <Plus className="mr-1 h-4 w-4" /> New request
            </Button>
          )}
          {orders.length === 0 && app.canCreateWorkOrders && (
            <Button
              className="mt-2"
              onClick={() => {
                setEditing(undefined);
                setDialogOpen(true);
              }}
            >
              <Plus className="mr-1 h-4 w-4" /> New work order
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {filtered.map((w) => (
            <Card
              key={w.id}
              className="cursor-pointer p-4 transition-colors duration-150 hover:bg-muted"
              onClick={() => {
                setEditing(w);
                setDialogOpen(true);
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <h3 className="truncate font-semibold">{w.title}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {[
                      w.request_number ? `#${w.request_number}` : null,
                      w.category,
                      !app.isTenant
                        ? [w.tenant_first_name, w.tenant_last_name].filter(Boolean).join(" ") || null
                        : null,
                      w.property_name,
                      w.unit_name,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </p>
                </div>
                <span
                  className={cn(
                    "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold capitalize",
                    PRIORITY_TONE[w.priority],
                  )}
                >
                  {w.priority === "urgent" && <CircleAlert className="mr-1 h-3 w-3" />}
                  {app.isTenant && w.priority === "urgent" ? "emergency" : w.priority}
                </span>
              </div>
              {w.description && (
                <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{w.description}</p>
              )}
              <div className="mt-3 flex items-center justify-between border-t pt-3 text-xs">
                <div className="flex items-center gap-2">
                  <Badge variant={STATUS_VARIANT[w.status] ?? "secondary"} className="capitalize">
                    {app.isTenant ? tenantStatusLabel(w.status) : w.status.replaceAll("_", " ")}
                  </Badge>
                  {w.vendor_name && <span className="text-muted-foreground">{w.vendor_name}</span>}
                </div>
                <div className="text-right text-muted-foreground">
                  {w.scheduled_at && <div>Scheduled {formatDate(w.scheduled_at)}</div>}
                  {w.cost != null && !app.isTenant && (
                    <div className="font-medium tabular-nums text-foreground">
                      {formatMoney(w.cost, app.settings.currency)}
                    </div>
                  )}
                  {!w.scheduled_at && (w.cost == null || app.isTenant) && (
                    <div>Created {formatDate(w.created_at)}</div>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <WorkOrderDialog
        open={dialogOpen}
        onOpenChange={(o) => {
          setDialogOpen(o);
          if (!o) load();
        }}
        workOrder={editing}
      />
      {app.isTenant && (
        <TenantSubmitDialog
          open={tenantOpen}
          onOpenChange={(o) => {
            setTenantOpen(o);
            if (!o) load();
          }}
          onSaved={load}
        />
      )}
    </PageShell>
  );
}
