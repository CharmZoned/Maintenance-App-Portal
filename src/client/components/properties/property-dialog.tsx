import { useEffect, useState } from "react";
import { useApp } from "@/context";
import { cn, colorClasses } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ConfirmDelete } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { TestDataBadge } from "@/components/test-data-badge";
import type { OccupancyStatus, Property, PropertyManagementStatus, PropertyType } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  property?: Property;
  onSaved?: (p: Property) => void;
}

export const PROPERTY_TYPES: PropertyType[] = [
  "Single-family",
  "Multi-family",
  "Condo",
  "Townhouse",
  "Apartment building",
  "Commercial",
  "Other",
];

const MANAGEMENT_STATUSES: PropertyManagementStatus[] = ["Active", "Partially Managed", "No Longer Managed"];


const COLORS = ["sky", "emerald", "amber", "rose", "violet", "fuchsia", "teal", "orange", "slate"];

export function PropertyDialog({ open, onOpenChange, property, onSaved }: Props) {
  const app = useApp();
  const [name, setName] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [type, setType] = useState<PropertyType>("Single-family");
  const [landlordId, setLandlordId] = useState("");
  const [managementStatus, setManagementStatus] = useState<PropertyManagementStatus>("Active");
  const [managementEnd, setManagementEnd] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [stateName, setStateName] = useState("");
  const [zip, setZip] = useState("");
  const [yearBuilt, setYearBuilt] = useState("");
  const [color, setColor] = useState("sky");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(property?.property_name ?? "");
    setType(property?.property_type ?? "Single-family");
    setLandlordId(property?.landlord_id ? String(property.landlord_id) : "");
    setManagementStatus(property?.management_status ?? "Active");
    setManagementEnd(property?.management_end_date?.slice(0, 10) ?? "");
    setAddress(property?.street_address ?? "");
    setCity(property?.city ?? "");
    setStateName(property?.state ?? "");
    setZip(property?.zip ?? "");
    setYearBuilt(property?.year_built ? String(property.year_built) : "");
    setColor(property?.color ?? "sky");
    setNotes(property?.notes ?? "");
  }, [open, property]);

  const canSave =
    !!address.trim() && !!city.trim() && /^[A-Za-z]{2}$/.test(stateName.trim()) &&
    /^[0-9]{5}$/.test(zip.trim()) && !!landlordId;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    try {
      const payload = {
        property_name: name.trim() || null,
        street_address: address.trim(),
        city: city.trim(),
        state: stateName.trim().toUpperCase(),
        zip: zip.trim(),
        property_type: type,
        landlord_id: Number(landlordId),
        management_status: managementStatus,
        management_end_date: managementEnd || null,
        year_built: yearBuilt ? parseInt(yearBuilt, 10) : null,
        color,
        notes: notes.trim() || null,
      };
      const saved = property
        ? await app.updateProperty(property.id, payload)
        : await app.createProperty(payload);
      onSaved?.(saved);
      onOpenChange(false);
    } catch (err) {
      app.setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!property) return;
    try {
      await app.deleteProperty(property.id);
      onOpenChange(false);
    } catch (err) {
      app.setError((err as Error).message);
    }
  }

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{property ? "Edit property" : "New property"}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-3">
          {property && (property.source_id || property.is_test_data) && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {property.source_id && <span>Source ID: <span className="font-mono">{property.source_id}</span></span>}
              <TestDataBadge show={property.is_test_data} />
            </div>
          )}
          <div>
            <Label htmlFor="prop-name">Property name</Label>
            <Input id="prop-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Oakwood Estate (optional)" />
          </div>
          <div>
            <Label htmlFor="prop-addr">Street address</Label>
            <Input id="prop-addr" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="123 Main St" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="prop-city">City</Label>
              <Input id="prop-city" value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="prop-state">State</Label>
              <Input id="prop-state" value={stateName} maxLength={2} onChange={(e) => setStateName(e.target.value.toUpperCase())} placeholder="CA" />
            </div>
            <div>
              <Label htmlFor="prop-zip">Zip</Label>
              <Input id="prop-zip" value={zip} maxLength={5} inputMode="numeric" onChange={(e) => setZip(e.target.value)} placeholder="90210" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Property type</Label>
              <Select value={type} onValueChange={(v) => setType(v as PropertyType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PROPERTY_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Landlord</Label>
              <Select value={landlordId} onValueChange={setLandlordId}>
                <SelectTrigger><SelectValue placeholder="Select landlord" /></SelectTrigger>
                <SelectContent>
                  {app.landlords.map((l) => (
                    <SelectItem key={l.id} value={String(l.id)}>
                      {l.first_name} {l.last_name}{l.company_name ? ` · ${l.company_name}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {app.landlords.length === 0 && (
                <p className="mt-1 text-xs text-muted-foreground">Add a landlord first.</p>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Management status</Label>
              <Select value={managementStatus} onValueChange={(v) => setManagementStatus(v as PropertyManagementStatus)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MANAGEMENT_STATUSES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="prop-mgmt-end">Management end date</Label>
              <Input id="prop-mgmt-end" type="date" value={managementEnd} onChange={(e) => setManagementEnd(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="prop-year">Year built</Label>
              <Input id="prop-year" type="number" value={yearBuilt} onChange={(e) => setYearBuilt(e.target.value)} />
            </div>
            <div>
              <Label>Color</Label>
              <Select value={color} onValueChange={setColor}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {COLORS.map((c) => (
                    <SelectItem key={c} value={c}>
                      <span className="flex items-center gap-2">
                        <span className={cn("h-3 w-3 rounded-full", colorClasses(c).dot)} />
                        <span className="capitalize">{c}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Occupancy</Label>
              <div className="flex h-8 items-center text-sm text-muted-foreground">
                {(property?.occupancy_status as OccupancyStatus | undefined) ?? "Calculated automatically"}
              </div>
            </div>
          </div>
          <div>
            <Label htmlFor="prop-notes">Notes</Label>
            <Textarea id="prop-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          </div>
        </div>

        <DialogFooter className="mt-2">
          {property && (
            <Button type="button" variant="destructive" className="sm:mr-auto" onClick={() => setConfirming(true)}>
              Delete
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" onClick={save} disabled={saving || !canSave}>
            {property ? "Save changes" : "Create property"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

      {property ? (
        <ConfirmDelete
          open={confirming}
          onOpenChange={setConfirming}
          title={`Delete "${property.property_name || property.street_address}"?`}
          description="Its units, leases, and rent history go with it. This cannot be undone."
          onConfirm={remove}
        />
      ) : null}
    </>
  );
}
