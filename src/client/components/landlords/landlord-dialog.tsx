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
import type { Landlord, PreferredContact } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  landlord?: Landlord;
  onSaved?: (l: Landlord) => void;
}

const CONTACTS: PreferredContact[] = ["Email", "Phone", "Either"];
const UNSET = "unset";

export function LandlordDialog({ open, onOpenChange, landlord, onSaved }: Props) {
  const app = useApp();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [contact, setContact] = useState<PreferredContact | "">("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFirstName(landlord?.first_name ?? "");
    setLastName(landlord?.last_name ?? "");
    setCompany(landlord?.company_name ?? "");
    setEmail(landlord?.email ?? "");
    setPhone(landlord?.mobile_phone ?? "");
    setContact(landlord?.preferred_contact ?? "");
    setNotes(landlord?.notes ?? "");
  }, [open, landlord]);

  const canSave = !!firstName.trim() && !!lastName.trim() && !!email.trim();

  async function save() {
    if (!canSave) return;
    setSaving(true);
    try {
      const payload = {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        company_name: company.trim() || null,
        email: email.trim(),
        mobile_phone: phone.trim() || null,
        preferred_contact: contact || null,
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{landlord ? "Edit landlord" : "New landlord"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          {landlord && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {landlord.source_id && <span>Source ID: <span className="font-mono">{landlord.source_id}</span></span>}
              <span>{landlord.property_count ?? 0} {landlord.property_count === 1 ? "property" : "properties"}</span>
              <TestDataBadge show={landlord.is_test_data} />
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="ll-first">First name</Label>
              <Input id="ll-first" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="ll-last">Last name</Label>
              <Input id="ll-last" value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
          </div>
          <div>
            <Label htmlFor="ll-company">Company name</Label>
            <Input id="ll-company" value={company} onChange={(e) => setCompany(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="ll-email">Email</Label>
              <Input id="ll-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="ll-phone">Mobile phone</Label>
              <Input id="ll-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>
          <div>
            <Label>Preferred contact</Label>
            <Select value={contact} onValueChange={(v) => setContact(v === UNSET ? "" : (v as PreferredContact))}>
              <SelectTrigger><SelectValue placeholder="No preference" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={UNSET}>No preference</SelectItem>
                {CONTACTS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="ll-notes">Notes</Label>
            <Textarea id="ll-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          </div>
        </div>
        <DialogFooter className="mt-2">
          {landlord && (
            <Button type="button" variant="destructive" className="sm:mr-auto" onClick={() => setConfirming(true)}>
              Delete
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" onClick={save} disabled={saving || !canSave}>
            {landlord ? "Save changes" : "Create landlord"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

      {landlord ? (
        <ConfirmDelete
          open={confirming}
          onOpenChange={setConfirming}
          title={`Delete ${landlord.first_name} ${landlord.last_name}?`}
          description="Landlords that still own properties cannot be removed. This cannot be undone."
          onConfirm={remove}
        />
      ) : null}
    </>
  );
}
