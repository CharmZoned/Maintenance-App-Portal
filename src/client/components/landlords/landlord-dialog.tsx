import { useEffect, useState } from "react";
import { useApp } from "@/context";
import { Button } from "@/components/ui/button";
import { ConfirmDelete } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Landlord } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  landlord?: Landlord;
  onSaved?: (l: Landlord) => void;
}

export function LandlordDialog({ open, onOpenChange, landlord, onSaved }: Props) {
  const app = useApp();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [company, setCompany] = useState("");
  const [preferred, setPreferred] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFirstName(landlord?.first_name ?? "");
    setLastName(landlord?.last_name ?? "");
    setEmail(landlord?.email ?? "");
    setPhone(landlord?.phone ?? "");
    setCompany(landlord?.company_name ?? "");
    setPreferred(landlord?.preferred_contact ?? "");
    setNotes(landlord?.notes ?? "");
  }, [open, landlord]);

  async function save() {
    if (!firstName.trim() || !lastName.trim() || !email.trim()) return;
    setSaving(true);
    try {
      const payload = {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        email: email.trim(),
        phone: phone.trim() || null,
        company_name: company.trim() || null,
        preferred_contact: preferred.trim() || null,
        notes: notes.trim() || null,
      };
      const saved = landlord
        ? await app.updateLandlord(landlord.id, payload)
        : await app.createLandlord(payload);
      onSaved?.(saved);
      onOpenChange(false);
    } catch (err) {
      app.setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!landlord) return;
    try {
      await app.deleteLandlord(landlord.id);
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
            <DialogTitle>{landlord ? "Edit landlord" : "New landlord"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>First name</Label>
              <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Last name</Label>
              <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Email</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Phone</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Company</Label>
              <Input value={company} onChange={(e) => setCompany(e.target.value)} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Preferred contact</Label>
              <Input value={preferred} onChange={(e) => setPreferred(e.target.value)} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Notes</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            {landlord ? (
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
              <Button type="button" onClick={() => void save()} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDelete
        open={confirming}
        onOpenChange={setConfirming}
        title="Delete landlord?"
        description="Properties linked to this landlord must be reassigned first."
        onConfirm={() => void remove()}
      />
    </>
  );
}
