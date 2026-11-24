import type { WorkOrder, WorkOrderPriority } from "@/types";
import { REQUEST_STATUSES, toRequestStatus } from "@/lib/request-status";

/**
 * Sorting for the shared request list (spec §6.1). Pure helpers so every role
 * list sorts the same way; the per-tab "recommended" orders live here too.
 */

export type RequestSortField = "created" | "priority" | "status" | "assignee" | "title" | "scheduled";
export type SortDir = "asc" | "desc";
export interface RequestSort {
  field: RequestSortField;
  dir: SortDir;
}

/** Named choices for the phone `Sort ▾` menu. */
export type RequestSortPreset = "recommended" | "newest" | "oldest" | "priority" | "status";

export const SORT_PRESETS: readonly { value: RequestSortPreset; label: string }[] = [
  { value: "recommended", label: "Recommended" },
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "priority", label: "Priority" },
  { value: "status", label: "Status" },
];

export function presetToSort(preset: RequestSortPreset): RequestSort | null {
  switch (preset) {
    case "newest":
      return { field: "created", dir: "desc" };
    case "oldest":
      return { field: "created", dir: "asc" };
    case "priority":
      return { field: "priority", dir: "desc" };
    case "status":
      return { field: "status", dir: "asc" };
    default:
      return null;
  }
}

export function sortToPreset(sort: RequestSort | null): RequestSortPreset | null {
  if (!sort) return "recommended";
  if (sort.field === "created") return sort.dir === "desc" ? "newest" : "oldest";
  if (sort.field === "priority" && sort.dir === "desc") return "priority";
  if (sort.field === "status" && sort.dir === "asc") return "status";
  return null;
}

/** First click on a column header: the direction people usually want. */
export function defaultDirFor(field: RequestSortField): SortDir {
  return field === "created" || field === "priority" ? "desc" : "asc";
}

/** Header click: same column flips, another column starts at its default. */
export function nextSort(current: RequestSort | null, field: RequestSortField): RequestSort {
  if (current && current.field === field) {
    return { field, dir: current.dir === "asc" ? "desc" : "asc" };
  }
  return { field, dir: defaultDirFor(field) };
}

const PRIORITY_RANK: Record<WorkOrderPriority, number> = { low: 0, normal: 1, high: 2, urgent: 3 };

function priorityRank(p: WorkOrderPriority | null | undefined): number {
  return PRIORITY_RANK[p ?? "normal"] ?? 1;
}

function statusRank(o: WorkOrder): number {
  return REQUEST_STATUSES.indexOf(toRequestStatus(o));
}

function time(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso.length <= 10 ? `${iso}T00:00:00` : iso);
  return Number.isNaN(t) ? null : t;
}

/** Ascending compare; nulls always last regardless of direction (handled by caller). */
function cmpNum(a: number, b: number): number {
  return a === b ? 0 : a < b ? -1 : 1;
}

function cmpTime(a: string | null | undefined, b: string | null | undefined): number | "a-null" | "b-null" | 0 {
  const ta = time(a);
  const tb = time(b);
  if (ta == null && tb == null) return 0;
  if (ta == null) return "a-null";
  if (tb == null) return "b-null";
  return cmpNum(ta, tb);
}

/** Newest-created first, id as a stable tiebreak. */
function byCreatedDesc(a: WorkOrder, b: WorkOrder): number {
  const c = cmpTime(a.created_at, b.created_at);
  if (typeof c === "number" && c !== 0) return -c;
  return b.id - a.id;
}

export function compareRequests(
  a: WorkOrder,
  b: WorkOrder,
  sort: RequestSort,
  assigneeNameOf?: (o: WorkOrder) => string | null,
): number {
  const sign = sort.dir === "asc" ? 1 : -1;
  let primary = 0;
  switch (sort.field) {
    case "created":
    case "scheduled": {
      const c = cmpTime(
        sort.field === "created" ? a.created_at : a.scheduled_at,
        sort.field === "created" ? b.created_at : b.scheduled_at,
      );
      // Missing dates sink to the bottom in both directions.
      if (c === "a-null") return 1;
      if (c === "b-null") return -1;
      primary = c * sign;
      break;
    }
    case "priority":
      primary = cmpNum(priorityRank(a.priority), priorityRank(b.priority)) * sign;
      break;
    case "status":
      primary = cmpNum(statusRank(a), statusRank(b)) * sign;
      break;
    case "title":
      primary = a.title.localeCompare(b.title, undefined, { sensitivity: "base" }) * sign;
      break;
    case "assignee": {
      const na = assigneeNameOf?.(a) ?? null;
      const nb = assigneeNameOf?.(b) ?? null;
      if (!na && nb) return 1;
      if (na && !nb) return -1;
      primary = (na ?? "").localeCompare(nb ?? "", undefined, { sensitivity: "base" }) * sign;
      break;
    }
  }
  return primary || byCreatedDesc(a, b);
}

export function sortRequests(
  list: readonly WorkOrder[],
  sort: RequestSort,
  assigneeNameOf?: (o: WorkOrder) => string | null,
): WorkOrder[] {
  return [...list].sort((a, b) => compareRequests(a, b, sort, assigneeNameOf));
}

/** Per-tab recommended orders (spec §6.1 table). */
export type RecommendedOrder =
  | "emergency-then-oldest"
  | "in-progress-then-scheduled"
  | "completed-newest"
  | "newest"
  | "scheduled";

export function sortRecommended(list: readonly WorkOrder[], order: RecommendedOrder): WorkOrder[] {
  const out = [...list];
  switch (order) {
    case "emergency-then-oldest":
      return out.sort((a, b) => {
        const ea = a.priority === "urgent" ? 0 : 1;
        const eb = b.priority === "urgent" ? 0 : 1;
        if (ea !== eb) return ea - eb;
        const c = cmpTime(a.created_at, b.created_at);
        if (typeof c === "number" && c !== 0) return c;
        return a.id - b.id;
      });
    case "in-progress-then-scheduled":
      return out.sort((a, b) => {
        const pa = a.status === "in_progress" ? 0 : 1;
        const pb = b.status === "in_progress" ? 0 : 1;
        if (pa !== pb) return pa - pb;
        return compareRequests(a, b, { field: "scheduled", dir: "asc" });
      });
    case "completed-newest":
      return out.sort((a, b) => {
        const c = cmpTime(a.completed_at, b.completed_at);
        if (c === "a-null") return 1;
        if (c === "b-null") return -1;
        if (c !== 0) return -c;
        return byCreatedDesc(a, b);
      });
    case "scheduled":
      return out.sort((a, b) => compareRequests(a, b, { field: "scheduled", dir: "asc" }));
    case "newest":
    default:
      return out.sort(byCreatedDesc);
  }
}

/** Per-viewer sort memory. Storage can be missing or throw; never break the list. */
export function readStoredSort(key: string): RequestSort | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RequestSort> | null;
    const fields: RequestSortField[] = ["created", "priority", "status", "assignee", "title", "scheduled"];
    if (
      parsed &&
      typeof parsed === "object" &&
      fields.includes(parsed.field as RequestSortField) &&
      (parsed.dir === "asc" || parsed.dir === "desc")
    ) {
      return { field: parsed.field as RequestSortField, dir: parsed.dir };
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function writeStoredSort(key: string, sort: RequestSort | null): void {
  try {
    if (sort) window.localStorage.setItem(key, JSON.stringify(sort));
    else window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}
