import { useEffect, useMemo, useState } from "react";
import { ArrowDownUp, ChevronDown, ChevronRight, ChevronUp, Image as ImageIcon, Wrench } from "lucide-react";
import { useApp } from "@/context";
import { createSingleFlightLoader, queryId, type DeepLinkProps } from "@/lib/deep-link";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState, ErrorRetry, PriorityChip, StatusChip } from "@/components/patterns";
import {
  formatActivityStamp,
  jobSectionFor,
  parseWhenDate,
  priorityLevel,
  REQUEST_STATUSES,
  requestNextStep,
  toRequestStatus,
  type JobSection,
} from "@/lib/request-status";
import { cn } from "@/lib/utils";
import type { WorkOrder } from "@/types";
import { useRequestThumbnails } from "./request-list-row";

/**
 * Maintenance worker home: Figma Worker / U7 My jobs (spec §6, worker column).
 *
 * Sections Today / Upcoming / On hold / Recently completed, each a card of rows.
 * One tap on a row opens the ONE request page (/maintenance/:id), where the
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

const DEFAULT_SORT: JobSort = { key: "scheduled", dir: "asc" };
const SORT_STORAGE_KEY = "my-jobs.sort";
const SORT_KEYS: readonly JobSortKey[] = ["scheduled", "title", "status", "priority"];

function readSort(): JobSort {
  try {
    const raw = window.localStorage.getItem(SORT_STORAGE_KEY);
    if (!raw) return DEFAULT_SORT;
    const parsed = JSON.parse(raw) as Partial<JobSort>;
    if (parsed && SORT_KEYS.includes(parsed.key as JobSortKey) && (parsed.dir === "asc" || parsed.dir === "desc")) {
      return { key: parsed.key as JobSortKey, dir: parsed.dir };
    }
  } catch {
    // Private window / blocked storage: fall back to the default.
  }
  return DEFAULT_SORT;
}

function writeSort(sort: JobSort): void {
  try {
    window.localStorage.setItem(SORT_STORAGE_KEY, JSON.stringify(sort));
  } catch {
    // Not persisted; the choice still applies for this visit.
  }
}

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
  const status = toRequestStatus(order);
  const step = requestNextStep(order, { assigneeName: null });
  if (!step || step === status) {
    return status === "Assigned" ? "Not scheduled yet" : undefined;
  }
  return step;
}

/** Scheduled day for the date column ("Today", "Tue 17 Nov"), or "". */
export function jobScheduledLabel(order: Pick<WorkOrder, "scheduled_at">): string {
  return formatActivityStamp(order.scheduled_at);
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

/** Group into the four My jobs sections, in display order; empty sections are dropped. */
export function groupJobs(
  orders: readonly WorkOrder[],
  sort: JobSort,
  now: Date,
): { label: JobSection; items: WorkOrder[] }[] {
  const groups: Record<JobSection, WorkOrder[]> = {
    Today: [],
    Upcoming: [],
    "On hold": [],
    "Recently completed": [],
  };
  for (const o of orders) groups[jobSectionFor(o, now)].push(o);
  // Only the five most recently completed jobs (by completion, not creation).
  groups["Recently completed"] = [...groups["Recently completed"]]
    .sort((a, b) => (timeOf(b.completed_at ?? b.created_at) ?? 0) - (timeOf(a.completed_at ?? a.created_at) ?? 0))
    .slice(0, 5);
  return (Object.keys(groups) as JobSection[])
    .map((label) => ({ label, items: sortJobs(groups[label], sort) }))
    .filter((g) => g.items.length > 0);
}

// ── Thumbnails ─────────────────────────────────────────────────────

/** First photo of each listed job: the shared batched hook (one query per batch). */
function useJobThumbnails(orders: readonly WorkOrder[]): ReadonlyMap<number, string | null> {
  const ids = useMemo(() => orders.map((o) => o.id), [orders]);
  return useRequestThumbnails(ids);
}

function JobThumbnail({ url, className }: { url?: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-sm border border-border bg-muted",
        className,
      )}
      aria-hidden
    >
      {url && !failed ? (
        <img src={url} alt="" className="size-full object-cover" onError={() => setFailed(true)} />
      ) : (
        <ImageIcon className="size-4 text-muted-foreground" />
      )}
    </span>
  );
}

