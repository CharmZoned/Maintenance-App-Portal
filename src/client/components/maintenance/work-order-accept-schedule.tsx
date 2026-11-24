import { Button } from "@/components/ui/button";
import { STATUS_LABEL } from "@/lib/request-status";
import { formatDate } from "@/lib/utils";
import type { StaffMember } from "@/lib/data";
import type { WorkOrder } from "@/types";
import {
  WorkOrderAssigneeDateFields,
  staffMemberLabel,
} from "./work-order-assignee-date-fields";

export interface WorkOrderAcceptScheduleProps {
  workOrder: WorkOrder;
  expanded: boolean;
  onExpandedChange: (open: boolean) => void;
  staff: StaffMember[];
  assignedStaffId: number | "";
  onAssignedStaffIdChange: (id: number | "") => void;
  scheduledAt: string;
  onScheduledAtChange: (isoDate: string) => void;
  saving: boolean;
  onConfirm: () => void;
}

/**
 * Admin-only intake inside the old work-order dialog: assign a person + date and
 * move New → Assigned (stored `scheduled`) in one confirm. Same words as the
 * request page's "Assign and schedule" dialog (spec §2.5).
 * Permissions stay client-gated; DB protect trigger still enforces admin-only schedule.
 */
export function WorkOrderAcceptSchedule({
  workOrder,
  expanded,
  onExpandedChange,
  staff,
  assignedStaffId,
  onAssignedStaffIdChange,
  scheduledAt,
  onScheduledAtChange,
  saving,
  onConfirm,
}: WorkOrderAcceptScheduleProps) {
  const assignee = staffMemberLabel(staff, assignedStaffId);
  const when = scheduledAt ? formatDate(scheduledAt, { weekday: "short", day: "numeric", month: "short" }) : null;
  const canConfirm = Boolean(assignedStaffId && scheduledAt) && !saving;
  const location = [workOrder.property_name, workOrder.unit_name].filter(Boolean).join(" · ");
  const tenant = [workOrder.tenant_first_name, workOrder.tenant_last_name].filter(Boolean).join(" ");

  return (
    <div className="rounded-md border border-border bg-muted p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-foreground">Assign and schedule</p>
          <p className="text-xs text-muted-foreground">
            Pick who is going and when. The status becomes {STATUS_LABEL.scheduled}.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant={expanded ? "secondary" : "default"}
          onClick={() => onExpandedChange(!expanded)}
        >
          {expanded ? "Hide" : "Assign and schedule"}
        </Button>
      </div>

      {expanded && (
        <div className="mt-3 grid gap-3">
          <div className="rounded-sm border border-border bg-card px-3 py-2 text-xs">
            <p className="font-medium text-foreground">{workOrder.title}</p>
            <p className="mt-0.5 text-muted-foreground">
              {[workOrder.category, tenant || null, location || null].filter(Boolean).join(" · ") ||
                "New request"}
            </p>
          </div>

          <WorkOrderAssigneeDateFields
            staff={staff}
            assignedStaffId={assignedStaffId}
            onAssignedStaffIdChange={onAssignedStaffIdChange}
            scheduledAt={scheduledAt}
            onScheduledAtChange={onScheduledAtChange}
            staffFieldLabel="Assign to"
            dateFieldLabel="Date"
            showJobTitle
          />

          <p className="text-xs text-muted-foreground">
            {assignee && when
              ? `${assignee} will be assigned for ${when}. The tenant is told who is coming and when.`
              : "Pick a person and a date, then assign."}
          </p>

          <Button type="button" disabled={!canConfirm} onClick={() => onConfirm()}>
            Assign
          </Button>
        </div>
      )}
    </div>
  );
}
