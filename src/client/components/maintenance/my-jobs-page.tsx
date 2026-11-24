import { useEffect, useMemo, useState } from "react";
import { Wrench } from "lucide-react";
import { useApp } from "@/context";
import { createSingleFlightLoader, queryId, type DeepLinkProps } from "@/lib/deep-link";
import { PageShell } from "@/components/page-shell";
import { EmptyState, ErrorRetry } from "@/components/patterns";
import {
  JOB_SECTIONS,
  jobSectionFor,
  parseWhenDate,
  REQUEST_STATUSES,
  requestNextStep,
  toRequestStatus,
  type JobSection,
} from "@/lib/request-status";
import type { WorkOrder } from "@/types";
import {
  RequestListSkeleton,
  RequestListTable,
  RequestSortMenu,
  scheduledDayFor,
  useRequestThumbnails,
  visitMissed,
  type RequestListItem,
} from "./request-list-row";
import {
  readStoredSort,
  sortRecommended,
  sortRequests,
  writeStoredSort,
  type RequestSort,
} from "./request-list-sort";

/**
 * Maintenance worker home: Figma Worker / U7 My jobs (spec §6, worker column).
 *
 * Sections Today / Upcoming / Job offers / On hold / Recently completed, each a
 * card built from the shared RequestListTable (so every section's columns line
 * up). One tap on a row opens the ONE request page (/maintenance/:id), where the
 * worker has Start work / Put on hold / Mark completed. The old "Edit work
 * order" dialog is no longer used for workers. `?wo=<id>` deep links (calendar,
 * notifications, messages) redirect to the same page.
 */

export interface MyJobsPageProps extends DeepLinkProps {
  /** Push navigation (row tap → request page). */
  navigate?: (to: string) => void;
}

export type JobSortKey = "scheduled" | "title" | "status" | "priority";
export interface JobSort {
  key: JobSortKey;
  dir: "asc" | "desc";
}

const SORT_STORAGE_KEY = "my-jobs.sort.v2";

/** Request page path for a job (numeric id, never the request number). */
export function jobPath(order: Pick<WorkOrder, "id">): string {
  return `/maintenance/${order.id}`;
}

/** `Maple Court · Unit 1A · Tina Renter · OK to enter if absent` */
export function jobContextLine(order: WorkOrder): string {
  const parts: string[] = [];
  if (order.property_name?.trim()) parts.push(order.property_name.trim());
  if (order.unit_name?.trim()) parts.push(`Unit ${order.unit_name.trim()}`);
  else if (order.property_name?.trim()) parts.push("Common area");
  const tenant = [order.tenant_first_name, order.tenant_last_name].filter(Boolean).join(" ").trim();
  if (tenant) parts.push(tenant);
  if (order.permission_to_enter) parts.push("OK to enter if absent");
  return parts.join(" · ");
}

/** Next step beside the chip. The worker is always the assignee, so no name. */
export function jobNextStep(order: WorkOrder): string | undefined {
  return requestNextStep(order, { omitAssignee: true });
}

/** Scheduled day for the date column ("Today", "Tue 17 Nov"), or "" (never for an unaccepted offer). */
export function jobScheduledLabel(order: WorkOrder): string {
  return scheduledDayFor(order);
}

const PRIORITY_RANK: Record<WorkOrder["priority"], number> = { urgent: 0, high: 1, normal: 2, low: 3 };

function timeOf(iso: string | null | undefined): number | null {
  if (!iso) return null;
  return parseWhenDate(iso)?.getTime() ?? null;
}

/** Sort rows within a section. Unscheduled jobs sort after scheduled ones either way. */
export function sortJobs(orders: readonly WorkOrder[], sort: JobSort): WorkOrder[] {
  const sign = sort.dir === "asc" ? 1 : -1;
  return [...orders].sort((a, b) => {
    let diff = 0;
    switch (sort.key) {
      case "scheduled": {
        const ta = timeOf(a.scheduled_at);
        const tb = timeOf(b.scheduled_at);
        if (ta == null && tb != null) return 1;
        if (tb == null && ta != null) return -1;
        diff = (ta ?? 0) - (tb ?? 0);
        break;
      }
      case "title":
        diff = a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
        break;
      case "status":
        diff = REQUEST_STATUSES.indexOf(toRequestStatus(a)) - REQUEST_STATUSES.indexOf(toRequestStatus(b));
        break;
      case "priority":
        diff = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
        break;
    }
    if (diff !== 0) return diff * sign;
    return a.id - b.id;
  });
}

/** Group into the My jobs sections, in display order; empty sections are dropped. */
export function groupJobsWith(
  orders: readonly WorkOrder[],
  sortSection: (items: readonly WorkOrder[]) => WorkOrder[],
  now: Date,
): { label: JobSection; items: WorkOrder[] }[] {
  const groups = new Map<JobSection, WorkOrder[]>(JOB_SECTIONS.map((label) => [label, []]));
  for (const o of orders) groups.get(jobSectionFor(o, now))!.push(o);
  // Only the five most recently completed jobs (by completion, not creation).
  groups.set(
    "Recently completed",
    [...groups.get("Recently completed")!]
      .sort((a, b) => (timeOf(b.completed_at ?? b.created_at) ?? 0) - (timeOf(a.completed_at ?? a.created_at) ?? 0))
      .slice(0, 5),
  );
  return JOB_SECTIONS.map((label) => ({ label, items: sortSection(groups.get(label)!) })).filter(
    (g) => g.items.length > 0,
  );
}

