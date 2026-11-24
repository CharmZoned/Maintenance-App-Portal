import { useContext, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { ArrowDownUp, Check, ChevronDown, ChevronRight, ChevronUp, ImageIcon } from "lucide-react";
import { AppContext, useApp } from "@/context";
import type { StaffMember } from "@/lib/data";
import type { WorkOrder } from "@/types";
import {
  formatActivityStamp,
  inProgressSince,
  priorityLevel,
  requestNextStep,
  toRequestStatus,
} from "@/lib/request-status";
import { initialsFromName } from "@/lib/portal-nav";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ListRow, PriorityChip, StatusChip } from "@/components/patterns";
import {
  SORT_PRESETS,
  nextSort,
  presetToSort,
  sortToPreset,
  type RequestSort,
  type RequestSortField,
} from "./request-list-sort";

/**
 * Shared request list (spec §6, Figma "UPGRADED — Lists" + owner additions).
 * One row for every role: photo thumbnail, title, context line, status with its
 * next step, assignee avatar + name, a date column, and a single click straight
 * to `/maintenance/:id`.
 *
 * Desktop (≥1024): table-like grid with a sortable column header.
 * Tablet (768–1023): same grid without the Assigned to column (the name goes
 * back into the next step). Phone (<768): stacked ListRow.
 */

// ── Small pieces ────────────────────────────────────────────────────

export function staffDisplayName(s: Pick<StaffMember, "first_name" | "last_name">): string {
  return [s.first_name, s.last_name].filter(Boolean).join(" ").trim();
}

/** 24px neutral initials avatar (spec §0). */
export function RequestAvatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-xs font-medium text-foreground",
        className,
      )}
    >
      {initialsFromName(name)}
    </span>
  );
}

/** Request photo thumbnail; neutral `image` placeholder when missing or broken. */
export function RequestThumb({
  url,
  size = "sm",
}: {
  url?: string | null;
  /** sm = 40px (desktop grid), md = 48px (phone row). */
  size?: "sm" | "md";
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  const box = size === "md" ? "size-12" : "size-10";
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-sm border border-border bg-muted",
        box,
      )}
      aria-hidden
    >
      {url && !failed ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          className="size-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <ImageIcon className="size-4 text-muted-foreground" strokeWidth={1.75} />
      )}
    </span>
  );
}

// ── Row model ───────────────────────────────────────────────────────

export interface RequestListItem {
  order: WorkOrder;
  /** Role-specific context line (place · tenant, `#MR · category`, …). */
  context: string;
  /** Resolved assignee name, or null when nobody is assigned / unreadable. */
  assigneeName: string | null;
}

export type RequestDateColumn = "opened" | "reported" | "scheduled";

const DATE_HEADER: Record<RequestDateColumn, string> = {
  opened: "Opened",
  reported: "Reported",
  scheduled: "Scheduled",
};

function lowerFirst(s: string): string {
  return /^(Today|Yesterday)\b/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

/** A New request (open, nobody assigned) is never "scheduled", whatever scheduled_at holds. */
export function scheduledDayFor(o: WorkOrder): string {
  if (!o.scheduled_at || toRequestStatus(o) === "New") return "";
  return formatActivityStamp(o.scheduled_at);
}

function dateValue(o: WorkOrder, col: RequestDateColumn): string {
  if (col === "scheduled") return scheduledDayFor(o) || "Not scheduled";
  return formatActivityStamp(o.created_at);
}

/**
 * Next-step words beside the status chip. `withName` is false for the desktop
 * grid, which has its own Assigned to column (spec §6.1). `startedAt` (when the
 * request last moved to In progress) gives "Started today", as on the page.
 */
export function listNextStep(
  o: WorkOrder,
  assigneeName: string | null,
  withName: boolean,
  startedAt?: string | null,
): string | undefined {
  return requestNextStep(o, { assigneeName, omitAssignee: !withName, startedAt });
}

function assigneeFallback(o: WorkOrder, name: string | null): string | null {
  if (name) return name;
  return o.assigned_staff_id != null ? "Assigned" : null;
}

// ── Toolbar ─────────────────────────────────────────────────────────

/** Toolbar tab (Needs action / Active / … or Open / Completed). 44px on phone. */
export function RequestListTab({
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
        "inline-flex min-h-11 items-center whitespace-nowrap rounded-sm px-3 text-[13px] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 md:min-h-8",
        active
          ? "bg-brand-tint font-medium text-brand-text"
          : "border border-border font-normal text-muted-foreground hover:bg-muted",
      )}
    >
      {label}
    </button>
  );
}

// ── Sort controls ───────────────────────────────────────────────────

