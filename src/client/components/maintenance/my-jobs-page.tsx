import { useEffect, useMemo, useState } from "react";
import { Wrench } from "lucide-react";
import { useApp } from "@/context";
import { createSingleFlightLoader, type DeepLinkProps } from "@/lib/deep-link";
import { useDeepLinkOpen } from "@/hooks/use-deep-link-open";
import { formatDate } from "@/lib/utils";
import { PageShell } from "@/components/page-shell";
import {
  EmptyState,
  ErrorRetry,
  SkeletonRow,
  StatusChip,
  type RequestStatus,
} from "@/components/patterns";
import { WorkOrderDialog } from "./work-order-dialog";
import {
  formatRelativeWhen,
  formatScheduleWhen,
  jobSectionFor,
  parseWhenDate,
  toRequestStatus,
  type JobSection,
} from "./request-status";
import type { WorkOrder } from "@/types";

function compactContext(order: WorkOrder): string {
  const parts: string[] = [];
  if (order.property_name) parts.push(order.property_name);
  if (order.unit_name) parts.push(`Unit ${order.unit_name}`);
  if (order.priority === "urgent") parts.push("Emergency");
  if (order.status === "on_hold") {
    if (order.hold_reason) parts.push(order.hold_reason);
    if (order.next_follow_up_date) {
      parts.push(`follow-up ${formatDate(order.next_follow_up_date, { weekday: "short" })}`);
    }
  } else if (order.scheduled_at) {
    // Past-day schedules stay under Today — label Overdue, not "Yesterday".
    parts.push(formatScheduleWhen(order.scheduled_at));
  } else if (order.status === "closed" && order.completed_at) {
    parts.push(`Completed ${formatRelativeWhen(order.completed_at).toLowerCase()}`);
  }
  return parts.filter(Boolean).join(" · ") || "—";
}

function CompactJobRow({
  order,
  onClick,
}: {
  order: WorkOrder;
  onClick: () => void;
}) {
  const status: RequestStatus = toRequestStatus(order);
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[52px] w-full items-center gap-2 rounded-md border border-border bg-card px-3 py-2.5 text-left hover:bg-muted/60"
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium text-foreground">{order.title}</div>
        <div className="truncate text-[11px] text-muted-foreground">{compactContext(order)}</div>
      </div>
      <StatusChip status={status} className="shrink-0 [&_span]:text-[11px] [&_span]:py-[3px]" />
    </button>
  );
}

/**
 * Maintenance worker home — Figma Worker / U7 My jobs.
 * Groups assigned jobs into Today / Upcoming / On hold / Recently completed.
 */
export function MyJobsPage({ search = "", replace }: DeepLinkProps = {}) {
  const app = useApp();
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<WorkOrder | undefined>(undefined);

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

  async function load() {
    setLoading(true);
    try {
      setOrders(await flight.load());
    } catch {
      setOrders([]);
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
        if (!cancelled) setOrders(list);
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
      setEditing(found);
      setDialogOpen(true);
      replace?.("/maintenance");
    },
    onMiss: () => replace?.("/maintenance"),
  });

  const now = useMemo(() => new Date(), [orders]);
  const sections = useMemo(() => {
    const groups: Record<JobSection, WorkOrder[]> = {
      Today: [],
      Upcoming: [],
      "On hold": [],
      "Recently completed": [],
    };
    for (const o of orders) {
      groups[jobSectionFor(o, now)].push(o);
    }
    // Cap completed to most recently closed, not most recently created.
    groups["Recently completed"] = [...groups["Recently completed"]]
      .sort((a, b) => {
        const ta = parseWhenDate(a.completed_at ?? a.created_at)?.getTime() ?? 0;
        const tb = parseWhenDate(b.completed_at ?? b.created_at)?.getTime() ?? 0;
        return tb - ta;
      })
      .slice(0, 5);
    return (Object.keys(groups) as JobSection[])
      .map((label) => ({ label, items: groups[label] }))
      .filter((g) => g.items.length > 0);
  }, [orders, now]);

  const openCount = orders.filter((o) => o.status !== "closed").length;
  const todayCount = sections.find((s) => s.label === "Today")?.items.length ?? 0;
  const meta =
    openCount === 0
      ? "No open jobs"
      : todayCount > 0
        ? `Today · ${todayCount}`
        : `${openCount} open`;

  return (
    <PageShell title="My jobs" meta={meta}>
      {loading ? (
        <div className="space-y-2">
          <SkeletonRow className="h-[52px] rounded-md border border-border" />
          <SkeletonRow className="h-[52px] rounded-md border border-border" />
          <SkeletonRow className="h-[52px] rounded-md border border-border" />
        </div>
      ) : listError ? (
        <ErrorRetry message={listError} onRetry={() => void load()} />
      ) : orders.length === 0 ? (
        <EmptyState
          icon={<Wrench className="size-5" aria-hidden />}
          message="No jobs assigned yet. New work will show up here."
        />
      ) : (
        <div className="space-y-4">
          {sections.map((section) => (
            <section key={section.label} className="space-y-2">
              <h2 className="text-xs font-semibold text-muted-foreground">{section.label}</h2>
              <div className="space-y-2">
                {section.items.map((o) => (
                  <CompactJobRow
                    key={o.id}
                    order={o}
                    onClick={() => {
                      setEditing(o);
                      setDialogOpen(true);
                    }}
                  />
                ))}
              </div>
            </section>
          ))}
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