export function groupJobs(
  orders: readonly WorkOrder[],
  sort: JobSort,
  now: Date,
): { label: JobSection; items: WorkOrder[] }[] {
  return groupJobsWith(orders, (items) => sortJobs(items, sort), now);
}

// ── Loading ────────────────────────────────────────────────────────

function JobsLoading() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading jobs">
      <div className="h-[22px] w-24 rounded-xs bg-muted" />
      <RequestListSkeleton />
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────

export function MyJobsPage({ search = "", replace, navigate }: MyJobsPageProps = {}) {
  const app = useApp();
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState(false);
  const [sort, setSortState] = useState<RequestSort | null>(() => readStoredSort(SORT_STORAGE_KEY));

  const listWorkOrders = app.listWorkOrders;
  const flight = useMemo(() => createSingleFlightLoader(() => listWorkOrders()), [listWorkOrders]);

  async function load() {
    setLoading(true);
    setListError(false);
    try {
      setOrders(await flight.load());
    } catch {
      setOrders([]);
      setListError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setListError(false);
      try {
        const list = await flight.load();
        if (!cancelled) setOrders(list);
      } catch {
        if (!cancelled) {
          setOrders([]);
          setListError(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [flight]);

  // `?wo=<id>` (calendar, notifications, messages): go straight to the request
  // page. Replace, so Back does not bounce through the redirect again. The page
  // itself shows "isn't available" for a job the worker cannot read.
  const deepLinkId = queryId(search, "wo");
  useEffect(() => {
    if (deepLinkId == null) return;
    const to = jobPath({ id: deepLinkId });
    if (replace) replace(to);
    else navigate?.(to);
  }, [deepLinkId, replace, navigate]);

  function openJob(order: WorkOrder) {
    const to = jobPath(order);
    if (navigate) navigate(to);
    else replace?.(to);
  }

  function setSort(next: RequestSort | null) {
    setSortState(next);
    writeStoredSort(SORT_STORAGE_KEY, next);
  }

  const now = useMemo(() => new Date(), [orders]);
  const sections = useMemo(
    () =>
      groupJobsWith(
        orders,
        // Recommended: by scheduled date within each section (spec §6.1).
        (items) => (sort ? sortRequests(items, sort) : sortRecommended(items, "scheduled")),
        now,
      ),
    [orders, sort, now],
  );
  const shown = useMemo(() => sections.flatMap((s) => s.items), [sections]);
  const thumbnails = useRequestThumbnails(useMemo(() => shown.map((o) => o.id), [shown]));

  const openCount = orders.filter((o) => o.status !== "closed").length;
  const todayItems = sections.find((s) => s.label === "Today")?.items ?? [];
  const todayCount = todayItems.length;
  // Earlier-day and earlier-today visits nobody started sit under Today, so
  // the count says how many of them are missed (each row says "(missed)").
  const missedCount = todayItems.filter((o) => visitMissed(o, now)).length;
  const mineOpen = orders.filter((o) => o.status !== "closed" && jobSectionFor(o, now) !== "Job offers").length;
  const meta =
    loading || listError
      ? undefined
      : openCount === 0
        ? "No open jobs"
        : todayCount > 0
          ? [`${todayCount} today`, missedCount > 0 ? `${missedCount} missed` : null].filter(Boolean).join(" · ")
          : mineOpen > 0
            ? `${mineOpen} open`
            : `${openCount} on offer`;

  return (
    <PageShell title="My jobs" meta={meta}>
      {loading ? (
        <JobsLoading />
      ) : listError ? (
        <ErrorRetry
          message="We couldn't load the requests. Check your connection and try again."
          onRetry={() => void load()}
        />
      ) : orders.length === 0 ? (
        <div className="rounded-md border border-border bg-card">
          <EmptyState icon={<Wrench className="size-5" aria-hidden />} message="No jobs assigned right now." />
        </div>
      ) : (
        <div className="flex w-full flex-col gap-6">
          <div className="flex justify-end">
            <RequestSortMenu sort={sort} onSortChange={setSort} className="h-11 md:h-8" />
          </div>
          {sections.map((section) => {
            const headingId = `my-jobs-${section.label.toLowerCase().replace(/\s+/g, "-")}`;
            const items: RequestListItem[] = section.items.map((order) => ({
              order,
              context: jobContextLine(order),
              assigneeName: null,
            }));
            return (
              <section key={section.label} aria-labelledby={headingId} className="flex flex-col gap-3">
                <h2 id={headingId} className="text-[15px] font-semibold leading-[22px] text-foreground">
                  {section.label} <span className="font-normal text-muted-foreground">· {section.items.length}</span>
                </h2>
                {section.label === "Job offers" ? (
                  <p className="-mt-1.5 text-sm leading-5 text-muted-foreground">
                    Offered to all workers. Open one to accept it.
                  </p>
                ) : null}
                <RequestListTable
                  items={items}
                  onOpen={openJob}
                  hrefFor={jobPath}
                  thumbnails={thumbnails}
                  showAssignee={false}
                  dateColumn="scheduled"
                  sort={sort}
                  onSortChange={setSort}
                  ariaLabel={`${section.label} jobs`}
                />
              </section>
            );
          })}
        </div>
      )}
    </PageShell>
  );
}
