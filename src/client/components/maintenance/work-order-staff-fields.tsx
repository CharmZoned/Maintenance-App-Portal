import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { StaffMember } from "@/lib/data";
import {
  MAINTENANCE_CATEGORIES,
  type MaintenanceCategory,
  type Property,
  type Unit,
  type Vendor,
  type WorkOrderPriority,
  type WorkOrderStatus,
} from "@/types";
import { WorkOrderAssigneeDateFields } from "./work-order-assignee-date-fields";
import { ADMIN_STATUSES, PRIORITIES, staffStatusOptions } from "./work-order-status";

/** Form values lifted from the dialog — one bag instead of ~40 value/onChange props. */
export type WorkOrderStaffFormValues = {
  propertyId: number | "";
  unitId: number | "";
  title: string;
  description: string;
  category: MaintenanceCategory | string;
  priority: WorkOrderPriority;
  status: WorkOrderStatus;
  vendorId: number | "";
  assignedStaffId: number | "";
  scheduledAt: string;
  holdReason: string;
  followUpDate: string;
  resolutionNotes: string;
  permissionToEnter: boolean;
  cost: string;
  notes: string;
};

export interface WorkOrderStaffFieldsProps {
  isCreate: boolean;
  isAdmin: boolean;
  readOnlyCore: boolean;
  canStartWork: boolean;
  properties: Property[];
  filteredUnits: Unit[];
  vendors: Vendor[];
  staff: StaffMember[];
  values: WorkOrderStaffFormValues;
  onChange: (patch: Partial<WorkOrderStaffFormValues>) => void;
}

