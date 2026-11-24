import { useEffect, useMemo, useState } from "react";
import { Inbox, Plus, SearchX } from "lucide-react";
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
import { AdminNewRequestDialog } from "./admin-new-request-dialog";
import { TenantRequestsPage } from "./tenant-requests-page";
import { LandlordMaintenancePage } from "./landlord-maintenance-page";
import type { WorkOrder } from "@/types";
import { PageShell } from "@/components/page-shell";
import { EmptyState, ErrorRetry } from "@/components/patterns";
import { staffQueueTab } from "@/lib/request-status";
import {
  RequestListSkeleton,
  RequestListTab,
  RequestListTable,
  RequestSortMenu,
  staffDisplayName,
  useRequestThumbnails,
  type RequestListItem,
} from "./request-list-row";
import {
  readStoredSort,
  sortRecommended,
  sortRequests,
  writeStoredSort,
  type RecommendedOrder,
  type RequestSort,
} from "./request-list-sort";

type StaffTab = "needs" | "active" | "completed" | "all";

const LIST_ERROR = "We couldn't load the requests. Check your connection and try again.";

export function MaintenancePage(
  props: DeepLinkProps & { navigate?: (to: string) => void } = {},
) {
  const app = useApp();
  if (app.isTenant) {
    return <TenantRequestsPage {...props} />;
  }
  if (app.isLandlord) {
    return <LandlordMaintenancePage {...props} />;
  }
  return <StaffMaintenancePage {...props} />;
}

/** "Unit 1A" / "Common area" (no unit on the request). */
function placeLabel(o: WorkOrder): string | null {
  if (o.unit_name) return `Unit ${o.unit_name}`;
  if (o.unit_id == null) return "Common area";
  return null;
}

function tenantName(o: WorkOrder): string {
  return [o.tenant_first_name, o.tenant_last_name].filter(Boolean).join(" ").trim();
}

/** Admin context: `Cedar Flats · Unit 2 · Omar Tenant`. */
function adminContext(o: WorkOrder): string {
  return [o.property_name, placeLabel(o), tenantName(o)].filter(Boolean).join(" · ") || "—";
}

const RECOMMENDED: Record<StaffTab, RecommendedOrder> = {
  needs: "emergency-then-oldest",
  active: "in-progress-then-scheduled",
  completed: "completed-newest",
  all: "newest",
};

/**
 * Staff maintenance list (spec §6, U6). One shared request row
 * (RequestListTable); a single click opens `/maintenance/:id`. Landlords use
 * LandlordMaintenancePage (grouped by property), which opens the same page.
 */