function SortHeader({
  label,
  field,
  sort,
  onSortChange,
  align = "start",
  className,
}: {
  label: string;
  field: RequestSortField;
  sort: RequestSort | null;
  onSortChange: (s: RequestSort) => void;
  align?: "start" | "end";
  className?: string;
}) {
  const active = sort?.field === field;
  const dirWords =
    field === "created" || field === "scheduled"
      ? sort?.dir === "desc"
        ? "newest first"
        : "oldest first"
      : sort?.dir === "desc"
        ? "descending"
        : "ascending";
  return (
    <div
      role="columnheader"
      aria-sort={active ? (sort?.dir === "desc" ? "descending" : "ascending") : "none"}
      className={cn("flex min-w-0", align === "end" && "justify-end", className)}
    >
      <button
        type="button"
        onClick={() => onSortChange(nextSort(sort, field))}
        aria-label={active ? `${label}, sorted ${dirWords}. Activate to reverse.` : `Sort by ${label}`}
        className={cn(
          "-mx-1 inline-flex items-center gap-1 rounded-xs px-1 py-0.5 text-[13px] font-medium leading-[18px] outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40",
          active ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
        {active ? (
          sort?.dir === "desc" ? (
            <ChevronDown className="size-3.5" aria-hidden />
          ) : (
            <ChevronUp className="size-3.5" aria-hidden />
          )
        ) : null}
      </button>
    </div>
  );
}

/** `Sort ▾` menu for the toolbar (always available; the only sort control on phone). */
export function RequestSortMenu({
  sort,
  onSortChange,
  className,
}: {
  sort: RequestSort | null;
  /** null = the tab's recommended order. */
  onSortChange: (s: RequestSort | null) => void;
  className?: string;
}) {
  const current = sortToPreset(sort);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" className={cn("h-8 md:h-8", className)}>
          <ArrowDownUp aria-hidden />
          Sort
          <ChevronDown aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[11rem]">
        {SORT_PRESETS.map((p) => (
          <DropdownMenuItem
            key={p.value}
            className="min-h-11 md:min-h-0"
            onSelect={() => onSortChange(presetToSort(p.value))}
          >
            <Check className={cn(current === p.value ? "opacity-100" : "opacity-0")} aria-hidden />
            {p.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── The list card ───────────────────────────────────────────────────

export interface RequestListTableProps {
  items: readonly RequestListItem[];
  /** In-app navigation for a plain click; the row is also a real link. */
  onOpen: (order: WorkOrder) => void;
  hrefFor?: (order: WorkOrder) => string;
  /** First-photo URLs by request id (from useRequestThumbnails). */
  thumbnails?: ReadonlyMap<number, string | null>;
  /** Worker list hides the column: it is always the viewer. */
  showAssignee?: boolean;
  dateColumn?: RequestDateColumn;
  sort: RequestSort | null;
  onSortChange: (s: RequestSort) => void;
  ariaLabel: string;
  className?: string;
}

const GRID_WITH_ASSIGNEE =
  "md:grid-cols-[40px_minmax(0,1fr)_minmax(200px,0.9fr)_112px_16px] lg:grid-cols-[40px_minmax(0,1.2fr)_180px_minmax(220px,1fr)_120px_16px]";
const GRID_NO_ASSIGNEE = "md:grid-cols-[40px_minmax(0,1.2fr)_minmax(220px,1fr)_120px_16px]";

export function RequestListTable({
  items,
  onOpen,
  hrefFor = (o) => `/maintenance/${o.id}`,
  thumbnails,
  showAssignee = true,
  dateColumn = "opened",
  sort,
  onSortChange,
  ariaLabel,
  className,
}: RequestListTableProps) {
  const grid = showAssignee ? GRID_WITH_ASSIGNEE : GRID_NO_ASSIGNEE;
  const dateField: RequestSortField = dateColumn === "scheduled" ? "scheduled" : "created";
  const startedAt = useInProgressSince(items.map((i) => i.order));
  return (
    <div className={cn("w-full overflow-hidden rounded-md border border-border bg-card", className)}>
      {/* Column headers: a one-row table so each sortable header can carry aria-sort. */}
      <div role="table" aria-label={`${ariaLabel}: columns`} className="hidden border-b border-border md:block">
      <div role="row" className={cn("grid h-11 items-center gap-3 px-4", grid)}>
        <span aria-hidden />
        <SortHeader label="Request" field="title" sort={sort} onSortChange={onSortChange} />
        {showAssignee ? (
          <SortHeader
            label="Assigned to"
            field="assignee"
            sort={sort}
            onSortChange={onSortChange}
            className="hidden lg:flex"
          />
        ) : null}
        <SortHeader label="Status" field="status" sort={sort} onSortChange={onSortChange} />
        <SortHeader
          label={DATE_HEADER[dateColumn]}
          field={dateField}
          sort={sort}
          onSortChange={onSortChange}
          align="end"
        />
        <span aria-hidden />
      </div>
      </div>
      <ul aria-label={ariaLabel} className="divide-y divide-border">
        {items.map((item) => (
          <li key={item.order.id}>
            <RequestListRow
              item={item}
              href={hrefFor(item.order)}
              onOpen={onOpen}
              thumbnailUrl={thumbnails?.get(item.order.id) ?? null}
              startedAt={startedAt.get(item.order.id) ?? null}
              showAssignee={showAssignee}
              dateColumn={dateColumn}
              grid={grid}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function RequestListRow({
  item,
  href,
  onOpen,
  thumbnailUrl,
  startedAt,
  showAssignee,
  dateColumn,
  grid,
}: {
  item: RequestListItem;
  href: string;
  onOpen: (order: WorkOrder) => void;
  thumbnailUrl: string | null;
  startedAt: string | null;
  showAssignee: boolean;
  dateColumn: RequestDateColumn;
  grid: string;
}) {
  const o = item.order;
  const status = toRequestStatus(o);
  const level = priorityLevel(o.priority);
  const assignee = assigneeFallback(o, item.assigneeName);
  const stepWithName = listNextStep(o, item.assigneeName, true, startedAt);
  const stepNoName = listNextStep(o, item.assigneeName, false, startedAt);
  const when = dateValue(o, dateColumn);
  const ariaLabel = [
    o.title,
    item.context,
    level ? `${level} priority` : null,
    status,
    stepWithName,
    `${DATE_HEADER[dateColumn]} ${lowerFirst(when)}`,
  ]
    .filter(Boolean)
    .join(", ");

  const click = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    onOpen(o);
  };

  const priorityChip: ReactNode = level ? <PriorityChip level={level} /> : null;

  return (
    <>
      {/* Phone: stacked row */}
      <ListRow
        className="border-b-0 md:hidden"
        href={href}
        onClick={() => onOpen(o)}
        ariaLabel={ariaLabel}
        leading={<RequestThumb url={thumbnailUrl} size="md" />}
        title={o.title}
        context={item.context}
        meta={
          <>
            <div className="flex min-w-0 max-w-full items-center gap-2">
              <StatusChip status={status} />
              {stepWithName ? (
                <span className="truncate text-sm leading-5 text-muted-foreground">{stepWithName}</span>
              ) : null}
            </div>
            {priorityChip}
            <span className="text-xs leading-4 text-muted-foreground">
              {DATE_HEADER[dateColumn]} {lowerFirst(when)}
            </span>
          </>
        }
      />

      {/* Tablet + desktop: grid row */}
      <a
        href={href}
        onClick={click}
        aria-label={ariaLabel}
        className={cn(
          "hidden min-h-[60px] items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/40 md:grid",
          grid,
        )}
      >
        <RequestThumb url={thumbnailUrl} />
        <div className="min-w-0">
          <div className="truncate text-[15px] font-semibold leading-[22px] text-foreground">{o.title}</div>
          <div className="truncate text-sm leading-5 text-muted-foreground">{item.context}</div>
        </div>
        {showAssignee ? (
          <div className="hidden min-w-0 items-center gap-2 lg:flex">
            {assignee ? (
              <>
                {item.assigneeName ? <RequestAvatar name={item.assigneeName} /> : null}
                <span className="truncate text-sm leading-5 text-foreground">{assignee}</span>
              </>
            ) : (
              <span className="truncate text-sm leading-5 text-muted-foreground">Not assigned</span>
            )}
          </div>
        ) : null}
        <div className="flex min-w-0 items-center gap-2">
          {priorityChip}
          <StatusChip status={status} />
          {showAssignee ? (
            <>
              {stepWithName ? (
                <span className="truncate text-sm leading-5 text-muted-foreground lg:hidden">{stepWithName}</span>
              ) : null}
              {stepNoName ? (
                <span className="hidden truncate text-sm leading-5 text-muted-foreground lg:inline">
                  {stepNoName}
                </span>
              ) : null}
            </>
          ) : stepNoName ? (
            <span className="truncate text-sm leading-5 text-muted-foreground">{stepNoName}</span>
          ) : null}
        </div>
        <div className="truncate text-right text-sm leading-5 text-muted-foreground">{when}</div>
        <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
      </a>
    </>
  );
}

// ── Loading ─────────────────────────────────────────────────────────

/** 4 bone rows in the card: 40px square + text bars + chip. Never "Loading…". */
export function RequestListSkeleton({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div
      className={cn("w-full overflow-hidden rounded-md border border-border bg-card", className)}
      aria-busy="true"
      aria-label="Loading requests"
    >
      <div className="hidden h-11 border-b border-border md:block" aria-hidden />
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          aria-hidden
          className="flex min-h-[60px] items-center gap-3 border-b border-border px-4 py-3 last:border-b-0"
        >
          <div className="size-12 shrink-0 rounded-sm bg-muted md:size-10" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="h-3 w-[200px] max-w-full rounded-xs bg-muted" />
            <div className="h-2.5 w-[140px] max-w-[70%] rounded-xs bg-muted" />
          </div>
          <div className="hidden h-3 w-28 rounded-xs bg-muted lg:block" />
          <div className="h-[18px] w-16 shrink-0 rounded-xs bg-muted" />
          <div className="hidden h-3 w-16 rounded-xs bg-muted md:block" />
        </div>
      ))}
    </div>
  );
}

// ── Thumbnails ──────────────────────────────────────────────────────

const THUMB_BATCH = 40;
const THUMB_MAX = 80;

/**
 * First photo per request, loaded after the rows render with the batched
 * `listFirstMaintenancePhotos` (one photo-row query + one sign per batch; no
 * new tables). Failures fall back to the placeholder silently, never an error.
 * Results are cached for the page's lifetime (signed URLs last an hour).
 */
export function useRequestThumbnails(ids: readonly number[]): ReadonlyMap<number, string | null> {
  const { listFirstMaintenancePhotos } = useApp();
  const cacheRef = useRef(new Map<number, string | null>());
  const inflightRef = useRef(new Set<number>());
  const mountedRef = useRef(true);
  const [snapshot, setSnapshot] = useState<ReadonlyMap<number, string | null>>(() => new Map());
  const key = ids.slice(0, THUMB_MAX).join(",");

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    // Requests already in flight finish and publish even if `ids` changes.
    const queue = key
      .split(",")
      .filter(Boolean)
      .map(Number)
      .filter((id) => !cacheRef.current.has(id) && !inflightRef.current.has(id));
    if (queue.length === 0) return;
    for (const id of queue) inflightRef.current.add(id);

    const publish = () => {
      if (mountedRef.current) setSnapshot(new Map(cacheRef.current));
    };

    for (let i = 0; i < queue.length; i += THUMB_BATCH) {
      const batch = queue.slice(i, i + THUMB_BATCH);
      void (async () => {
        try {
          const urls = await listFirstMaintenancePhotos(batch);
          for (const id of batch) cacheRef.current.set(id, urls.get(id) ?? null);
        } catch {
          for (const id of batch) cacheRef.current.set(id, null);
        } finally {
          for (const id of batch) inflightRef.current.delete(id);
        }
        publish();
      })();
    }
  }, [key, listFirstMaintenancePhotos]);

  return snapshot;
}

// ── "Started today" for In progress rows ────────────────────────────

const STARTED_MAX = 30;

/**
 * When each In progress row last moved to In progress (spec §1: "Started today"),
 * from the existing per-request status history. Only In progress rows are
 * fetched (a handful at a time), after the rows render; a failure just leaves
 * the words out. Cached for the page's lifetime.
 */
export function useInProgressSince(orders: readonly WorkOrder[]): ReadonlyMap<number, string | null> {
  // Optional context: the table also renders outside the app (tests, gallery).
  const listMaintenanceStatusHistory = useContext(AppContext)?.listMaintenanceStatusHistory;
  const cacheRef = useRef(new Map<number, string | null>());
  const inflightRef = useRef(new Set<number>());
  const mountedRef = useRef(true);
  const [snapshot, setSnapshot] = useState<ReadonlyMap<number, string | null>>(() => new Map());
  const key = orders
    .filter((o) => o.status === "in_progress")
    .slice(0, STARTED_MAX)
    .map((o) => o.id)
    .join(",");

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!listMaintenanceStatusHistory) return;
    const queue = key
      .split(",")
      .filter(Boolean)
      .map(Number)
      .filter((id) => !cacheRef.current.has(id) && !inflightRef.current.has(id));
    if (queue.length === 0) return;
    for (const id of queue) inflightRef.current.add(id);
    void Promise.all(
      queue.map(async (id) => {
        try {
          cacheRef.current.set(id, inProgressSince(await listMaintenanceStatusHistory(id)));
        } catch {
          cacheRef.current.set(id, null);
        } finally {
          inflightRef.current.delete(id);
        }
      }),
    ).then(() => {
      if (mountedRef.current) setSnapshot(new Map(cacheRef.current));
    });
  }, [key, listMaintenanceStatusHistory]);

  return snapshot;
}
