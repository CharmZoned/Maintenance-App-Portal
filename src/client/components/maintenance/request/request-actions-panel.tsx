import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { statusOptions, type RequestStatus } from "@/lib/request-status";
import type { WorkOrderStatus } from "@/types";
import type { RequestSectionVisibility, RequestViewerRole } from "./role-visibility";

/**
 * Actions panel (Figma "UPGRADED — Request" admin frame; brief N3 actions table).
 *
 * Admin: "Assign and schedule" when New, ONE main "Change status" control,
 *   Vendor and Cost as tappable values, Edit and Delete underneath.
 * Worker: one primary button that advances (Start work → Mark completed),
 *   plus Put on hold / Resume. Cannot reassign or reschedule.
 * Tenant / landlord: no panel (sectionsForRole(role).actionsPanel === false).
 *
 * Status changes that need input (On hold → reason + follow-up date;
 * Completed → "What fixed it?") open a small dialog owned by the page; this
 * panel only reports the requested target status.
 */
export type WorkerAction = "start" | "complete" | "resume";

/** The single advancing worker button for a status, or null. */
export function workerPrimaryAction(status: RequestStatus): WorkerAction | null {
  switch (status) {
    case "New":
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

const WORKER_ACTION_LABEL: Record<WorkerAction, string> = {
  start: "Start work",
  complete: "Mark completed",
  resume: "Resume work",
};

export interface RequestActionsPanelProps {
  role: RequestViewerRole;
  visibility: RequestSectionVisibility;
  status: RequestStatus;
  /** Stored status, for the admin Change status control value. */
  dbStatus: WorkOrderStatus;
  busy?: boolean;
  /** Admin: vendor name or null ("Add vendor"). Shown only when visibility.vendor. */
  vendorLabel?: string | null;
  /** Formatted price for this viewer (worker price / landlord price), or null ("Add cost"). */
  costLabel?: string | null;
  /** Admin: open assign-and-schedule (person + date). */
  onAssign?: () => void;
  /** Admin Change status OR worker buttons: target stored status. */
  onChangeStatus?: (next: WorkOrderStatus) => void;
  onEditVendor?: () => void;
  onEditCost?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}

export function RequestActionsPanel(props: RequestActionsPanelProps) {
  const { visibility } = props;
  if (!visibility.actionsPanel) return null;
  return (
    <aside className="w-full shrink-0 space-y-3 rounded-md border border-border bg-card p-4 lg:w-[280px]">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Actions</h2>
      {visibility.workerStatusActions ? <WorkerActions {...props} /> : null}
      {visibility.changeStatus ? <AdminActions {...props} /> : null}
    </aside>
  );
}

function WorkerActions({ status, busy, onChangeStatus, costLabel, visibility }: RequestActionsPanelProps) {
  const primary = workerPrimaryAction(status);
  const target: Record<WorkerAction, WorkOrderStatus> = {
    start: "in_progress",
    complete: "closed",
    resume: "in_progress",
  };
  return (
    <div className="space-y-2">
      {primary ? (
        <Button className="w-full" size="touch" variant="brand" disabled={busy} onClick={() => onChangeStatus?.(target[primary])}>
          {WORKER_ACTION_LABEL[primary]}
        </Button>
      ) : null}
      {status !== "On hold" && status !== "Completed" ? (
        <Button className="w-full" size="touch" variant="secondary" disabled={busy} onClick={() => onChangeStatus?.("on_hold")}>
          Put on hold
        </Button>
      ) : null}
      {visibility.cost ? <ValueRow label="Your price" value={costLabel ?? "—"} /> : null}
    </div>
  );
}

function AdminActions({
  status,
  dbStatus,
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
  return (
    <div className="space-y-3">
      {status === "New" && onAssign ? (
        <Button className="w-full" size="touch" variant="brand" disabled={busy} onClick={onAssign}>
          Assign and schedule
        </Button>
      ) : null}
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">Change status</p>
        <Select
          value={dbStatus}
          disabled={busy}
          onValueChange={(v) => onChangeStatus?.(v as WorkOrderStatus)}
        >
          <SelectTrigger className="h-11 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {statusOptions().map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {visibility.vendor ? (
        <ValueRow label="Vendor" value={vendorLabel || "Add vendor"} onClick={visibility.costVendorEditable ? onEditVendor : undefined} />
      ) : null}
      {visibility.cost ? (
        <ValueRow label="Cost" value={costLabel || "Add cost"} onClick={visibility.costVendorEditable ? onEditCost : undefined} />
      ) : null}
      {visibility.editAndDelete ? (
        <div className="flex gap-2 border-t border-border pt-3">
          <Button variant="ghost" size="touch" disabled={busy} onClick={onEdit}>
            Edit details
          </Button>
          <Button variant="destructive" size="touch" disabled={busy} onClick={onDelete}>
            Delete
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function ValueRow({ label, value, onClick }: { label: string; value: string; onClick?: () => void }) {
  const body = (
    <>
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-foreground">{value}</span>
    </>
  );
  if (!onClick) return <div className="flex min-h-11 items-center justify-between gap-2">{body}</div>;
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-11 w-full items-center justify-between gap-2 rounded-sm px-1 text-left hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/40"
    >
      {body}
    </button>
  );
}
