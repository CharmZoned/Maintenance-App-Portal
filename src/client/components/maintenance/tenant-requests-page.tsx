import { useEffect, useMemo, useRef, useState } from "react";
import { Inbox, Plus } from "lucide-react";
import { useApp } from "@/context";
import { createSingleFlightLoader, type DeepLinkProps } from "@/lib/deep-link";
import { useDeepLinkOpen } from "@/hooks/use-deep-link-open";
import type { StaffMember } from "@/lib/data";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/page-shell";
import { EmptyState, ErrorRetry } from "@/components/patterns";
import type { TenantHomeContext, WorkOrder } from "@/types";
import { TenantSubmitDialog } from "./tenant-submit-dialog";
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
  type RequestSort,
} from "./request-list-sort";

type TenantTab = "open" | "completed";

const LIST_ERROR = "We couldn't load the requests. Check your connection and try again.";
const SORT_KEY = "maintenance-list-sort:tenant";

/** Tenant context: `#MR-001002 · Plumbing`. */
function tenantContext(o: WorkOrder): string {
  const raw = o.request_number?.trim();
  const number = raw ? (raw.startsWith("#") ? raw : `#${raw}`) : null;
  return [number, o.category || null].filter(Boolean).join(" · ") || "—";
}

/**
 * Tenant Requests (spec §6, U8). Same shared request row as every other role;
 * one click opens the full request page — no split preview panel.
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
  const [tab, setTab] = useState<TenantTab>("open");
  const [submitOpen, setSubmitOpen] = useState(false);
  const [home, setHome] = useState<TenantHomeContext | null>(null);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [sort, setSortState] = useState<RequestSort | null>(() => readStoredSort(SORT_KEY));
  /** Skip the dialog-close reload when onSaved already refreshed. */
  const skipCloseReloadRef = useRef(false);
  /** True after at least one successful list fetch — failed refreshes keep rows. */
  const hasLoadedOnceRef = useRef(false);
  const ordersRef = useRef(orders);
  ordersRef.current = orders;

  function setSort(next: RequestSort | null) {
    setSortState(next);
    writeStoredSort(SORT_KEY, next);
  }

  const listWorkOrders = app.listWorkOrders;
  const setError = app.setError;
  const flight = useMemo(
    () => createSingleFlightLoader(() => listWorkOrders()),
    [listWorkOrders],
  );

  /**
   * Fetch the list. Initial failure shows the designed error state.
   * Background refresh failure keeps current rows (banner via setError only).
   */
  async function load(): Promise<WorkOrder[]> {
    const isInitial = !hasLoadedOnceRef.current;
    if (isInitial) setLoading(true);
    try {
      const list = await flight.load();
      setListError(null);
      setOrders(list);
      hasLoadedOnceRef.current = true;
      return list;
    } catch (err) {
      const message = (err as Error).message;
      if (!hasLoadedOnceRef.current) {
        setListError(message || LIST_ERROR);
        setOrders([]);
        return [] as WorkOrder[];
      }
      setError(message);
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
        setOrders(list);
        hasLoadedOnceRef.current = true;
      } catch (err) {
        if (cancelled) return;
        if (!hasLoadedOnceRef.current) {
          setListError((err as Error).message || LIST_ERROR);
          setOrders([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [flight]);

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

  // Tenants can read the worker assigned to their own requests (RLS), so the
  // list shows the worker's name instead of "Assigned (staff)".
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

  const go = (to: string) => {
    if (navigate) navigate(to);
    else window.location.assign(to);
  };

  // Old `?wo=` links now open the full request page directly.
  useDeepLinkOpen({
    search,
    param: "wo",
    items: orders,
    loadList: () => flight.load(),
    onList: setOrders,
    onFound: (found) => go(`/maintenance/${found.id}`),
    onMiss: () => replace?.("/maintenance"),
  });

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

  const openCount = useMemo(() => orders.filter((o) => o.status !== "closed").length, [orders]);
  const completedCount = orders.length - openCount;

  const filtered = useMemo(() => {
    const list =
      tab === "completed"
        ? orders.filter((o) => o.status === "closed")
        : orders.filter((o) => o.status !== "closed");
    return sort ? sortRequests(list, sort, assigneeNameOf) : sortRecommended(list, "newest");
  }, [orders, tab, sort, assigneeNameOf]);

  const thumbnails = useRequestThumbnails(useMemo(() => filtered.map((o) => o.id), [filtered]));

  const items: RequestListItem[] = useMemo(
    () =>
      filtered.map((o) => ({
        order: o,
        context: tenantContext(o),
        assigneeName: assigneeNameOf(o),
      })),
    [filtered, assigneeNameOf],
  );

  const noUnit = home != null && home.unit_id == null;
  const canReport = !noUnit;

  function openRequest(w: WorkOrder) {
    go(`/maintenance/${w.id}`);
  }

  function body() {
    if (loading) return <RequestListSkeleton />;
    if (listError) return <ErrorRetry message={LIST_ERROR} onRetry={() => void load()} />;
    if (filtered.length === 0) {
      const completedEmpty = tab === "completed";
      return (
        <div className="rounded-md border border-border bg-card">
          <EmptyState
            icon={<Inbox className="size-5" aria-hidden />}
            message={
              completedEmpty
                ? "No completed requests yet."
                : "Nothing open. Report a problem if something needs fixing."
            }
            actionLabel={!completedEmpty && canReport ? "Report a problem" : undefined}
            onAction={!completedEmpty && canReport ? () => setSubmitOpen(true) : undefined}
          />
        </div>
      );
    }
    return (
      <RequestListTable
        items={items}
        onOpen={openRequest}
        thumbnails={thumbnails}
        dateColumn="reported"
        sort={sort}
        onSortChange={setSort}
        ariaLabel="Your maintenance requests"
      />
    );
  }

  return (
    <PageShell
      title="Requests"
      meta={loading ? undefined : `${openCount} open`}
      width="max-w-none"
      actions={
        <Button
          variant="brand"
          size="header"
          className="hidden md:inline-flex"
          onClick={() => setSubmitOpen(true)}
          disabled={!canReport}
          title={noUnit ? "Ask staff to assign a unit first" : undefined}
        >
          <Plus className="h-4 w-4" /> Report a problem
        </Button>
      }
    >
      {noUnit ? (
        <p className="rounded-sm bg-warning-tint px-3 py-2 text-sm text-warning" role="note">
          Your account isn’t linked to a unit yet. Ask staff to assign a unit before reporting a
          problem.
        </p>
      ) : null}

      <div className="flex flex-col gap-2 md:flex-row md:items-center">
        <div className="flex flex-wrap gap-2" aria-label="Request status">
          <RequestListTab label="Open" active={tab === "open"} onClick={() => setTab("open")} />
          <RequestListTab
            label={completedCount > 0 ? `Completed (${completedCount})` : "Completed"}
            active={tab === "completed"}
            onClick={() => setTab("completed")}
          />
        </div>
        <div className="hidden flex-1 md:block" />
        <RequestSortMenu sort={sort} onSortChange={setSort} className="h-11 w-full md:h-8 md:w-auto" />
      </div>

      {body()}

      <aside className="rounded-sm bg-warning-tint px-4 py-3 text-sm text-warning" role="note">
        <span className="font-medium">Immediate danger?</span> Contact local emergency services. Do
        not wait for a portal response.
      </aside>

      {/* Phone: primary action as a sticky bar above the bottom tabs (spec §6.2). */}
      <div className="sticky bottom-0 -mx-6 border-t border-border bg-background px-4 py-3 md:hidden">
        <Button
          variant="brand"
          size="touch"
          className="w-full"
          onClick={() => setSubmitOpen(true)}
          disabled={!canReport}
        >
          <Plus className="h-4 w-4" /> Report a problem
        </Button>
      </div>

      <TenantSubmitDialog
        open={submitOpen}
        onOpenChange={(o, meta) => {
          setSubmitOpen(o);
          if (!o) {
            if (meta?.skipReload || skipCloseReloadRef.current) {
              skipCloseReloadRef.current = false;
              return;
            }
            void load();
          }
        }}
        onSaved={async (created) => {
          skipCloseReloadRef.current = true;
          setTab("open");
          // Optimistic insert so the new request shows at once.
          setOrders((prev) =>
            prev.some((o) => o.id === created.id) ? prev : [created, ...prev],
          );
          const list = await load();
          if (!list.some((o) => o.id === created.id)) {
            setOrders((prev) =>
              prev.some((o) => o.id === created.id) ? prev : [created, ...prev],
            );
          }
        }}
      />
    </PageShell>
  );
}
