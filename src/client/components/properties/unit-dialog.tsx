import { useEffect, useState } from "react";
import { useApp } from "@/context";
import { Button } from "@/components/ui/button";
import { ConfirmDelete } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { TestDataBadge } from "@/components/test-data-badge";
import type { ReadinessStatus, Unit, UnitManagementStatus, UnitStatus } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  propertyId: number;
  unit?: Unit;
  onSaved?: () => void;
}

const STATUSES: UnitStatus[] = ["Vacant", "Occupied"];
const MANAGEMENT_STATUSES: UnitManagementStatus[] = ["Active", "No Longer Managed"];
const READINESS: ReadinessStatus[] = [
  "Ready",
  "Turnover Needed",
  "Turnover In Progress",
  "Rehab Needed",
  "Rehab In Progress",
];

export function UnitDialog({ open, onOpenChange, propertyId, unit, onSaved }: Props) {
  const app = useApp();
  const [name, setName] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [bedrooms, setBedrooms] = useState("1");
  const [bathrooms, setBathrooms] = useState("1");
  const [sqft, setSqft] = useState("");
  const [marketRent, setMarketRent] = useState("0");
  const [status, setStatus] = useState<UnitStatus>("Vacant");
  const [managementStatus, setManagementStatus] = useState<UnitManagementStatus>("Active");
  const [readiness, setReadiness] = useState<ReadinessStatus>("Ready");
  const [marketed, setMarketed] = useState(false);
  const [managementEnd, setManagementEnd] = useState("");
  const [moveOut, setMoveOut] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(unit?.unit_label ?? "");
    setBedrooms(String(unit?.bedrooms ?? 1));
    setBathrooms(String(unit?.bathrooms ?? 1));
    setSqft(unit?.sqft ? String(unit.sqft) : "");
    setMarketRent(String(unit?.market_rent ?? 0));
    setStatus(unit?.status ?? "Vacant");
    setManagementStatus(unit?.management_status ?? "Active");
    setReadiness(unit?.readiness_status ?? "Ready");
    setMarketed(unit?.currently_being_marketed ?? false);
    setManagementEnd(unit?.management_end_date?.slice(0, 10) ?? "");
    setMoveOut(unit?.expected_move_out_date?.slice(0, 10) ?? "");
    setNotes(unit?.notes ?? "");
  }, [open, unit]);

  async function save() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const payload = {
        property_id: propertyId,
        unit_label: name.trim(),
        bedrooms: parseFloat(bedrooms) || 0,
        bathrooms: parseFloat(bathrooms) || 0,
        sqft: sqft ? parseInt(sqft, 10) : null,
        market_rent: parseFloat(marketRent) || 0,
        status,
        management_status: managementStatus,
        readiness_status: readiness,
        currently_being_marketed: marketed,
        management_end_date: managementEnd || null,
        expected_move_out_date: moveOut || null,
        notes: notes.trim() || null,
      };
      if (unit) {
        await app.updateUnit(unit.id, payload);
      } else {
        await app.createUnit(payload);
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
    if (!unit) return;
    try {
      await app.deleteUnit(unit.id);
      onSaved?.();
      onOpenChange(false);
    } catch (err) {
      app.setError((err as Error).message);
    }
  }

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{unit ? "Edit unit" : "New unit"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          {unit && (unit.source_id || unit.is_test_data || unit.occupancy_status) && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {unit.source_id && <span>Source ID: <span className="font-mono">{unit.source_id}</span></span>}
              {unit.occupancy_status && <span>Occupancy: {unit.occupancy_status}</span>}
              <TestDataBadge show={unit.is_test_data} />
            </div>
          )}
          <div>
            <Label htmlFor="unit-name">Unit label</Label>
            <Input id="unit-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Unit 1A" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="unit-beds">Bedrooms</Label>
              <Input id="unit-beds" type="number" step="0.5" value={bedrooms} onChange={(e) => setBedrooms(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="unit-baths">Bathrooms</Label>
              <Input id="unit-baths" type="number" step="0.5" value={bathrooms} onChange={(e) => setBathrooms(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="unit-sqft">Sq ft</Label>
              <Input id="unit-sqft" type="number" value={sqft} onChange={(e) => setSqft(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="unit-rent">Market rent</Label>
              <Input id="unit-rent" type="number" value={marketRent} onChange={(e) => setMarketRent(e.target.value)} />
            </div>
            <div>
              <Label>Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as UnitStatus)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Readiness</Label>
              <Select value={readiness} onValueChange={(v) => setReadiness(v as ReadinessStatus)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {READINESS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Management status</Label>
              <Select value={managementStatus} onValueChange={(v) => setManagementStatus(v as UnitManagementStatus)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MANAGEMENT_STATUSES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="unit-mgmt-end">Management end date</Label>
              <Input id="unit-mgmt-end" type="date" value={managementEnd} onChange={(e) => setManagementEnd(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="unit-moveout">Expected move-out</Label>
              <Input id="unit-moveout" type="date" value={moveOut} onChange={(e) => setMoveOut(e.target.value)} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-[var(--brand)]"
              checked={marketed}
              onChange={(e) => setMarketed(e.target.checked)}
            />
            Currently being marketed
          </label>
          <div>
            <Label htmlFor="unit-notes">Notes</Label>
            <Textarea id="unit-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter className="mt-2">
          {unit && (
            <Button type="button" variant="destructive" className="sm:mr-auto" onClick={() => setConfirming(true)}>
              Delete
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" onClick={save} disabled={saving || !name.trim()}>
            {unit ? "Save changes" : "Create unit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

      {unit ? (
        <ConfirmDelete
          open={confirming}
          onOpenChange={setConfirming}
          title={`Delete unit "${unit.unit_label}"?`}
          description="Its leases and rent history go with it. This cannot be undone."
          onConfirm={remove}
        />
      ) : null}
    </>
  );
}