function StaffMaintenancePage({
  search = "",
  replace,
  navigate,
}: DeepLinkProps & { navigate?: (to: string) => void } = {}) {
  const app = useApp();
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [staffTab, setStaffTab] = useState<StaffTab>("needs");
  const [propertyFilter, setPropertyFilter] = useState<string>("all");
  const [assigneeFilter, setAssigneeFilter] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const sortKey = "maintenance-list-sort:admin";
  const [sort, setSortState] = useState<RequestSort | null>(() => readStoredSort(sortKey));
  // Admin "New request" form (Figma 28:58861); `openNewRequest` is the single entry.
  const [dialogOpen, setDialogOpen] = useState(false);

  function setSort(next: RequestSort | null) {
    setSortState(next);
    writeStoredSort(sortKey, next);
  }

  const listWorkOrders = app.listWorkOrders;
  const flight = useMemo(
    () => createSingleFlightLoader(() => listWorkOrders()),
    [listWorkOrders],
  );

  async function load() {
    setLoading(true);
    try {
      const list = await flight.load();
      setListError(null);
      setOrders(list);
      return list;
    } catch (err) {
      setListError((err as Error).message || LIST_ERROR);
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
        setListError(null);
        setOrders(list);
      } catch (err) {
        if (cancelled) return;
        setListError((err as Error).message || LIST_ERROR);
        setOrders([]);
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
    // Old `?wo=` links open the request page. Replace (not push) so Back does
    // not land on `/maintenance?wo=…` and bounce forward again.
    onFound: (found) => {
      const to = `/maintenance/${found.id}`;
      if (replace) replace(to);
      else if (navigate) navigate(to);
      else window.location.replace(to);
    },
    onMiss: () => replace?.("/maintenance"),
  });

  // Staff names for the Assigned to column. RLS scopes this per role
  // (landlords read the workers on their units); failure just hides names.
  const listStaff = app.listStaff;
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await listStaff();
        if (!cancelled) setStaff(rows);
      } catch {
        /* names optional */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [listStaff]);

  const staffById = useMemo(() => {
    const map = new Map<number, StaffMember>();
    for (const s of staff) map.set(s.id, s);
    return map;
  }, [staff]);

  const assigneeNameOf = useMemo(
    () => (o: WorkOrder) => {
      if (o.assigned_staff_id == null) return null;
      const s = staffById.get(o.assigned_staff_id);
      return s ? staffDisplayName(s) || null : null;
    },
    [staffById],
  );

  const counts = useMemo(() => {
    let needs = 0;
    let active = 0;
    let completed = 0;
    let emergency = 0;
    for (const o of orders) {
      const tab = staffQueueTab(o.status, Boolean(o.assigned_staff_id));
      if (tab === "needs") needs++;
      else if (tab === "active") active++;
      else completed++;
      if (o.priority === "urgent" && o.status !== "closed") emergency++;
    }
    return { needs, active, completed, open: needs + active, all: orders.length, emergency };
  }, [orders]);

  const focusFilter = useMemo(() => queryMaintenanceFocus(search), [search]);

  const filtered = useMemo(() => {
    let list = orders;
    if (staffTab !== "all") {
      list = list.filter(
        (o) => staffQueueTab(o.status, Boolean(o.assigned_staff_id)) === staffTab,
      );
    }
    if (propertyFilter !== "all") {
      const pid = Number(propertyFilter);
      list = list.filter((o) => o.property_id === pid);
    }
    if (assigneeFilter !== "all") {
      if (assigneeFilter === "unassigned") {
        list = list.filter((o) => o.assigned_staff_id == null);
      } else {
        const sid = Number(assigneeFilter);
        list = list.filter((o) => o.assigned_staff_id === sid);
      }
    }
    if (focusFilter === "unassigned") {
      list = list.filter((o) => o.status === "open" && !o.assigned_staff_id);
    } else if (focusFilter === "urgent") {
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
    return sort
      ? sortRequests(list, sort, assigneeNameOf)
      : sortRecommended(list, RECOMMENDED[staffTab]);
  }, [
    orders,
    staffTab,
    propertyFilter,
    assigneeFilter,
    query,
    focusFilter,
    sort,
    assigneeNameOf,
  ]);

  const thumbnails = useRequestThumbnails(useMemo(() => filtered.map((o) => o.id), [filtered]));

  const items: RequestListItem[] = useMemo(
    () =>
      filtered.map((o) => ({
        order: o,
        context: adminContext(o),
        assigneeName: assigneeNameOf(o),
      })),
    [filtered, assigneeNameOf],
  );

  const meta = [
    `${counts.needs} new`,
    counts.emergency > 0 ? `${counts.emergency} emergency` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const filtersActive =
    propertyFilter !== "all" ||
    assigneeFilter !== "all" ||
    query.trim().length > 0 ||
    focusFilter != null;

  function openOrder(w: WorkOrder) {
    if (navigate) {
      navigate(`/maintenance/${w.id}`);
      return;
    }
    window.location.assign(`/maintenance/${w.id}`);
  }

  function openNewRequest() {
    setDialogOpen(true);
  }

  function selectStaffTab(tab: StaffTab) {
    setStaffTab(tab);
    if (focusFilter) replace?.("/maintenance");
  }

  /** Filtered-empty "Clear filter": resets search, filters and tab. */
  function clearFilters() {
    setPropertyFilter("all");
    setAssigneeFilter("all");
    setQuery("");
    setStaffTab("all");
    if (focusFilter) replace?.("/maintenance");
  }

  const canCreate = app.canCreateWorkOrders;

  function tabEmptyMessage(): string {
    switch (staffTab) {
      case "needs":
        return "Nothing needs action right now.";
      case "active":
        return "No active requests right now.";
      case "completed":
        return "No completed requests yet.";
      default:
        return "No maintenance requests yet.";
    }
  }

  function body() {
    if (loading) return <RequestListSkeleton />;
    if (listError) {
      return <ErrorRetry message={LIST_ERROR} onRetry={() => void load()} />;
    }
    if (orders.length === 0) {
      return (
        <div className="rounded-md border border-border bg-card">
          <EmptyState
            icon={<Inbox className="size-5" aria-hidden />}
            message="No maintenance requests yet. They will appear here as soon as a tenant or your team reports one."
            actionLabel={canCreate ? "New request" : undefined}
            onAction={canCreate ? openNewRequest : undefined}
          />
        </div>
      );
    }
    if (filtered.length === 0) {
      return (
        <div className="rounded-md border border-border bg-card">
          {filtersActive ? (
            <EmptyState
              icon={<SearchX className="size-5" aria-hidden />}
              message="Nothing matches this filter"
              filtered
              onClear={clearFilters}
            />
          ) : (
            <EmptyState icon={<Inbox className="size-5" aria-hidden />} message={tabEmptyMessage()} />
          )}
        </div>
      );
    }
    return (
      <RequestListTable
        items={items}
        onOpen={openOrder}
        thumbnails={thumbnails}
        dateColumn="opened"
        sort={sort}
        onSortChange={setSort}
        ariaLabel="Maintenance requests"
      />
    );
  }

  const propertySelect = (
    <Select value={propertyFilter} onValueChange={setPropertyFilter}>
      <SelectTrigger
        className="h-11 w-full text-sm md:h-8 md:w-auto md:min-w-[9rem]"
        aria-label="Filter by property"
      >
        <SelectValue placeholder="All properties" />
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
  );

  return (
    <PageShell
      title="Maintenance"
      meta={loading || listError ? undefined : meta}
      width="max-w-none"
      actions={
        canCreate ? (
          <Button variant="brand" size="header" className="hidden md:inline-flex" onClick={openNewRequest}>
            <Plus className="h-4 w-4" /> New request
          </Button>
        ) : null
      }
    >
      <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center">
        {/* Phone: one row that scrolls sideways instead of wrapping "All" onto its own line. */}
        <div
          className="-mx-6 -my-1 flex gap-2 overflow-x-auto px-6 py-1 [scrollbar-width:none] md:mx-0 md:my-0 md:py-0 md:flex-wrap md:overflow-visible md:px-0 [&>*]:shrink-0"
          aria-label="Request queue"
        >
          <RequestListTab
            label={loading || listError ? "Needs action" : `Needs action (${counts.needs})`}
            active={staffTab === "needs"}
            onClick={() => selectStaffTab("needs")}
          />
          <RequestListTab
            label="Active"
            active={staffTab === "active"}
            onClick={() => selectStaffTab("active")}
          />
          <RequestListTab
            label="Completed"
            active={staffTab === "completed"}
            onClick={() => selectStaffTab("completed")}
          />
          <RequestListTab label="All" active={staffTab === "all"} onClick={() => selectStaffTab("all")} />
        </div>
        <div className="hidden flex-1 md:block" />
        <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center">
          <Input
            type="search"
            className="h-11 w-full text-sm md:h-8 md:w-[280px]"
            placeholder="Search title or request number"
            aria-label="Search title or request number"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {propertySelect}
          <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
            <SelectTrigger
              className="h-11 w-full text-sm md:h-8 md:w-auto md:min-w-[9rem]"
              aria-label="Filter by assignee"
            >
              <SelectValue placeholder="Any assignee" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any assignee</SelectItem>
              <SelectItem value="unassigned">Not assigned</SelectItem>
              {staff.map((s) => (
                <SelectItem key={s.id} value={String(s.id)}>
                  {staffDisplayName(s)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <RequestSortMenu sort={sort} onSortChange={setSort} className="h-11 w-full md:h-8 md:w-auto" />
        </div>
      </div>

      {body()}

      {canCreate ? (
        // Phone: primary action as a sticky full-width bar (spec §6.2).
        <div className="sticky bottom-0 -mx-6 border-t border-border bg-background px-4 py-3 md:hidden">
          <Button variant="brand" size="touch" className="w-full" onClick={openNewRequest}>
            <Plus className="h-4 w-4" /> New request
          </Button>
        </div>
      ) : null}

      {canCreate ? (
        <AdminNewRequestDialog
          open={dialogOpen}
          onOpenChange={(o) => {
            setDialogOpen(o);
            if (!o) void load();
          }}
        />
      ) : null}
    </PageShell>
  );
}
