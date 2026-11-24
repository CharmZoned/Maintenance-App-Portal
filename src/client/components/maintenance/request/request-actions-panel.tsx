import type { ReactNode } from "react";
import { Check, ChevronDown, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { statusOptions, type RequestStatus } from "@/lib/request-status";
import { cn } from "@/lib/utils";
import type { WorkOrderStatus } from "@/types";
import type { RequestSectionVisibility, RequestViewerRole } from "./role-visibility";

/**
 * Actions card (Figma "UPGRADED — Request" admin frame 25:1219, worker frames
 * 28:26141 / 28:26677; spec §2.5).
 *
 * Admin, top to bottom: the ONE main status control (New: primary "Assign and
 *   schedule" with a secondary "Change status ▾" under it; Assigned / In progress
 *   / On hold: primary "Change status ▾"; Completed: secondary "Change status ▾"),
 *   a divider, Vendor and Cost as values with a tap-to-edit link, a divider,
 *   then "Edit details" and "Delete".
 * Worker: one primary that advances the job (Start work → Mark completed, or
 *   Resume work when on hold), "Put on hold" under it, then the worker price
 *   (read-only: only an admin sets prices). No reassign, reschedule, vendor,
 *   edit or delete.
 * Tenant / landlord: no card (sectionsForRole(role).actionsPanel === false).
 *
 * This card only reports intent. The page opens the small dialogs:
 *   - onChangeStatus("on_hold")  → Put on hold (reason + follow-up date)
 *   - onChangeStatus("closed")   → Mark completed ("What fixed it?")
 *   - onChangeStatus("scheduled") with no assignee / date → Assign and schedule
 *   - onDelete                    → the "Delete this request?" confirm
 *
 * Phone (< 768px): the page shows the primary in a sticky bottom bar, so this
 * card is titled "More actions" and hides its own primary there.
 */
export type WorkerAction = "start" | "complete" | "resume";

/**
 * The single advancing worker button for a status, or null.
 * "New" is a job still in the worker pool (not assigned to anyone): the worker
 * cannot start it (RLS only lets the assigned worker change status).
 */
export function workerPrimaryAction(status: RequestStatus): WorkerAction | null {
  switch (status) {
    case "Assigned":
      return "start";
    case "In progress":
      return "complete";
    case "On hold":
      return "resume";
    default:
      return null;
  }
}

export const WORKER_ACTION_LABEL: Record<WorkerAction, string> = {
  start: "Start work",
  complete: "Mark completed",
  resume: "Resume work",
};

/** Stored status each worker action asks for ("closed" opens the Mark completed dialog). */
export const WORKER_ACTION_TARGET: Record<WorkerAction, WorkOrderStatus> = {
  start: "in_progress",
  complete: "closed",
  resume: "in_progress",
};

/** Worker "Put on hold" is offered while the job is assigned or under way. */
export function workerCanHold(status: RequestStatus): boolean {
  return status === "Assigned" || status === "In progress";
}

export interface RequestActionsPanelProps {
  role: RequestViewerRole;
  visibility: RequestSectionVisibility;
  status: RequestStatus;
  /** Stored status (kept for callers; the menu marks the current label). */
  dbStatus: WorkOrderStatus;
  busy?: boolean;
  /** Admin: vendor name, or null for "None" / "Add vendor". Shown only when visibility.vendor. */
  vendorLabel?: string | null;
  /** Price text for this viewer ("Worker $42.00 · Landlord $55.00" / "$42.00"), or null. */
  costLabel?: string | null;
  /** Admin: open Assign and schedule (person + date). */
  onAssign?: () => void;
  /** Admin Change status OR worker buttons: target stored status. */
  onChangeStatus?: (next: WorkOrderStatus) => void;
  onEditVendor?: () => void;
  onEditCost?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  /** Worker, job offered to the pool (New, unassigned): take it. */
  onAcceptJob?: () => void;
}

export function RequestActionsPanel(props: RequestActionsPanelProps) {
  const { visibility } = props;
  if (!visibility.actionsPanel) return null;
  return (
    <aside
      aria-label="Actions"
      className="flex w-full shrink-0 flex-col gap-3 rounded-md border border-border bg-card p-4 md:p-5 lg:w-80"
    >
      <h2 className="text-[17px] font-semibold leading-[22px] text-foreground">
        <span className="md:hidden">More actions</span>
        <span className="hidden md:inline">Actions</span>
      </h2>
      {visibility.workerStatusActions ? <WorkerActions {...props} /> : null}
      {visibility.changeStatus ? <AdminActions {...props} /> : null}
    </aside>
  );
}

// ── Worker ─────────────────────────────────────────────────────────

function WorkerActions({ status, busy, onChangeStatus, onAcceptJob, costLabel, visibility }: RequestActionsPanelProps) {
  const primary = workerPrimaryAction(status);
  const canHold = workerCanHold(status);
  const canAccept = status === "New" && Boolean(onAcceptJob);
  const note =
    status === "New"
      ? canAccept
        ? "Accept this job to add it to your schedule."
        : "This job isn't assigned to you yet."
      : status === "Completed"
        ? "This job is completed."
        : null;
  return (
    <>
      {canAccept ? (
        // Phone: the sticky bar carries the primary.
        <Button className="hidden w-full md:inline-flex" disabled={busy} onClick={onAcceptJob}>
          Accept job
        </Button>
      ) : null}
      {primary ? (
        // Phone: the sticky bar carries the primary.
        <Button
          className="hidden w-full md:inline-flex"
          disabled={busy || !onChangeStatus}
          onClick={() => onChangeStatus?.(WORKER_ACTION_TARGET[primary])}
        >
          {WORKER_ACTION_LABEL[primary]}
        </Button>
      ) : null}
      {canHold ? (
        <Button
          variant="secondary"
          className="h-11 w-full md:h-7"
          disabled={busy || !onChangeStatus}
          onClick={() => onChangeStatus?.("on_hold")}
        >
          Put on hold
        </Button>
      ) : null}
      {note ? <p className="text-sm leading-5 text-muted-foreground">{note}</p> : null}
      {visibility.cost ? (
        <>
          <Divider />
          <ValueRow label="Cost" value={costLabel || "Not recorded"} />
        </>
      ) : null}
    </>
  );
}

// ── Admin ──────────────────────────────────────────────────────────

function AdminActions({
  status,
  busy,
  visibility,
  vendorLabel,
  costLabel,
  onAssign,
  onChangeStatus,
  onEditVendor,
  onEditCost,
  onEdit,
  onDelete,
}: RequestActionsPanelProps) {
  const isNew = status === "New";
  const assignFirst = isNew && Boolean(onAssign);
  // Primary (solid) Change status except when Assign leads (New) or the job is done.
  const changeIsPrimary = !assignFirst && status !== "Completed";
  const vendorEditable = visibility.costVendorEditable && onEditVendor;
  const costEditable = visibility.costVendorEditable && onEditCost;
  const hasValues = visibility.vendor || Boolean(visibility.cost);
  const hasEditDelete = visibility.editAndDelete && (onEdit || onDelete);

  return (
    <>
      {assignFirst ? (
        // Phone: the sticky bar carries "Assign and schedule".
        <Button className="hidden w-full md:inline-flex" disabled={busy} onClick={onAssign}>
          Assign and schedule
        </Button>
      ) : null}
      {onChangeStatus ? (
        <RequestStatusMenu current={status} disabled={busy} onChangeStatus={onChangeStatus}>
          <Button
            variant={changeIsPrimary ? "default" : "secondary"}
            // Phone: the sticky bar already is "Change status" unless Assign leads there.
            className={cn("w-full justify-between", assignFirst ? "h-11 md:h-7" : "hidden md:inline-flex")}
            disabled={busy}
          >
            Change status
            <ChevronDown aria-hidden />
          </Button>
        </RequestStatusMenu>
      ) : null}

      {hasValues ? (
        <>
          <Divider className={cn(!assignFirst && "md:block hidden")} />
          {visibility.vendor ? (
            <ValueRow
              label="Vendor"
              value={vendorLabel?.trim() || "None"}
              actionLabel={vendorEditable ? (vendorLabel?.trim() ? "Change" : "Add vendor") : undefined}
              actionAria={vendorLabel?.trim() ? "Change vendor" : undefined}
              onAction={vendorEditable ? onEditVendor : undefined}
              disabled={busy}
            />
          ) : null}
          {visibility.cost ? (
            <ValueRow
              label="Cost"
              value={costLabel || "Not recorded"}
              actionLabel={costEditable ? (costLabel ? "Edit" : "Add cost") : undefined}
              actionAria={costLabel ? "Edit cost" : undefined}
              onAction={costEditable ? onEditCost : undefined}
              disabled={busy}
            />
          ) : null}
        </>
      ) : null}

      {hasEditDelete ? (
        <>
          <Divider />
          <div className="flex flex-col gap-2">
            {onEdit ? (
              <Button variant="secondary" className="h-11 w-full md:h-7" disabled={busy} onClick={onEdit}>
                <Pencil aria-hidden />
                Edit details
              </Button>
            ) : null}
            {onDelete ? (
              <Button variant="destructive" className="h-11 w-full md:h-7" disabled={busy} onClick={onDelete}>
                <Trash2 aria-hidden />
                Delete
              </Button>
            ) : null}
          </div>
        </>
      ) : null}
    </>
  );
}

const STATUS_MENU_ORDER: WorkOrderStatus[] = ["open", "scheduled", "in_progress", "on_hold", "closed"];

/**
 * Admin "Change status ▾" menu (spec §2.5): New, Assigned, In progress,
 * On hold…, Completed…. The current status is ticked and not selectable; the
 * "…" items open a small dialog on the page before anything is saved.
 * Exported so the phone sticky bar uses the same menu.
 */
export function RequestStatusMenu({
  current,
  disabled,
  onChangeStatus,
  children,
}: {
  current: RequestStatus;
  disabled?: boolean;
  onChangeStatus?: (next: WorkOrderStatus) => void;
  /** The trigger (a Button). */
  children: ReactNode;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        {children}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[12rem]">
        {statusOptions(STATUS_MENU_ORDER).map((option) => {
          const isCurrent = option.label === current;
          const needsInput = option.value === "on_hold" || option.value === "closed";
          return (
            <DropdownMenuItem
              key={option.value}
              disabled={isCurrent}
              onSelect={() => onChangeStatus?.(option.value)}
              className="min-h-11 md:min-h-8"
            >
              <span className="flex size-4 items-center justify-center" aria-hidden>
                {isCurrent ? <Check /> : null}
              </span>
              {option.label}
              {needsInput ? "…" : ""}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── Bits ───────────────────────────────────────────────────────────

function Divider({ className }: { className?: string }) {
  return <div role="presentation" className={cn("h-px bg-border", className)} />;
}

/** Read-only field (label over value) with an optional right-aligned edit link. */
function ValueRow({
  label,
  value,
  actionLabel,
  actionAria,
  onAction,
  disabled,
}: {
  label: string;
  value: string;
  actionLabel?: string;
  actionAria?: string;
  onAction?: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-[13px] font-medium leading-[18px] text-muted-foreground">{label}</p>
        <p className="break-words text-[15px] leading-[22px] text-foreground">{value}</p>
      </div>
      {actionLabel && onAction ? (
        <button
          type="button"
          onClick={onAction}
          disabled={disabled}
          aria-label={actionAria}
          className="inline-flex min-h-11 shrink-0 items-center rounded-sm px-1 text-sm font-medium leading-5 text-brand-text outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50 md:min-h-7"
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}
