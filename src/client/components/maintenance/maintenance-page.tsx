import { useEffect, useMemo, useState } from "react";
import { Plus, Wrench } from "lucide-react";
import { useApp } from "@/context";
import {
  createSingleFlightLoader,
  queryMaintenanceFocus,
  type DeepLinkProps,
} from "@/lib/deep-link";
import { useDeepLinkOpen } from "@/hooks/use-deep-link-open";
import { useMediaQuery } from "@/hooks/use-media-query";
import type { StaffMember } from "@/lib/data";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { WorkOrderDialog } from "./work-order-dialog";
import { LandlordSubmitDialog } from "./landlord-submit-dialog";
import { TenantRequestsPage } from "./tenant-requests-page";
import { formatStaffMember } from "./work-order-assignee-date-fields";
import type { WorkOrder } from "@/types";
import { PageShell } from "@/components/page-shell";
import {
  EmptyState,
  ErrorRetry,
  ListRow,
  PriorityChip,
  SkeletonRow,
  StatusChip,
} from "@/components/patterns";
import { cn } from "@/lib/utils";
import { landlordNextStep, priorityLevel } from "@/lib/request-status";
import {
  staffQueueTab,
  toRequestStatus,
  workOrderContextLine,
} from "./request-status";

type StaffTab = "needs" | "active" | "completed" | "all";
type AudienceFilter = "active" | "closed";

function QueueTab({
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
        "rounded-sm px-3 py-2 text-[13px]",
        active
          ? "bg-brand-tint font-medium text-brand-text"
          : "border border-border font-normal text-muted-foreground hover:bg-muted",
      )}
    >
      {label}
    </button>
  );
}

export function MaintenancePage(
  props: DeepLinkProps & { navigate?: (to: string) => void } = {},
) {
  const app = useApp();
  if (app.isTenant) {
    return <TenantRequestsPage {...props} />;
  }
  return <StaffLandlordMaintenancePage {...props} />;
}

