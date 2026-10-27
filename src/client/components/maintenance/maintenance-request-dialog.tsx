import { useEffect, useMemo, useState } from "react";
import { useApp } from "@/context";
import { Button } from "@/components/ui/button";
import { ConfirmDelete } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { TestDataBadge } from "@/components/test-data-badge";
import type {
  MaintenanceCategory,
  MaintenancePriority,
  MaintenanceRequest,
  MaintenanceStatus,
  Tenant,
  Unit,
} from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  request?: MaintenanceRequest;
  defaults?: { property_id?: number; unit_id?: number };
  onSaved?: () => void;
}

export const MAINTENANCE_CATEGORIES: MaintenanceCategory[] = [
  "Plumbing",
  "Electrical",
  "Heating / AC",
  "Appliance",
  "Pest control",
  "Locks / keys / doors",
  "Windows",
  "Roof / leaks",
  "Mold / water damage",
  "Exterior / yard",
  "General repair",
  "Other",
];
export const MAINTENANCE_PRIORITIES: MaintenancePriority[] = ["Low", "Normal", "High", "Urgent"];
export const MAINTENANCE_STATUSES: MaintenanceStatus[] = ["Open", "Scheduled", "In Progress", "On Hold", "Closed"];

const NONE = "none";

/** ISO timestamp -> value for <input type="datetime-local"> in local time. */
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function MaintenanceRequestDialog({ open, onOpenChange, request, defaults, onSaved }: Props) {
  const app = useApp();
  const [units, setUnits] = useState<Unit[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [propertyId, setPropertyId] = useState("");
  const [unitId, setUnitId] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [staffId, setStaffId] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<MaintenanceCategory | "">("");
  const [priority, setPriority] = useState<MaintenancePriority>("Normal");
  const [status, setStatus] = useState<MaintenanceStatus>("Open");
  const [scheduledFor, setScheduledFor] = useState("");
  const [startedAt, setStartedAt] = useState("");
  const [holdReason, setHoldReason] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [closedAt, setClosedAt] = useState("");
  const [resolution, setResolution] = useState("");
  const [cost, setCost] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const [u, t] = await Promise.all([app.listUnits(), app.listTenants()]);
        setUnits(u);
        setTenants(t);
      } catch (err) {
        app.setError((err as Error).message);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const propId = request?.property_id ?? request?.resolved_property_id ?? defaults?.property_id;
    setPropertyId(propId ? String(propId) : "");
    const uid = request?.unit_id ?? defaults?.unit_id;
    setUnitId(uid ? String(uid) : "");
    setTenantId(request?.submitted_by_tenant_id ? String(request.submitted_by_tenant_id) : "");
    setStaffId(request?.assigned_staff_id ? String(request.assigned_staff_id) : "");
    setVendorId(request?.vendor_id ? String(request.vendor_id) : "");
    setTitle(request?.title ?? "");
    setDescription(request?.description ?? "");
    setCategory(request?.category ?? "");
    setPriority(request?.priority ?? "Normal");
    setStatus(request?.status ?? "Open");
    setScheduledFor(toLocalInput(request?.scheduled_for));
    setStartedAt(toLocalInput(request?.started_at));
    setHoldReason(request?.hold_reason ?? "");
    setFollowUp(request?.next_follow_up_date?.slice(0, 10) ?? "");
    setClosedAt(toLocalInput(request?.closed_at));
    setResolution(request?.resolution_notes ?? "");
    setCost(request?.cost != null ? String(request.cost) : "");
    setNotes(request?.notes ?? "");
  }, [open, request, defaults]);

  const filteredUnits = useMemo(() => {
    if (!propertyId) return units;
    return units.filter((u) => u.property_id === Number(propertyId));
  }, [units, propertyId]);

  const filteredTenants = useMemo(() => {
    if (!unitId) return tenants;
    const forUnit = tenants.filter((t) => t.unit_id === Number(unitId));
    return forUnit.length > 0 ? forUnit : tenants;
  }, [tenants, unitId]);

  function pickUnit(v: string) {
    const next = v === NONE ? "" : v;
    setUnitId(next);
    const u = units.find((x) => x.id === Number(next));
    if (u) setPropertyId(String(u.property_id));
  }

  const hasLocation = !!propertyId || !!unitId;
  const canSave = !!title.trim() && !!description.trim() && !!category && hasLocation;

  async function save() {
    if (!canSave || !category) return;
    setSaving(true);
    try {
      const payload = {
        // A unit already implies its property; send only the one the user chose.
        property_id: unitId ? null : propertyId ? Number(propertyId) : null,
        unit_id: unitId ? Number(unitId) : null,
        submitted_by_tenant_id: tenantId ? Number(tenantId) : null,
        assigned_staff_id: staffId ? Number(staffId) : null,
        vendor_id: vendorId ? Number(vendorId) : null,
        title: title.trim(),
        description: description.trim(),
        category,
        priority,
        status,
        scheduled_for: fromLocalInput(scheduledFor),
        started_at: fromLocalInput(startedAt),
        hold_reason: holdReason.trim() || null,
        next_follow_up_date: followUp || null,
        closed_at: fromLocalInput(closedAt),
        resolution_notes: resolution.trim() || null,
        cost: cost ? parseFloat(cost) : null,
        notes: notes.trim() || null,
      };
      if (request) {
        await app.updateMaintenanceRequest(request.id, payload);
      } else {
        await app.createMaintenanceRequest(payload);
      }
      onSaved?.();
      onOpenChange(false);
    } catch (err) {
      app.setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!request) return;
    try {
      await app.deleteMaintenanceRequest(request.id);
      onSaved?.();
      onOpenChange(false);
    } catch (err) {
      app.setError((err as Error).message);
    }
  }

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{request ? "Edit maintenance request" : "New maintenance request"}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-3">
          {request && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>Request <span className="font-mono text-foreground">{request.request_number}</span></span>
              <TestDataBadge show={request.is_test_data} />
            </div>
          )}
          <div>
            <Label htmlFor="mr-title">Title</Label>
            <Input id="mr-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Leaking kitchen faucet" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Category</Label>
              <Select value={category} onValueChange={(v) => setCategory(v as MaintenanceCategory)}>
                <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>
                  {MAINTENANCE_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Priority</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as MaintenancePriority)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MAINTENANCE_PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as MaintenanceStatus)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MAINTENANCE_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="mr-desc">Description</Label>
            <Textarea id="mr-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Property</Label>
              <Select
                value={propertyId}
                onValueChange={(v) => { setPropertyId(v === NONE ? "" : v); setUnitId(""); }}
              >
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>None</SelectItem>
                  {app.properties.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>{p.property_name || p.street_address}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Unit</Label>
              <Select value={unitId} onValueChange={pickUnit}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>None</SelectItem>
                  {filteredUnits.map((u) => (
                    <SelectItem key={u.id} value={String(u.id)}>{u.unit_label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {!hasLocation && (
            <p className="-mt-1 text-xs text-muted-foreground">Choose a unit or a property.</p>
          )}

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Submitted by tenant</Label>
              <Select value={tenantId} onValueChange={(v) => setTenantId(v === NONE ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>None</SelectItem>
                  {filteredTenants.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>{t.first_name} {t.last_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Assigned staff</Label>
              <Select value={staffId} onValueChange={(v) => setStaffId(v === NONE ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Unassigned</SelectItem>
                  {app.staff.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>{s.first_name} {s.last_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Vendor</Label>
              <Select value={vendorId} onValueChange={(v) => setVendorId(v === NONE ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>None</SelectItem>
                  {app.vendors.map((v) => (
                    <SelectItem key={v.id} value={String(v.id)}>{v.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="mr-sched">Scheduled for</Label>
              <Input id="mr-sched" type="datetime-local" value={scheduledFor} onChange={(e) => setScheduledFor(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="mr-started">Started at</Label>
              <Input id="mr-started" type="datetime-local" value={startedAt} onChange={(e) => setStartedAt(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="mr-closed">Closed at</Label>
              <Input id="mr-closed" type="datetime-local" value={closedAt} onChange={(e) => setClosedAt(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <Label htmlFor="mr-hold">Hold reason</Label>
              <Input id="mr-hold" value={holdReason} onChange={(e) => setHoldReason(e.target.value)} placeholder="Waiting on parts" />
            </div>
            <div>
              <Label htmlFor="mr-follow">Next follow-up</Label>
              <Input id="mr-follow" type="date" value={followUp} onChange={(e) => setFollowUp(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <Label htmlFor="mr-resolution">Resolution notes</Label>
              <Textarea id="mr-resolution" value={resolution} onChange={(e) => setResolution(e.target.value)} rows={2} />
            </div>
            <div>
              <Label htmlFor="mr-cost">Cost</Label>
              <Input id="mr-cost" type="number" min={0} step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} />
            </div>
          </div>
          <div>
            <Label htmlFor="mr-notes">Notes</Label>
            <Textarea id="mr-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
        </div>

        <DialogFooter className="mt-2">
          {request && (
            <Button type="button" variant="destructive" className="sm:mr-auto" onClick={() => setConfirming(true)}>
              Delete
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" onClick={save} disabled={saving || !canSave}>
            {request ? "Save changes" : "Create request"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

      <ConfirmDelete
        open={confirming}
        onOpenChange={setConfirming}
        title="Delete this maintenance request?"
        description="Its history and notes go with it. This cannot be undone."
        onConfirm={remove}
      />
    </>
  );
}
