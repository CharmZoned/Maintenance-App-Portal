import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { StaffMember } from "@/lib/data";

export function formatStaffMember(s: StaffMember, withJobTitle = false): string {
  const name = `${s.last_name}, ${s.first_name}`;
  return withJobTitle && s.job_title ? `${name} · ${s.job_title}` : name;
}

export function staffMemberLabel(staff: StaffMember[], id: number | ""): string | null {
  if (!id) return null;
  const row = staff.find((s) => s.id === Number(id));
  return row ? formatStaffMember(row) : null;
}

export interface WorkOrderAssigneeDateFieldsProps {
  staff: StaffMember[];
  assignedStaffId: number | "";
  onAssignedStaffIdChange: (id: number | "") => void;
  scheduledAt: string;
  onScheduledAtChange: (isoDate: string) => void;
  /** Accept panel uses "Staff" / "Date" (e2e); companions use longer labels. */
  staffFieldLabel?: string;
  dateFieldLabel?: string;
  showDate?: boolean;
  showJobTitle?: boolean;
  staffPlaceholder?: string;
}

/** Shared assignee (+ optional date) editors for Accept panel and Scheduled companions. */
export function WorkOrderAssigneeDateFields({
  staff,
  assignedStaffId,
  onAssignedStaffIdChange,
  scheduledAt,
  onScheduledAtChange,
  staffFieldLabel = "Staff",
  dateFieldLabel = "Date",
  showDate = true,
  showJobTitle = false,
  staffPlaceholder = "Assign staff",
}: WorkOrderAssigneeDateFieldsProps) {
  return (
    <div className={`grid gap-2 ${showDate ? "sm:grid-cols-2" : ""}`}>
      <div>
        <Label>{staffFieldLabel}</Label>
        <Select
          value={String(assignedStaffId || "")}
          onValueChange={(v) => onAssignedStaffIdChange(v ? Number(v) : "")}
        >
          <SelectTrigger>
            <SelectValue placeholder={staffPlaceholder} />
          </SelectTrigger>
          <SelectContent>
            {staff.map((s) => (
              <SelectItem key={s.id} value={String(s.id)}>
                {formatStaffMember(s, showJobTitle)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {showDate && (
        <div>
          <Label>{dateFieldLabel}</Label>
          <Input
            type="date"
            value={scheduledAt}
            onChange={(e) => onScheduledAtChange(e.target.value)}
          />
        </div>
      )}
    </div>
  );
}