// ── Rows ───────────────────────────────────────────────────────────

const DESKTOP_GRID = "lg:grid lg:grid-cols-[40px_minmax(0,1fr)_minmax(220px,auto)_120px_16px] lg:gap-3";

function JobRow({ order, thumbnailUrl, onOpen }: { order: WorkOrder; thumbnailUrl?: string; onOpen: () => void }) {
  const status = toRequestStatus(order);
  const priority = priorityLevel(order.priority);
  const next = jobNextStep(order);
  const context = jobContextLine(order);
  const scheduled = jobScheduledLabel(order);
  return (
    <li className="border-b border-border last:border-b-0">
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "flex min-h-[60px] w-full items-center gap-3 px-4 py-3 text-left outline-none transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/40",
          DESKTOP_GRID,
        )}
      >
        <JobThumbnail url={thumbnailUrl} className="size-12 lg:size-10" />

        <span className="flex min-w-0 flex-1 flex-col gap-1 lg:gap-0">
          <span className="truncate text-[15px] font-semibold leading-[22px] text-foreground">{order.title}</span>
          {context ? <span className="truncate text-sm leading-5 text-muted-foreground">{context}</span> : null}
          {/* Phone / tablet: status, priority and date stack under the title. */}
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 lg:hidden">
            <StatusChip status={status} />
            {next ? <span className="text-sm leading-5 text-muted-foreground">{next}</span> : null}
          </span>
          {priority ? (
            <span className="lg:hidden">
              <PriorityChip level={priority} />
            </span>
          ) : null}
          <span className="text-xs leading-4 text-muted-foreground lg:hidden">
            {scheduled ? `Scheduled ${scheduled}` : "Not scheduled yet"}
          </span>
        </span>

        <span className="hidden min-w-0 flex-wrap items-center gap-x-2 gap-y-1 lg:flex">
          {priority ? <PriorityChip level={priority} /> : null}
          <StatusChip status={status} />
          {next ? <span className="truncate text-sm leading-5 text-muted-foreground">{next}</span> : null}
        </span>

        <span className="hidden text-right text-sm leading-5 text-muted-foreground lg:block">
          {scheduled || "Not scheduled"}
        </span>

        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </button>
    </li>
  );
}

function SortHeader({
  label,
  sortKey,
  sort,
  onSort,
  className,
}: {
  label: string;
  sortKey: JobSortKey;
  sort: JobSort;
  onSort: (key: JobSortKey) => void;
  className?: string;
}) {
  const active = sort.key === sortKey;
  const Icon = sort.dir === "asc" ? ChevronUp : ChevronDown;
  const state = active ? (sort.dir === "asc" ? ", sorted ascending" : ", sorted descending") : "";
  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        aria-label={`Sort by ${label}${state}`}
        className="inline-flex items-center gap-1 rounded-sm outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40"
      >
        {label}
        {active ? <Icon className="size-3.5" aria-hidden /> : null}
      </button>
    </div>
  );
}