/** Staff / landlord maintenance queue (unchanged tabs + filters). */
function StaffLandlordMaintenancePage({
  search = "",
  replace,
  navigate,
}: DeepLinkProps & { navigate?: (to: string) => void } = {}) {
  const app = useApp();
  /** Landlord rows move the next-step hint under the context line on phones. */
  const isPhone = useMediaQuery("(max-width: 639px)");
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [staffTab, setStaffTab] = useState<StaffTab>("needs");
  const [tenantFilter, setTenantFilter] = useState<AudienceFilter>("active");
  const [propertyFilter, setPropertyFilter] = useState<string>("all");
  const [assigneeFilter, setAssigneeFilter] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<WorkOrder | undefined>(undefined);
  /** Landlord "New request" (LG-C). */
  const [landlordSubmitOpen, setLandlordSubmitOpen] = useState(false);

  const listWorkOrders = app.listWorkOrders;
  const setError = app.setError;
  const flight = useMemo(
    () =>
      createSingleFlightLoader(async () => {
        try {
          setListError(null);
          setError(null);
          return await listWorkOrders();
        } catch (err) {
          const message = (err as Error).message;
          setListError(message);
          setError(message);
          throw err;
        }
      }),
    [listWorkOrders, setError],
  );

  /** Landlord shares Active/Closed; Needs action is admin-only. */
  const useAudienceTabs = app.isLandlord;

  async function load() {
    setLoading(true);
    try {
      const list = await flight.load();
      setOrders(list);
      return list;
    } catch {
      setOrders([]);
      return [] as WorkOrder[];
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const list = await flight.load();
        if (cancelled) return;
        setOrders(list);
      } catch {
        if (!cancelled) setOrders([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [flight]);

  useDeepLinkOpen({
    search,
    param: "wo",
    items: orders,
    loadList: () => flight.load(),
    onList: setOrders,
    onFound: (found) => {
      if (navigate) {
        navigate(`/maintenance/${found.id}`);
        return;
      }
      setEditing(found);
      setDialogOpen(true);
      setStaffTab("all");
      replace?.("/maintenance");
    },
    onMiss: () => replace?.("/maintenance"),
  });

  useEffect(() => {
    if (app.isLandlord) return;
    let cancelled = false;
    (async () => {
      try {
        const rows = await app.listStaff();
        if (!cancelled) setStaff(rows);
      } catch {
        /* assignee filter optional */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [app]);

  const staffById = useMemo(() => {
    const map = new Map<number, StaffMember>();
    for (const s of staff) map.set(s.id, s);
    return map;
  }, [staff]);

  const counts = useMemo(() => {
    let needs = 0;
    let active = 0;
    let completed = 0;
    let urgent = 0;
    for (const o of orders) {
      const tab = staffQueueTab(o.status, Boolean(o.assigned_staff_id));
      if (tab === "needs") needs++;
      else if (tab === "active") active++;
      else completed++;
      if (o.priority === "urgent" && o.status !== "closed") urgent++;
    }
    return { needs, active, completed, all: orders.length, urgent };
  }, [orders]);

  const focusFilter = useMemo(() => queryMaintenanceFocus(search), [search]);

  const filtered = useMemo(() => {
    let list = orders;
    if (useAudienceTabs) {
      list =
        tenantFilter === "closed"
          ? list.filter((o) => o.status === "closed")
          : list.filter((o) => o.status !== "closed");
    } else if (staffTab !== "all") {
      list = list.filter(
        (o) => staffQueueTab(o.status, Boolean(o.assigned_staff_id)) === staffTab,
      );
    }
    if (propertyFilter !== "all") {
      const pid = Number(propertyFilter);
      list = list.filter((o) => o.property_id === pid);
    }
    if (assigneeFilter !== "all" && !useAudienceTabs) {
      if (assigneeFilter === "unassigned") {
        list = list.filter((o) => o.assigned_staff_id == null);
      } else {
        const sid = Number(assigneeFilter);
        list = list.filter((o) => o.assigned_staff_id === sid);
      }
    }
    if (!useAudienceTabs && focusFilter === "unassigned") {
      list = list.filter((o) => o.status === "open" && !o.assigned_staff_id);
    } else if (!useAudienceTabs && focusFilter === "urgent") {
      list = list.filter((o) => o.status !== "closed" && o.priority === "urgent");
    }
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter((o) => {
        const hay = [
          o.title,
          o.description,
          o.property_name,
          o.unit_name,
          o.tenant_first_name,
          o.tenant_last_name,
          o.request_number,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      });
    }
    return list;
  }, [
    orders,
    staffTab,
    tenantFilter,
    propertyFilter,
    assigneeFilter,
    query,
    useAudienceTabs,
    focusFilter,
  ]);

  const activeCount = orders.filter((o) => o.status !== "closed").length;
  const meta = useAudienceTabs
    ? `${activeCount} active`
    : `${counts.needs} need action`;
  const filtersActive =
    propertyFilter !== "all" || assigneeFilter !== "all" || query.trim().length > 0;

  function openOrder(w: WorkOrder) {
    if (navigate) {
      navigate(`/maintenance/${w.id}`);
      return;
    }
    setEditing(w);
    setDialogOpen(true);
  }

  function clearFilters() {
    setPropertyFilter("all");
    setAssigneeFilter("all");
    setQuery("");
  }

  return (
    <PageShell
      title="Maintenance"
      meta={meta}
      actions={
        app.canCreateWorkOrders ? (
          <Button
            variant="brand"
            size="header"
            onClick={() => {
              setEditing(undefined);
              setDialogOpen(true);
            }}
          >
            <Plus className="h-4 w-4" /> New request
          </Button>
        ) : app.isLandlord && app.canSubmitRequest ? (
          <Button
            variant="brand"
            size="header"
            onClick={() => setLandlordSubmitOpen(true)}
          >
            <Plus className="h-4 w-4" /> New request
          </Button>
        ) : null
      }
    >
      {useAudienceTabs ? (
        <div className="flex flex-wrap gap-2">
          <QueueTab
            label={`Active (${activeCount})`}
            active={tenantFilter === "active"}
            onClick={() => setTenantFilter("active")}
          />
          <QueueTab
            label={`Closed (${orders.filter((o) => o.status === "closed").length})`}
            active={tenantFilter === "closed"}
            onClick={() => setTenantFilter("closed")}
          />
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <QueueTab
            label={`Needs action (${counts.needs})`}
            active={staffTab === "needs"}
            onClick={() => {
              setStaffTab("needs");
              if (focusFilter) replace?.("/maintenance");
            }}
          />
          <QueueTab
            label={`Active (${counts.active})`}
            active={staffTab === "active"}
            onClick={() => {
              setStaffTab("active");
              if (focusFilter) replace?.("/maintenance");
            }}
          />
          <QueueTab
            label={`Completed (${counts.completed})`}
            active={staffTab === "completed"}
            onClick={() => {
              setStaffTab("completed");
              if (focusFilter) replace?.("/maintenance");
            }}
          />
          <QueueTab
            label="All"
            active={staffTab === "all"}
            onClick={() => {
              setStaffTab("all");
              if (focusFilter) replace?.("/maintenance");
            }}
          />
        </div>
      )}

      {(app.isLandlord || !useAudienceTabs) && (
        <div className="flex flex-wrap items-center gap-2">
          <Select value={propertyFilter} onValueChange={setPropertyFilter}>
            <SelectTrigger className="h-8 w-auto min-w-[7.5rem] text-xs">
              <SelectValue placeholder="Property" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All properties</SelectItem>
              {app.properties.map((p) => (
                <SelectItem key={p.id} value={String(p.id)}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!app.isLandlord && (
            <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
              <SelectTrigger className="h-8 w-auto min-w-[7.5rem] text-xs">
                <SelectValue placeholder="Assignee" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All assignees</SelectItem>
                <SelectItem value="unassigned">Unassigned</SelectItem>
                {staff.map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {formatStaffMember(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Input
            className="h-8 min-w-[12rem] flex-1 text-xs"
            placeholder="Search requests…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      )}

      {loading ? (
        <div className="overflow-hidden rounded-md border border-border bg-card">
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </div>
      ) : listError ? (
        <ErrorRetry message={listError} onRetry={() => void load()} />
      ) : filtered.length === 0 ? (
        <div className="rounded-md border border-border bg-card">
          <EmptyState
            icon={<Wrench className="size-5" aria-hidden />}
            message={
              orders.length === 0
                ? app.isLandlord
                  ? "Maintenance on your properties will show up here."
                  : "Nothing needs action right now."
                : "No requests match this filter."
            }
            filtered={orders.length > 0 && filtersActive}
            onClear={clearFilters}
            actionLabel={
              orders.length === 0 && (app.canCreateWorkOrders || app.isLandlord)
                ? "New request"
                : undefined
            }
            onAction={
              app.canCreateWorkOrders
                ? () => {
                    setEditing(undefined);
                    setDialogOpen(true);
                  }
                : app.isLandlord
                  ? () => setLandlordSubmitOpen(true)
                  : undefined
            }
          />
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-border bg-card">
          {filtered.map((w) => {
            const status = toRequestStatus(w);
            const priority = priorityLevel(w.priority);
            const assignee =
              w.assigned_staff_id != null
                ? staffById.get(w.assigned_staff_id)
                : undefined;
            const assigneeLabel = assignee
              ? `Assigned ${formatStaffMember(assignee)}`
              : w.assigned_staff_id
                ? "Assigned"
                : null;
            const contextLine = workOrderContextLine(w, {
              isTenant: false,
              assigneeLabel,
            });
            const next = app.isLandlord ? landlordNextStep(w) : null;
            return (
              <ListRow
                key={w.id}
                title={w.title}
                context={
                  next && isPhone ? (
                    <>
                      <span className="block truncate">{contextLine}</span>
                      <span className="mt-1 block whitespace-normal" data-next-step={next.who}>
                        {next.text}
                      </span>
                    </>
                  ) : (
                    contextLine
                  )
                }
                priority={priority ? <PriorityChip level={priority} /> : null}
                status={
                  <StatusChip status={status} nextStep={next && !isPhone ? next.text : undefined} />
                }
                onClick={() => openOrder(w)}
              />
            );
          })}
        </div>
      )}

      <WorkOrderDialog
        open={dialogOpen}
        onOpenChange={(o) => {
          setDialogOpen(o);
          if (!o) void load();
        }}
        workOrder={editing}
      />

      {app.isLandlord ? (
        <LandlordSubmitDialog
          open={landlordSubmitOpen}
          onOpenChange={setLandlordSubmitOpen}
          onCreated={() => void load()}
        />
      ) : null}
    </PageShell>
  );
}
