import { useEffect, useState } from "react";
import { useApp } from "@/context";
import { Button } from "@/components/ui/button";
import { ConfirmDelete } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  UNIT_READINESS_LABELS,
  UNIT_READINESSES,
  UNIT_STATUSES,
  type Unit,
  type UnitReadiness,
  type UnitStatus,
} from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  propertyId: number;
  unit?: Unit;
  onSaved?: () => void;
}

const STATUSES: { value: UnitStatus; label: string }[] = UNIT_STATUSES.map((value) => ({
  value,
  label: value === "vacant" ? "Vacant" : "Occupied",
}));

const READINESSES: { value: UnitReadiness; label: string }[] = UNIT_READINESSES.map((value) => ({
  value,
  label: UNIT_READINESS_LABELS[value],
}));

export function UnitDialog({ open, onOpenChange, propertyId, unit, onSaved }: Props) {
  const app = useApp();
  const [name, setName] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [bedrooms, setBedrooms] = useState("1");
  const [bathrooms, setBathrooms] = useState("1");
  const [sqft, setSqft] = useState("");
  const [marketRent, setMarketRent] = useState("0");
  const [status, setStatus] = useState<UnitStatus>("vacant");
  const [readiness, setReadiness] = useState<UnitReadiness>("ready");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(unit?.name ?? "");
    setBedrooms(String(unit?.bedrooms ?? 1));
    setBathrooms(String(unit?.bathrooms ?? 1));
    setSqft(unit?.sqft ? String(unit.sqft) : "");
    setMarketRent(String(unit?.market_rent ?? 0));
    setStatus(unit?.status ?? "vacant");
    setReadiness(unit?.readiness_status ?? "ready");
    setNotes(unit?.notes ?? "");
  }, [open, unit]);

  async function save() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const payload = {
        property_id: propertyId,
        name: name.trim(),
        bedrooms: parseFloat(bedrooms) || 0,
        bathrooms: parseFloat(bathrooms) || 0,
        sqft: sqft ? parseInt(sqft, 10) : null,
        market_rent: parseFloat(marketRent) || 0,
        status,
        readiness_status: readiness,
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
          <div>
            <Label htmlFor="unit-name">Name</Label>
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
              <Label>Occupancy</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as UnitStatus)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Readiness</Label>
            <Select value={readiness} onValueChange={(v) => setReadiness(v as UnitReadiness)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {READINESSES.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="unit-notes">Notes</Label>
            <Textarea id="unit-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter className="mt-2">
          {unit && app.canMutatePortfolio && (
            <Button type="button" variant="destructive" className="sm:mr-auto" onClick={() => setConfirming(true)}>
              Delete
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          {app.canMutatePortfolio && (
            <Button type="button" onClick={save} disabled={saving || !name.trim()}>
              {unit ? "Save changes" : "Create unit"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>

      {unit ? (
        <ConfirmDelete
          open={confirming}
          onOpenChange={setConfirming}
          title={`Delete unit "${unit.name}"?`}
          description="Its leases and rent history go with it. This cannot be undone."
          onConfirm={remove}
        />
      ) : null}
    </>
  );
}
