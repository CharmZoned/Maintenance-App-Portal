import { useEffect, useState } from "react";
import * as data from "@/lib/data";
import { useApp } from "@/context";
import { Button } from "@/components/ui/button";
import { ConfirmDelete } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Application, ApplicationStatus, Unit } from "@/types";

const STATUSES: ApplicationStatus[] = ["new", "screening", "approved", "declined", "withdrawn"];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  application?: Application;
  units: Unit[];
  canDelete: boolean;
  onSaved: () => void;
}

export function ApplicationDialog({
  open,
  onOpenChange,
  application,
  units,
  canDelete,
  onSaved,
}: Props) {
  const app = useApp();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [employer, setEmployer] = useState("");
  const [income, setIncome] = useState("");
  const [moveIn, setMoveIn] = useState("");
  const [unitId, setUnitId] = useState<string>("none");
  const [status, setStatus] = useState<ApplicationStatus>("new");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFirstName(application?.first_name ?? "");
    setLastName(application?.last_name ?? "");
    setEmail(application?.email ?? "");
    setPhone(application?.phone ?? "");
    setEmployer(application?.employer ?? "");
    setIncome(application?.monthly_income != null ? String(application.monthly_income) : "");
    setMoveIn(application?.desired_move_in ?? "");
    setUnitId(application?.unit_id != null ? String(application.unit_id) : "none");
    setStatus(application?.status ?? "new");
    setNotes(application?.notes ?? "");
  }, [open, application]);

  async function save() {
    if (!firstName.trim() || !lastName.trim()) return;
    setSaving(true);
    try {
      const payload = {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        email: email.trim() || null,
        phone: phone.trim() || null,
        employer: employer.trim() || null,
        monthly_income: income.trim() ? Number(income) : null,
        desired_move_in: moveIn.trim() || null,
        unit_id: unitId === "none" ? null : Number(unitId),
        status,
        notes: notes.trim() || null,
      };
      if (application) {
        await data.updateApplication(application.id, payload);
      } else {
        await data.createApplication(payload);
      }
      onSaved();
      onOpenChange(false);
    } catch (err) {
      app.setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!application) return;
    try {
      await data.deleteApplication(application.id);
      onSaved();
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
            <DialogTitle>
              {application ? "Edit rental application" : "New rental application"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid max-h-[70vh] gap-3 overflow-y-auto py-2 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="app-fn">First name</Label>
              <Input id="app-fn" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="app-ln">Last name</Label>
              <Input id="app-ln" value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="app-email">Email</Label>
              <Input
                id="app-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="app-phone">Phone</Label>
              <Input id="app-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="app-employer">Employer</Label>
              <Input
                id="app-employer"
                value={employer}
                onChange={(e) => setEmployer(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="app-income">Monthly income</Label>
              <Input
                id="app-income"
                type="number"
                value={income}
                onChange={(e) => setIncome(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="app-movein">Desired move-in</Label>
              <Input
                id="app-movein"
                type="date"
                value={moveIn ?? ""}
                onChange={(e) => setMoveIn(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as ApplicationStatus)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Unit</Label>
              <Select value={unitId} onValueChange={setUnitId}>
                <SelectTrigger>
                  <SelectValue placeholder="Unit" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No unit</SelectItem>
                  {units.map((u) => (
                    <SelectItem key={u.id} value={String(u.id)}>
                      {u.property_name ? `${u.property_name} · ` : ""}
                      {u.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="app-notes">Notes</Label>
              <Textarea id="app-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            {application && canDelete ? (
              <Button type="button" variant="destructive" onClick={() => setConfirming(true)}>
                Delete
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                disabled={saving || !firstName.trim() || !lastName.trim()}
                onClick={() => void save()}
              >
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDelete
        open={confirming}
        onOpenChange={setConfirming}
        title={`Delete application for “${application?.first_name} ${application?.last_name}”?`}
        description="This removes the rental applicant record. It does not affect portal user accounts."
        confirmLabel="Delete"
        onConfirm={() => void remove()}
      />
    </>
  );
}