/** Staff/admin editable core + status companion fields. */
export function WorkOrderStaffFields({
  isCreate,
  isAdmin,
  readOnlyCore,
  canStartWork,
  properties,
  filteredUnits,
  vendors,
  staff,
  values,
  onChange,
}: WorkOrderStaffFieldsProps) {
  const statusOptions = isAdmin ? ADMIN_STATUSES : staffStatusOptions(canStartWork);
  const {
    propertyId,
    unitId,
    title,
    description,
    category,
    priority,
    status,
    vendorId,
    assignedStaffId,
    scheduledAt,
    holdReason,
    followUpDate,
    resolutionNotes,
    permissionToEnter,
    cost,
    notes,
  } = values;

  return (
    <>
      <div>
        <Label htmlFor="wo-title">Title</Label>
        <Input
          id="wo-title"
          value={title}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder="Leaking kitchen faucet"
          disabled={readOnlyCore}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Property</Label>
          <Select
            value={String(propertyId || "")}
            onValueChange={(v) =>
              onChange({ propertyId: v ? Number(v) : "", unitId: "" })
            }
            disabled={readOnlyCore}
          >
            <SelectTrigger>
              <SelectValue placeholder="—" />
            </SelectTrigger>
            <SelectContent>
              {properties.map((p) => (
                <SelectItem key={p.id} value={String(p.id)}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Unit</Label>
          <Select
            value={String(unitId || "")}
            onValueChange={(v) => onChange({ unitId: v ? Number(v) : "" })}
            disabled={readOnlyCore}
          >
            <SelectTrigger>
              <SelectValue placeholder="—" />
            </SelectTrigger>
            <SelectContent>
              {filteredUnits.map((u) => (
                <SelectItem key={u.id} value={String(u.id)}>
                  {u.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div>
        <Label htmlFor="wo-desc">Description</Label>
        <Textarea
          id="wo-desc"
          value={description}
          onChange={(e) => onChange({ description: e.target.value })}
          rows={3}
          disabled={readOnlyCore}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Category</Label>
          <Select
            value={category}
            onValueChange={(v) => onChange({ category: v })}
            disabled={readOnlyCore}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MAINTENANCE_CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
              {!MAINTENANCE_CATEGORIES.includes(category as MaintenanceCategory) && (
                <SelectItem value={category}>{category}</SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Priority</Label>
          <Select
            value={priority}
            onValueChange={(v) => onChange({ priority: v as WorkOrderPriority })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRIORITIES.map((p) => (
                <SelectItem key={p.value} value={p.value}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Status</Label>
          <Select
            value={isCreate ? "open" : status}
            onValueChange={(v) => onChange({ status: v as WorkOrderStatus })}
            disabled={isCreate}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {statusOptions.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
              {status === "scheduled" && !isAdmin && (
                <SelectItem value="scheduled">Scheduled</SelectItem>
              )}
            </SelectContent>
          </Select>
          {isCreate && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              New requests start Open — use Accept &amp; schedule after create.
            </p>
          )}
          {!isAdmin && !canStartWork && !isCreate && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              In progress unlocks after an admin assigns staff.
            </p>
          )}
        </div>
        <div>
          <Label>Vendor</Label>
          <Select
            value={String(vendorId || "")}
            onValueChange={(v) => onChange({ vendorId: v ? Number(v) : "" })}
          >
            <SelectTrigger>
              <SelectValue placeholder="—" />
            </SelectTrigger>
            <SelectContent>
              {vendors.map((v) => (
                <SelectItem key={v.id} value={String(v.id)}>
                  {v.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {(status === "scheduled" || status === "in_progress") && isAdmin && (
        <div className="grid gap-3 rounded border p-3">
          <div className="text-xs font-medium text-muted-foreground">
            Required for {status === "scheduled" ? "Scheduled" : "In progress"}
          </div>
          <WorkOrderAssigneeDateFields
            staff={staff}
            assignedStaffId={assignedStaffId}
            onAssignedStaffIdChange={(id) => onChange({ assignedStaffId: id })}
            scheduledAt={scheduledAt}
            onScheduledAtChange={(d) => onChange({ scheduledAt: d })}
            staffFieldLabel="Assigned staff"
            dateFieldLabel="Scheduled date"
            showDate={status === "scheduled"}
            staffPlaceholder="Staff"
          />
        </div>
      )}

      {status === "on_hold" && (
        <div className="grid gap-2 rounded border p-3">
          <p className="text-xs font-medium text-muted-foreground">Required for On hold</p>
          <div>
            <Label>Hold reason</Label>
            <Input
              value={holdReason}
              onChange={(e) => onChange({ holdReason: e.target.value })}
              placeholder="Waiting on parts…"
            />
          </div>
          <div>
            <Label>Follow-up date</Label>
            <Input
              type="date"
              value={followUpDate}
              onChange={(e) => onChange({ followUpDate: e.target.value })}
            />
          </div>
        </div>
      )}

      {status === "closed" && (
        <div className="grid gap-2 rounded border p-3">
          <p className="text-xs font-medium text-muted-foreground">Required to close</p>
          <div>
            <Label>Resolution notes</Label>
            <Textarea
              value={resolutionNotes}
              onChange={(e) => onChange({ resolutionNotes: e.target.value })}
              rows={2}
              placeholder="What fixed it?"
            />
          </div>
        </div>
      )}

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={permissionToEnter}
          onChange={(e) => onChange({ permissionToEnter: e.target.checked })}
          className="size-4"
          disabled={readOnlyCore}
        />
        Permission to enter
      </label>

      <div className="grid grid-cols-2 gap-3">
        {!isAdmin && (
          <div>
            <Label>Scheduled date</Label>
            <Input type="date" value={scheduledAt} disabled />
          </div>
        )}
        <div className={isAdmin ? "col-span-2 sm:col-span-1" : ""}>
          <Label htmlFor="wo-cost">Cost</Label>
          <Input
            id="wo-cost"
            type="number"
            value={cost}
            onChange={(e) => onChange({ cost: e.target.value })}
          />
        </div>
      </div>

      <div>
        <Label htmlFor="wo-notes">Internal notes</Label>
        <Textarea
          id="wo-notes"
          value={notes}
          onChange={(e) => onChange({ notes: e.target.value })}
          rows={2}
        />
      </div>
    </>
  );
}
