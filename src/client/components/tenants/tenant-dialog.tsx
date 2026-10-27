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
import type { Tenant, Unit } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenant?: Tenant;
  onSaved?: (t: Tenant) => void;
}

export function TenantDialog({ open, onOpenChange, tenant, onSaved }: Props) {
  const app = useApp();
  const [firstName, setFirstName] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [units, setUnits] = useState<Unit[]>([]);
  const [unitId, setUnitId] = useState("");
  const [primaryOnLease, setPrimaryOnLease] = useState(true);
  const [inviteToApp, setInviteToApp] = useState(false);
  const [dob, setDob] = useState("");
  const [employer, setEmployer] = useState("");
  const [income, setIncome] = useState("");
  const [emergency, setEmergency] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    app.listUnits().then(setUnits).catch((err) => app.setError((err as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setUnitId(tenant?.unit_id ? String(tenant.unit_id) : "");
    setPrimaryOnLease(tenant?.primary_on_lease ?? true);
    setInviteToApp(tenant?.invite_to_app ?? false);
    setFirstName(tenant?.first_name ?? "");
    setLastName(tenant?.last_name ?? "");
    setEmail(tenant?.email ?? "");
    setPhone(tenant?.mobile_phone ?? "");
    setDob(tenant?.date_of_birth ?? "");
    setEmployer(tenant?.employer ?? "");
    setIncome(tenant?.monthly_income ? String(tenant.monthly_income) : "");
    setEmergency(tenant?.emergency_contact ?? "");
    setNotes(tenant?.notes ?? "");
  }, [open, tenant]);

  const canSave = !!firstName.trim() && !!lastName.trim() && !!email.trim() && !!unitId;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    try {
      const payload = {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        email: email.trim(),
        mobile_phone: phone.trim() || null,
        unit_id: Number(unitId),
        primary_on_lease: primaryOnLease,
        invite_to_app: inviteToApp,
        date_of_birth: dob || null,
        employer: employer.trim() || null,
        monthly_income: income ? parseFloat(income) : null,
        emergency_contact: emergency.trim() || null,
        notes: notes.trim() || null,
      };
      const saved = tenant
        ? await app.updateTenant(tenant.id, payload)
        : await app.createTenant(payload);
      onSaved?.(saved);
      onOpenChange(false);
    } catch (err) {
      app.setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!tenant) return;
    try {
      await app.deleteTenant(tenant.id);
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
          <DialogTitle>{tenant ? "Edit tenant" : "New tenant"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          {tenant && (tenant.source_id || tenant.is_test_data) && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {tenant.source_id && <span>Source ID: <span className="font-mono">{tenant.source_id}</span></span>}
              <TestDataBadge show={tenant.is_test_data} />
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="t-first">First name</Label>
              <Input id="t-first" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="t-last">Last name</Label>
              <Input id="t-last" value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="t-email">Email</Label>
              <Input id="t-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="t-phone">Mobile phone</Label>
              <Input id="t-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>
          <div>
            <Label>Unit</Label>
            <Select value={unitId} onValueChange={setUnitId}>
              <SelectTrigger><SelectValue placeholder="Select unit" /></SelectTrigger>
              <SelectContent>
                {units.map((u) => (
                  <SelectItem key={u.id} value={String(u.id)}>
                    {u.property_name ?? "—"} · {u.unit_label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-[var(--brand)]"
                checked={primaryOnLease}
                onChange={(e) => setPrimaryOnLease(e.target.checked)}
              />
              Primary on lease
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-[var(--brand)]"
                checked={inviteToApp}
                onChange={(e) => setInviteToApp(e.target.checked)}
              />
              Invite to app
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="t-dob">Date of birth</Label>
              <Input id="t-dob" type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="t-emerg">Emergency contact</Label>
              <Input id="t-emerg" value={emergency} onChange={(e) => setEmergency(e.target.value)} placeholder="Name · phone" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="t-emp">Employer</Label>
              <Input id="t-emp" value={employer} onChange={(e) => setEmployer(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="t-inc">Monthly income</Label>
              <Input id="t-inc" type="number" value={income} onChange={(e) => setIncome(e.target.value)} />
            </div>
          </div>
          <div>
            <Label htmlFor="t-notes">Notes</Label>
            <Textarea id="t-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter className="mt-2">
          {tenant && (
            <Button type="button" variant="destructive" className="sm:mr-auto" onClick={() => setConfirming(true)}>
              Delete
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" onClick={save} disabled={saving || !canSave}>
            {tenant ? "Save changes" : "Create tenant"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

      {tenant ? (
        <ConfirmDelete
          open={confirming}
          onOpenChange={setConfirming}
          title={`Delete ${tenant.first_name} ${tenant.last_name}?`}
          description="Their leases and rent history go with them. This cannot be undone."
          onConfirm={remove}
        />
      ) : null}
    </>
  );
}
