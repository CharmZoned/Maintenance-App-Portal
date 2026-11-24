import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Wrench } from "lucide-react";
import { useApp } from "@/context";
import {
  createSingleFlightLoader,
  queryMaintenanceFocus,
  type DeepLinkProps,
} from "@/lib/deep-link";
import { useDeepLinkOpen } from "@/hooks/use-deep-link-open";
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
import {
  staffQueueTab,
  toRequestStatus,
  workOrderContextLine,
} from "./request-status";
import {
  requestAge,
  requestAssignee,
  sortForQueueTab,
  staffDisplayName,
} from "./maintenance-list";
import { AssignMenu, MaintenanceRequestRow } from "./maintenance-request-row";

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
  /** Request whose inline Assign is saving. */
  const [assigningId, setAssigningId] = useState<number | null>(null);
  /** Position in the list of the row last assigned inline; focus goes back there after the reload. */
  const refocusAssignAt = useRef<number | null>(null);
  const listRef = useRef<HTMLOListElement | null>(null);
  const staffTabsRef = useRef<HTMLDivElement | null>(null);

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
    return useAudienceTabs ? list : sortForQueueTab(list, staffTab);
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

  // After an inline Assign the row leaves Needs action and its trigger unmounts.
  // Keep keyboard users in place: focus the Assign button now in that slot (the
  // next request), else the list, else the selected tab.
  useEffect(() => {
    const at = refocusAssignAt.current;
    if (at == null || assigningId != null) return;
    refocusAssignAt.current = null;
    const triggers = listRef.current?.querySelectorAll<HTMLElement>("[data-assign-trigger]");
    const target =
      (triggers && triggers.length > 0 ? triggers[Math.min(at, triggers.length - 1)] : null) ??
      listRef.current ??
      staffTabsRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
    target?.focus();
  }, [filtered, assigningId]);

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

  /**
   * Inline Assign (Needs action): put a team member on the request and leave
   * it Open — the same write the request's edit dialog makes when an admin
   * picks a staff member without a date. Scheduling stays on the request page.
   */
  async function assignOrder(w: WorkOrder, member: StaffMember) {
    if (assigningId != null) return;
    setAssigningId(w.id);
    refocusAssignAt.current = Math.max(0, filtered.findIndex((o) => o.id === w.id));
    try {
      await app.updateWorkOrder(
        w.id,
        { assigned_staff_id: member.id },
        { previousStatus: w.status },
      );
      app.setNotice(`Assigned “${w.title}” to ${staffDisplayName(member)}.`);
      // Quiet refresh (no skeleton): the row moves from Needs action to Active.
      try {
        setOrders(await flight.load());
      } catch {
        /* flight already surfaced the list error */
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAssigningId(null);
    }
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
        <div ref={staffTabsRef} className="flex flex-wrap gap-2">
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
                  ? "Maintenance on your properties will show up here (read-only)."
                  : "Nothing needs action right now."
                : "No requests match this filter."
            }
            filtered={orders.length > 0 && filtersActive}
            onClear={clearFilters}
            actionLabel={
              orders.length === 0 && app.canCreateWorkOrders ? "New request" : undefined
            }
            onAction={
              app.canCreateWorkOrders
                ? () => {
                    setEditing(undefined);
                    setDialogOpen(true);
                  }
                : undefined
            }
          />
        </div>
      ) : !useAudienceTabs ? (
        <ol
          ref={listRef}
          tabIndex={-1}
          aria-label="Maintenance requests"
          className="@container outline-none overflow-hidden rounded-md border border-border bg-card divide-y divide-border"
        >
          {filtered.map((w) => {
            const canAssign =
              app.isAdmin &&
              staffTab === "needs" &&
              w.status === "open" &&
              w.assigned_staff_id == null;
            return (
              <MaintenanceRequestRow
                key={w.id}
                order={w}
                status={toRequestStatus(w)}
                assignee={requestAssignee(w, staffById)}
                age={requestAge(w)}
                href={navigate ? `/maintenance/${w.id}` : null}
                onOpen={() => openOrder(w)}
                action={
                  canAssign ? (
                    <AssignMenu
                      title={w.title}
                      staff={staff}
                      busy={assigningId === w.id}
                      disabled={assigningId != null}
                      onAssign={(member) => void assignOrder(w, member)}
                      onAssignAndSchedule={() => openOrder(w)}
                    />
                  ) : null
                }
              />
            );
          })}
        </ol>
      ) : (
        <div className="overflow-hidden rounded-md border border-border bg-card">
          {filtered.map((w) => {
            const status = toRequestStatus(w);
            const assignee =
              w.assigned_staff_id != null
                ? staffById.get(w.assigned_staff_id)
                : undefined;
            const assigneeLabel = assignee
              ? `Assigned ${formatStaffMember(assignee)}`
              : w.assigned_staff_id
                ? "Assigned"
                : null;
            return (
              <ListRow
                key={w.id}
                title={w.title}
                context={workOrderContextLine(w, {
                  isTenant: false,
                  assigneeLabel,
                })}
                priority={
                  w.priority === "urgent" ? (
                    <PriorityChip level="Emergency" />
                  ) : w.priority === "high" ? (
                    <PriorityChip level="High" />
                  ) : null
                }
                status={<StatusChip status={status} />}
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
    </PageShell>
  );
}