function JobsCard({
  label,
  items,
  thumbnails,
  sort,
  onSort,
  onOpen,
}: {
  label: JobSection;
  items: WorkOrder[];
  thumbnails: ReadonlyMap<number, string | null>;
  sort: JobSort;
  onSort: (key: JobSortKey) => void;
  onOpen: (order: WorkOrder) => void;
}) {
  const headingId = `my-jobs-${label.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} className="text-[15px] font-semibold leading-[22px] text-foreground">
        {label} <span className="font-normal text-muted-foreground">· {items.length}</span>
      </h2>
      <div className="w-full overflow-hidden rounded-md border border-border bg-card">
        <div
          className={cn(
            "hidden h-11 items-center border-b border-border px-4 text-[13px] font-medium leading-[18px] text-muted-foreground",
            DESKTOP_GRID,
            "lg:grid",
          )}
        >
          <div aria-hidden />
          <SortHeader label="Request" sortKey="title" sort={sort} onSort={onSort} />
          <SortHeader label="Status" sortKey="status" sort={sort} onSort={onSort} />
          <SortHeader label="Scheduled" sortKey="scheduled" sort={sort} onSort={onSort} className="text-right" />
          <div aria-hidden />
        </div>
        <ul>
          {items.map((o) => (
            <JobRow key={o.id} order={o} thumbnailUrl={thumbnails.get(o.id) ?? undefined} onOpen={() => onOpen(o)} />
          ))}
        </ul>
      </div>
    </section>
  );
}

const PHONE_SORTS: { label: string; sort: JobSort }[] = [
  { label: "Soonest first", sort: { key: "scheduled", dir: "asc" } },
  { label: "Latest first", sort: { key: "scheduled", dir: "desc" } },
  { label: "Priority", sort: { key: "priority", dir: "asc" } },
  { label: "Status", sort: { key: "status", dir: "asc" } },
];

function PhoneSortMenu({ sort, onChange }: { sort: JobSort; onChange: (sort: JobSort) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="touch" className="lg:hidden">
          <ArrowDownUp aria-hidden />
          Sort
          <ChevronDown aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[12rem]">
        {PHONE_SORTS.map((option) => {
          const current = option.sort.key === sort.key && option.sort.dir === sort.dir;
          return (
            <DropdownMenuItem
              key={option.label}
              onSelect={() => onChange(option.sort)}
              className={cn("min-h-11", current && "font-semibold")}
            >
              {option.label}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function JobsLoading() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading jobs">
      <div className="h-[22px] w-24 rounded-xs bg-muted" />
      <div className="overflow-hidden rounded-md border border-border bg-card">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0" aria-hidden>
            <div className="size-12 shrink-0 rounded-sm bg-muted lg:size-10" />
            <div className="flex flex-1 flex-col gap-2">
              <div className="h-3 w-[200px] max-w-full rounded-xs bg-muted" />
              <div className="h-2.5 w-[140px] max-w-[70%] rounded-xs bg-muted" />
            </div>
            <div className="hidden h-[18px] w-16 shrink-0 rounded-xs bg-muted lg:block" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────

export function MyJobsPage({ search = "", replace, navigate }: MyJobsPageProps = {}) {
  const app = useApp();
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState(false);
  const [sort, setSortState] = useState<JobSort>(readSort);

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

  function setSort(next: JobSort) {
    setSortState(next);
    writeSort(next);
  }

  function toggleSort(key: JobSortKey) {
    setSort(sort.key === key ? { key, dir: sort.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" });
  }

  const now = useMemo(() => new Date(), [orders]);
  const sections = useMemo(() => groupJobs(orders, sort, now), [orders, sort, now]);
  const shown = useMemo(() => sections.flatMap((s) => s.items), [sections]);
  const thumbnails = useJobThumbnails(shown);

  const openCount = orders.filter((o) => o.status !== "closed").length;
  const todayCount = sections.find((s) => s.label === "Today")?.items.length ?? 0;
  const meta =
    loading || listError
      ? undefined
      : openCount === 0
        ? "No open jobs"
        : todayCount > 0
          ? `${todayCount} today`
          : `${openCount} open`;

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
          <div className="flex justify-end lg:hidden">
            <PhoneSortMenu sort={sort} onChange={setSort} />
          </div>
          {sections.map((section) => (
            <JobsCard
              key={section.label}
              label={section.label}
              items={section.items}
              thumbnails={thumbnails}
              sort={sort}
              onSort={toggleSort}
              onOpen={openJob}
            />
          ))}
        </div>
      )}
    </PageShell>
  );
}
