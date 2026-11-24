import { useEffect, useId, useState } from "react";
import { CheckCircle2, TriangleAlert } from "lucide-react";
import * as data from "@/lib/data";
import type { StaffMember } from "@/lib/data";
import { friendlyAccountError } from "@/lib/account-errors";
import { MAINTENANCE_CATEGORIES } from "@/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Add or edit a team member (a Staff row). There is no server-side invite:
 * after adding, the dialog explains how the person gets access — they sign up
 * with this email, the sign-up trigger links them to this record, and the
 * account waits in Approvals.
 */
export function TeamMemberDialog({
  open,
  onOpenChange,
  member,
  hasLogin,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Edit when set; add when undefined. */
  member?: StaffMember;
  /** Whether a portal login is already linked (changes the access note). */
  hasLogin?: boolean;
  onSaved: (member: StaffMember) => void;
}) {
  const uid = useId();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [company, setCompany] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [services, setServices] = useState<string[]>([]);
  const [alerts, setAlerts] = useState(true);
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<StaffMember | null>(null);

  useEffect(() => {
    if (!open) return;
    setFirstName(member?.first_name ?? "");
    setLastName(member?.last_name ?? "");
    setEmail(member?.email ?? "");
    setPhone(member?.phone ?? "");
    setCompany(member?.company_name ?? "");
    setJobTitle(member?.job_title ?? "");
    setServices(member?.services ?? []);
    setAlerts(member?.gets_request_alerts ?? true);
    setActive(member?.active ?? true);
    setError(null);
    setSaving(false);
    setCreated(null);
  }, [open, member]);

  const valid =
    firstName.trim() !== "" && lastName.trim() !== "" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());

  function toggleService(s: string) {
    setServices((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));
  }

  async function save() {
    if (!valid) return;
    setSaving(true);
    setError(null);
    try {
      const payload = {
        first_name: firstName,
        last_name: lastName,
        email,
        phone: phone || null,
        company_name: company || null,
        job_title: jobTitle || null,
        services: MAINTENANCE_CATEGORIES.filter((c) => services.includes(c)),
        gets_request_alerts: alerts,
        active,
      };
      const saved = member ? await data.updateStaff(member.id, payload) : await data.createStaff(payload);
      onSaved(saved);
      if (member) onOpenChange(false);
      else setCreated(saved);
    } catch (err) {
      setError(friendlyAccountError((err as Error).message));
    } finally {
      setSaving(false);
    }
  }

  if (created) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md gap-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="size-5 text-success" aria-hidden />
              {created.first_name} {created.last_name} is on the team
            </DialogTitle>
            <DialogDescription>Next: give them portal access.</DialogDescription>
          </DialogHeader>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-foreground">
            <li>
              Ask them to sign up on the portal with <span className="font-medium">{created.email}</span>.
            </li>
            <li>
              Their sign-up appears in <span className="font-medium">People → Approvals</span>, already
              linked to this team member.
            </li>
            <li>Approve it there. They’ll see the jobs you assign them.</li>
          </ol>
          <DialogFooter>
            <Button type="button" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="max-w-xl gap-5">
        <DialogHeader>
          <DialogTitle>{member ? `Edit ${member.first_name} ${member.last_name}` : "Add team member"}</DialogTitle>
          <DialogDescription>
            {member
              ? hasLogin
                ? "Changes apply to their existing portal login."
                : "No portal login yet. They can sign up with this email and appear in Approvals."
              : "Maintenance professionals and office staff who work requests."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={`${uid}-first`}>First name</Label>
            <Input id={`${uid}-first`} value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${uid}-last`}>Last name</Label>
            <Input id={`${uid}-last`} value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor={`${uid}-email`}>Email</Label>
            <Input
              id={`${uid}-email`}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-describedby={`${uid}-email-hint`}
            />
            <p id={`${uid}-email-hint`} className="text-[12px] text-muted-foreground">
              They sign up with this email to get access.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${uid}-phone`}>Phone</Label>
            <Input id={`${uid}-phone`} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${uid}-company`}>Company (optional)</Label>
            <Input id={`${uid}-company`} value={company} onChange={(e) => setCompany(e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor={`${uid}-title`}>Job title (optional)</Label>
            <Input
              id={`${uid}-title`}
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
              placeholder="e.g. Plumber, Handyman, Office manager"
            />
          </div>
        </div>

        <fieldset>
          <legend className="text-sm font-medium text-foreground">Trades / services</legend>
          <p className="mb-2 text-[12px] text-muted-foreground">
            Jobs offered to the team only reach people whose trades match the request.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {MAINTENANCE_CATEGORIES.map((c) => {
              const on = services.includes(c);
              return (
                <label
                  key={c}
                  className={cn(
                    "inline-flex min-h-9 cursor-pointer items-center rounded-sm border px-2.5 text-[13px] transition-colors has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/40",
                    on
                      ? "border-primary bg-brand-tint/40 font-medium text-foreground"
                      : "border-border bg-card text-muted-foreground hover:bg-muted/50",
                  )}
                >
                  <input type="checkbox" className="sr-only" checked={on} onChange={() => toggleService(c)} />
                  {c}
                </label>
              );
            })}
          </div>
        </fieldset>

        <div className="space-y-2">
          <label className="flex min-h-11 items-start gap-2 text-sm text-foreground md:min-h-0">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-primary"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
            />
            <span>
              Active
              <span className="block text-[12px] text-muted-foreground">
                Turn off when they no longer take new work. Their past jobs stay.
              </span>
            </span>
          </label>
          <label className="flex min-h-11 items-start gap-2 text-sm text-foreground md:min-h-0">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-primary"
              checked={alerts}
              onChange={(e) => setAlerts(e.target.checked)}
            />
            <span>Gets new-request alerts</span>
          </label>
        </div>

        {error ? (
          <p role="alert" className="flex items-start gap-1.5 rounded-sm bg-destructive-tint px-3 py-2 text-[13px] text-destructive">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void save()} disabled={!valid || saving}>
            {saving ? "Saving…" : member ? "Save changes" : "Add team member"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
