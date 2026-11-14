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
import { ADMIN_STATUSES, PRIORITIES, staffStatusOptions } from "./work-order-status";

interface Props {
  isCreate: boolean;
  isAdmin: boolean;
  readOnlyCore: boolean;
  hasAssignee: boolean;
  status: WorkOrderStatus;
  onStatusChange: (s: WorkOrderStatus) => void;
  propertyId: number | "";
  onPropertyIdChange: (id: number | "") => void;
  unitId: number | "";
  onUnitIdChange: (id: number | "") => void;
  properties: Property[];
  filteredUnits: Unit[];
  title: string;
  onTitleChange: (v: string) => void;
  description: string;
  onDescriptionChange: (v: string) => void;
  category: string;
  onCategoryChange: (v: string) => void;
  priority: WorkOrderPriority;
  onPriorityChange: (v: WorkOrderPriority) => void;
  vendorId: number | "";
  onVendorIdChange: (id: number | "") => void;
  vendors: Vendor[];
  staff: StaffMember[];
  assignedStaffId: number | "";
  onAssignedStaffIdChange: (id: number | "") => void;
  scheduledAt: string;
  onScheduledAtChange: (v: string) => void;
  holdReason: string;
  onHoldReasonChange: (v: string) => void;
  followUpDate: string;
  onFollowUpDateChange: (v: string) => void;
  resolutionNotes: string;
  onResolutionNotesChange: (v: string) => void;
  permission: boolean;
  onPermissionChange: (v: boolean) => void;
  cost: string;
  onCostChange: (v: string) => void;
  notes: string;
  onNotesChange: (v: string) => void;
}

/** Staff/admin editable core + status companion fields. */
export function WorkOrderStaffFields({
  isCreate,
  isAdmin,
  readOnlyCore,
  hasAssignee,
  status,
  onStatusChange,
  propertyId,
  onPropertyIdChange,
  unitId,
  onUnitIdChange,
  properties,
  filteredUnits,
  title,
  onTitleChange,
  description,
  onDescriptionChange,
  category,
  onCategoryChange,
  priority,
  onPriorityChange,
  vendorId,
  onVendorIdChange,
  vendors,
  staff,
  assignedStaffId,
  onAssignedStaffIdChange,
  scheduledAt,
  onScheduledAtChange,
  holdReason,
  onHoldReasonChange,
  followUpDate,
  onFollowUpDateChange,
  resolutionNotes,
  onResolutionNotesChange,
  permission,
  onPermissionChange,
  cost,
  onCostChange,
  notes,
  onNotesChange,
}: Props) {
  const statusOptions = isAdmin
    ? ADMIN_STATUSES
    : staffStatusOptions(hasAssignee || status === "in_progress" || status === "scheduled");

  return (
    <>
      <div>
        <Label htmlFor="wo-title">Title</Label>
        <Input
          id="wo-title"
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          placeholder="Leaking kitchen faucet"
          disabled={readOnlyCore}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Property</Label>
          <Select
            value={String(propertyId || "")}
            onValueChange={(v) => {
              onPropertyIdChange(v ? Number(v) : "");
              onUnitIdChange("");
            }}
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
            onValueChange={(v) => onUnitIdChange(v ? Number(v) : "")}
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
          onChange={(e) => onDescriptionChange(e.target.value)}
          rows={3}
          disabled={readOnlyCore}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Category</Label>
          <Select value={category} onValueChange={onCategoryChange} disabled={readOnlyCore}>
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
          <Select value={priority} onValueChange={(v) => onPriorityChange(v as WorkOrderPriority)}>
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
            onValueChange={(v) => onStatusChange(v as WorkOrderStatus)}
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
          {!isAdmin && !hasAssignee && !isCreate && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              In progress unlocks after an admin assigns staff.
            </p>
          )}
        </div>
        <div>
          <Label>Vendor</Label>
          <Select
            value={String(vendorId || "")}
            onValueChange={(v) => onVendorIdChange(v ? Number(v) : "")}
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
        <div className="grid grid-cols-2 gap-3 rounded border p-3">
          <div className="sm:col-span-2 text-xs font-medium text-muted-foreground">
            Required for {status === "scheduled" ? "Scheduled" : "In progress"}
          </div>
          <div>
            <Label>Assigned staff</Label>
            <Select
              value={String(assignedStaffId || "")}
              onValueChange={(v) => onAssignedStaffIdChange(v ? Number(v) : "")}
            >
              <SelectTrigger>
                <SelectValue placeholder="Staff" />
              </SelectTrigger>
              <SelectContent>
                {staff.map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {s.last_name}, {s.first_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {status === "scheduled" && (
            <div>
              <Label>Scheduled date</Label>
              <Input
                type="date"
                value={scheduledAt}
                onChange={(e) => onScheduledAtChange(e.target.value)}
              />
            </div>
          )}
        </div>
      )}

      {status === "on_hold" && (
        <div className="grid gap-2 rounded border p-3">
          <p className="text-xs font-medium text-muted-foreground">Required for On hold</p>
          <div>
            <Label>Hold reason</Label>
            <Input
              value={holdReason}
              onChange={(e) => onHoldReasonChange(e.target.value)}
              placeholder="Waiting on parts…"
            />
          </div>
          <div>
            <Label>Follow-up date</Label>
            <Input
              type="date"
              value={followUpDate}
              onChange={(e) => onFollowUpDateChange(e.target.value)}
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
              onChange={(e) => onResolutionNotesChange(e.target.value)}
              rows={2}
              placeholder="What fixed it?"
            />
          </div>
        </div>
      )}

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={permission}
          onChange={(e) => onPermissionChange(e.target.checked)}
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
          <Input id="wo-cost" type="number" value={cost} onChange={(e) => onCostChange(e.target.value)} />
        </div>
      </div>

      <div>
        <Label htmlFor="wo-notes">Internal notes</Label>
        <Textarea id="wo-notes" value={notes} onChange={(e) => onNotesChange(e.target.value)} rows={2} />
      </div>
    </>
  );
}
