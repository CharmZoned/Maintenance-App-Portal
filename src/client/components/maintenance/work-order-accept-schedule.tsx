import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDate } from "@/lib/utils";
import type { StaffMember } from "@/lib/data";
import type { WorkOrder } from "@/types";

interface Props {
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

function staffLabel(staff: StaffMember[], id: number | ""): string | null {
  if (!id) return null;
  const row = staff.find((s) => s.id === Number(id));
  if (!row) return null;
  return `${row.last_name}, ${row.first_name}`;
}

/**
 * Admin-only intake: assign staff + date and move Open → Scheduled in one confirm.
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
}: Props) {
  const assignee = staffLabel(staff, assignedStaffId);
  const when = scheduledAt ? formatDate(scheduledAt) : null;
  const canConfirm = Boolean(assignedStaffId && scheduledAt) && !saving;
  const location = [workOrder.property_name, workOrder.unit_name].filter(Boolean).join(" · ");
  const tenant = [workOrder.tenant_first_name, workOrder.tenant_last_name].filter(Boolean).join(" ");

  return (
    <div className="rounded border border-orange-200 bg-orange-50/60 p-3 dark:border-orange-900 dark:bg-orange-950/30">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">Accept &amp; schedule</p>
          <p className="text-xs text-muted-foreground">
            Assign staff and a date in one step (admin only). Sets status to Scheduled.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant={expanded ? "secondary" : "default"}
          onClick={() => onExpandedChange(!expanded)}
        >
          {expanded ? "Hide" : "Accept & schedule"}
        </Button>
      </div>

      {expanded && (
        <div className="mt-3 grid gap-3">
          <div className="rounded border border-orange-200/80 bg-background/70 px-3 py-2 text-xs dark:border-orange-900/60">
            <p className="font-medium text-foreground">{workOrder.title}</p>
            <p className="mt-0.5 text-muted-foreground">
              {[workOrder.category, tenant || null, location || null].filter(Boolean).join(" · ") || "Open request"}
            </p>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <Label>Staff</Label>
              <Select
                value={String(assignedStaffId || "")}
                onValueChange={(v) => onAssignedStaffIdChange(v ? Number(v) : "")}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Assign staff" />
                </SelectTrigger>
                <SelectContent>
                  {staff.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {s.last_name}, {s.first_name}
                      {s.job_title ? ` · ${s.job_title}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Date</Label>
              <Input
                type="date"
                value={scheduledAt}
                onChange={(e) => onScheduledAtChange(e.target.value)}
              />
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            {assignee && when
              ? `Confirm to assign ${assignee} for ${when} and mark this request Scheduled.`
              : "Pick a staff member and date, then confirm."}
          </p>

          <Button
            type="button"
            disabled={!canConfirm}
            onClick={() => onConfirm()}
          >
            Confirm Accept &amp; schedule
          </Button>
        </div>
      )}
    </div>
  );
}
