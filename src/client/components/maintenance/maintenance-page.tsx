import { useEffect, useMemo, useState } from "react";
import { CircleAlert, Plus, Wrench } from "lucide-react";
import { useApp } from "@/context";
import { cn, formatDate, formatMoney } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MaintenanceRequestDialog } from "./maintenance-request-dialog";
import { TestDataBadge } from "@/components/test-data-badge";
import type { MaintenancePriority, MaintenanceRequest, MaintenanceStatus } from "@/types";
import { PageShell } from "@/components/page-shell";

const PRIORITY_TONE: Record<MaintenancePriority, string> = {
  Urgent: "bg-destructive-tint text-destructive",
  High: "bg-warning-tint text-warning",
  Normal: "bg-info-tint text-info",
  Low: "bg-muted text-muted-foreground",
};

const STATUS_VARIANT: Record<MaintenanceStatus, "info" | "brand" | "warning" | "neutral" | "success"> = {
  Open: "info",
  Scheduled: "brand",
  "In Progress": "warning",
  "On Hold": "neutral",
  Closed: "success",
};

type Filter = MaintenanceStatus | "all";

const TABS: { value: Filter; label: string }[] = [
  { value: "Open", label: "Open" },
  { value: "Scheduled", label: "Scheduled" },
  { value: "In Progress", label: "In Progress" },
  { value: "On Hold", label: "On Hold" },
  { value: "Closed", label: "Closed" },
  { value: "all", label: "All" },
];

export function MaintenancePage() {
  const app = useApp();
  const [requests, setRequests] = useState<MaintenanceRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("Open");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<MaintenanceRequest | undefined>(undefined);

  async function load() {
    try {
      setLoading(true);
      setRequests(await app.listMaintenanceRequests());
    } catch (err) {
      app.setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: requests.length, Open: 0, Scheduled: 0, "In Progress": 0, "On Hold": 0, Closed: 0 };
    let urgent = 0;
    for (const r of requests) {
      c[r.status]++;
      if (r.priority === "Urgent" && r.status !== "Closed") urgent++;
    }
    return { ...c, urgent, active: requests.length - c.Closed };
  }, [requests]);

  const filtered = useMemo(
    () => (filter === "all" ? requests : requests.filter((r) => r.status === filter)),
    [requests, filter],
  );

  function openNew() {
    setEditing(undefined);
    setDialogOpen(true);
  }

  return (
    <PageShell
      title="Maintenance"
      meta={<>
          {counts.active} active
          {counts.urgent > 0 && (
            <span className="badge-tone tone-danger ml-2">
              <CircleAlert className="h-3 w-3" /> {counts.urgent} urgent
            </span>
          )}
        </>}
      actions={
        requests.length > 0 ? (
          <Button onClick={openNew}>
            <Plus className="h-4 w-4" /> New request
          </Button>
        ) : null
      }
    >

        <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
          <TabsList>
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
                <span className="ml-1.5 text-xs tabular-nums text-muted-foreground">{counts[t.value]}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {loading ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">Loading…</Card>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-6 py-20 text-center">
            <Wrench className="size-7 text-faint" aria-hidden />
            <p className="font-medium">Nothing here</p>
            <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
              {requests.length === 0 ? "Track repair and maintenance requests for your properties." : "No maintenance requests match this tab."}
            </p>
            {requests.length === 0 && (
              <Button className="mt-2" onClick={openNew}>
                <Plus className="mr-1 h-4 w-4" /> New request
              </Button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {filtered.map((r) => {
              const staffName = [r.staff_first_name, r.staff_last_name].filter(Boolean).join(" ");
              const tenantName = [r.tenant_first_name, r.tenant_last_name].filter(Boolean).join(" ");
              return (
                <Card
                  key={r.id}
                  className="cursor-pointer p-4 transition-colors duration-150 hover:bg-muted"
                  onClick={() => { setEditing(r); setDialogOpen(true); }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-muted-foreground">{r.request_number}</span>
                        <TestDataBadge show={r.is_test_data} />
                      </div>
                      <h3 className="truncate font-semibold">{r.title}</h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {[r.category, r.property_name, r.unit_name].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold", PRIORITY_TONE[r.priority])}>
                      {r.priority === "Urgent" && <CircleAlert className="mr-1 h-3 w-3" />}
                      {r.priority}
                    </span>
                  </div>
                  <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{r.description}</p>
                  {r.status === "On Hold" && r.hold_reason && (
                    <p className="mt-1 text-xs text-warning">On hold: {r.hold_reason}</p>
                  )}
                  <div className="mt-3 flex items-center justify-between gap-3 border-t pt-3 text-xs">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <Badge variant={STATUS_VARIANT[r.status]}>{r.status}</Badge>
                      <span className="truncate text-muted-foreground">
                        {[staffName ? `Staff: ${staffName}` : "Unassigned", r.vendor_name, tenantName ? `From ${tenantName}` : null]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </div>
                    <div className="shrink-0 text-right text-muted-foreground">
                      {r.scheduled_for && <div>Scheduled {formatDate(r.scheduled_for)}</div>}
                      {r.next_follow_up_date && <div>Follow up {formatDate(r.next_follow_up_date)}</div>}
                      {r.closed_at && <div>Closed {formatDate(r.closed_at)}</div>}
                      {r.cost != null && <div className="font-medium tabular-nums text-foreground">{formatMoney(Number(r.cost), app.settings.currency)}</div>}
                      {!r.scheduled_for && !r.closed_at && !r.next_follow_up_date && r.cost == null && <div>Created {formatDate(r.created_at)}</div>}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}

      <MaintenanceRequestDialog
        open={dialogOpen}
        onOpenChange={(o) => { setDialogOpen(o); if (!o) load(); }}
        request={editing}
      />
    </PageShell>
  );
}
