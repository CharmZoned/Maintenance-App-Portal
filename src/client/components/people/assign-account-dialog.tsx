import { useEffect, useId, useMemo, useState } from "react";
import { TriangleAlert } from "lucide-react";
import * as data from "@/lib/data";
import type { StaffMember, UserAccountRow } from "@/lib/data";
import type { Landlord, Tenant } from "@/types";
import type { AppRole, Tables } from "@/types.supabase";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  RECORD_LABEL,
  ROLE_LABEL,
  displayName,
  linkedIdFor,
  roleNeedsRecord,
  signupClaim,
  splitName,
  suggestedRole,
} from "./account-labels";

const ROLE_ORDER: AppRole[] = ["tenant", "landlord", "maintenance", "admin"];

const ROLE_HINT: Record<AppRole, string> = {
  tenant: "Rent, requests and documents for their unit",
  landlord: "Read-only view of their properties",
  maintenance: "Jobs assigned to them",
  admin: "Full access to everything",
};

type Source = "existing" | "create";

type RecordOption = {
  id: number;
  label: string;
  sub: string;
  email: string | null;
  /** Email of another login already linked to this record. */
  heldBy: string | null;
};

export type AssignAccountMode = "approve" | "role";

/**
 * One dialog for "Approve…" (Approvals, Users) and for changing a role on
 * Users: choose the role, link an existing Tenant / Landlord / Staff record or
 * create one from the sign-up, confirm. One server call
 * (`admin_assign_account_role`) sets role, link and — when approving — status.
 */
export function AssignAccountDialog({
  open,
  onOpenChange,
  user,
  mode,
  initialRole,
  accounts,
  tenants,
  landlords,
  staff,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: UserAccountRow | null;
  mode: AssignAccountMode;
  /** Pre-selected role; defaults to the person's sign-up choice. */
  initialRole?: AppRole;
  /** All accounts, to flag records another login already holds. */
  accounts: UserAccountRow[];
  /** `null` = that list failed to load (the picker says so). */
  tenants: Tenant[] | null;
  landlords: Landlord[];
  staff: StaffMember[] | null;
  onDone: (row: Tables<"user_roles">, message: string) => void;
}) {
  const uid = useId();
  const [role, setRole] = useState<AppRole>("tenant");
  const [source, setSource] = useState<Source>("create");
  const [linkId, setLinkId] = useState<string>("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [company, setCompany] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options = useMemo<RecordOption[] | null>(() => {
    if (!user) return [];
    const holder = (match: (a: UserAccountRow) => boolean) =>
      accounts.find((a) => a.user_id !== user.user_id && match(a))?.email ?? null;
    if (role === "tenant") {
      if (!tenants) return null;
      return tenants.map((t) => ({
        id: t.id,
        label: `${t.first_name} ${t.last_name}`.trim(),
        sub:
          [t.email, t.active_unit_name ? `Unit ${t.active_unit_name}` : "No unit yet"]
            .filter(Boolean)
            .join(" · "),
        email: t.email,
        heldBy: holder((a) => a.tenant_id === t.id),
      }));
    }
    if (role === "landlord") {
      return landlords.map((l) => ({
        id: l.id,
        label: l.company_name?.trim()
          ? `${l.company_name} (${l.first_name} ${l.last_name})`
          : `${l.first_name} ${l.last_name}`.trim(),
        sub: l.email,
        email: l.email,
        heldBy: holder((a) => a.landlord_id === l.id),
      }));
    }
    if (role === "maintenance") {
      if (!staff) return null;
      return staff.map((s) => ({
        id: s.id,
        label: `${s.first_name} ${s.last_name}`.trim(),
        sub: [s.job_title, s.email].filter(Boolean).join(" · "),
        email: s.email,
        heldBy: holder((a) => a.staff_id === s.id),
      }));
    }
    return [];
  }, [user, role, tenants, landlords, staff, accounts]);

  const emailMatch = useMemo(() => {
    const mine = user?.email?.toLowerCase();
    if (!mine || !options) return null;
    return options.find((o) => o.email?.toLowerCase() === mine && !o.heldBy) ?? null;
  }, [options, user]);

  // Reset everything when the dialog opens for someone.
  useEffect(() => {
    if (!open || !user) return;
    const name = splitName(user.full_name, user.email);
    setFirstName(name.first);
    setLastName(name.last);
    setEmail(user.email ?? "");
    setPhone(user.phone ?? "");
    setCompany("");
    setError(null);
    setSaving(false);
    setRole(initialRole ?? suggestedRole(user));
  }, [open, user, initialRole]);

  // Pick the best record source whenever the role changes.
  useEffect(() => {
    if (!open || !user) return;
    const current = linkedIdFor(user, role);
    if (current != null) {
      setSource("existing");
      setLinkId(String(current));
    } else if (emailMatch) {
      setSource("existing");
      setLinkId(String(emailMatch.id));
    } else {
      setSource("create");
      setLinkId("");
    }
    // emailMatch is derived from role; including it would fight the user's own choice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, user, role]);

  if (!user) return null;

  const needsRecord = roleNeedsRecord(role);
  const recordLabel = needsRecord ? RECORD_LABEL[role] : "";
  const unconfirmed = mode === "approve" && user.email_confirmed_at === null;
  const selected = options?.find((o) => String(o.id) === linkId) ?? null;
  const createValid =
    firstName.trim() !== "" &&
    lastName.trim() !== "" &&
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  const ready =
    !unconfirmed &&
    (!needsRecord ||
      (source === "existing" ? selected != null && !selected.heldBy : createValid));

  const linkedTenant =
    role === "tenant" && source === "existing" && tenants
      ? tenants.find((t) => String(t.id) === linkId)
      : undefined;
  const noUnitNote =
    role === "tenant" && (source === "create" || (linkedTenant && linkedTenant.active_unit_id == null))
      ? "No unit yet: they can sign in, but can't submit requests until you add a lease on Tenants."
      : null;

  const name = displayName(user);
  const primaryLabel =
    mode === "approve"
      ? saving
        ? "Approving…"
        : `Approve as ${ROLE_LABEL[role]}`
      : saving
        ? "Saving…"
        : `Make ${ROLE_LABEL[role].toLowerCase()}`;

  async function submit() {
    if (!user || !ready) return;
    setSaving(true);
    setError(null);
    try {
      const addressNote =
        user.signup_address && (role === "tenant" || role === "landlord")
          ? `Address given at sign-up: ${user.signup_address}`
          : null;
      const row = await data.assignAccountRole(user.user_id, role, {
        approve: mode === "approve",
        linkId: needsRecord && source === "existing" ? Number(linkId) : null,
        create:
          needsRecord && source === "create"
            ? {
                first_name: firstName.trim(),
                last_name: lastName.trim(),
                email: email.trim(),
                phone: phone.trim() || null,
                company_name: role !== "tenant" ? company.trim() || null : null,
                notes: addressNote,
              }
            : null,
      });
      const linkText = needsRecord
        ? source === "create"
          ? ` A new ${recordLabel} record was created.`
          : ` Linked to ${selected?.label ?? `the ${recordLabel} record`}.`
        : "";
      const message =
        mode === "approve"
          ? `${name} is approved as ${ROLE_LABEL[role]}.${linkText} They can sign in now.`
          : `${name} is now set up as ${ROLE_LABEL[role]}.${linkText}`;
      onDone(row, message);
      onOpenChange(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="max-w-xl gap-5">
        <DialogHeader>
          <DialogTitle>{mode === "approve" ? `Approve ${name}` : `Change role for ${name}`}</DialogTitle>
          <DialogDescription>
            {mode === "approve"
              ? "Choose what they are, link them to their record, then approve. They get access as soon as you confirm."
              : "Choose the role and the record this login belongs to. Their approval status stays as it is."}
          </DialogDescription>
        </DialogHeader>

        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-md bg-muted/60 px-3 py-2.5 text-[13px]">
          <dt className="text-muted-foreground">Email</dt>
          <dd className="min-w-0 break-words text-foreground">{user.email ?? "—"}</dd>
          <dt className="text-muted-foreground">Sign-up</dt>
          <dd className="text-foreground">{signupClaim(user).replace(/^Signed up as: /, "")}</dd>
          {user.signup_address ? (
            <>
              <dt className="text-muted-foreground">Address</dt>
              <dd className="min-w-0 break-words text-foreground">{user.signup_address}</dd>
            </>
          ) : null}
        </dl>

        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-medium text-foreground">Role</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {ROLE_ORDER.map((r) => (
              <label
                key={r}
                className={cn(
                  "flex cursor-pointer flex-col gap-0.5 rounded-sm border px-3 py-2 text-left transition-colors has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/40",
                  role === r
                    ? "border-primary bg-brand-tint/40"
                    : "border-border bg-card hover:bg-muted/50",
                )}
              >
                <input
                  type="radio"
                  name={`${uid}-role`}
                  value={r}
                  checked={role === r}
                  onChange={() => setRole(r)}
                  className="sr-only"
                />
                <span className="text-sm font-medium text-foreground">{ROLE_LABEL[r]}</span>
                {user.intent_role === r ? (
                  <span className="w-fit rounded-xs bg-brand-tint px-1.5 py-px text-[11px] font-medium text-brand-text">
                    Their choice
                  </span>
                ) : null}
                <span className="text-[12px] leading-4 text-muted-foreground">{ROLE_HINT[r]}</span>
              </label>
            ))}
          </div>
          {role === "admin" ? (
            <p className="flex items-start gap-1.5 text-[13px] text-warning">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              Admins can see and change every record, including tenant screening data.
            </p>
          ) : null}
        </fieldset>

        {needsRecord ? (
          <fieldset className="space-y-3">
            <legend className="mb-2 text-sm font-medium text-foreground">{recordLabel} record</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {(
                [
                  ["create", "Create new from this sign-up", "Uses the name, email and address above"],
                  ["existing", `Link an existing ${recordLabel.toLowerCase()}`, "Someone already on file"],
                ] as const
              ).map(([value, title, hint]) => (
                <label
                  key={value}
                  className={cn(
                    "flex cursor-pointer flex-col gap-0.5 rounded-sm border px-3 py-2 transition-colors has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/40",
                    source === value
                      ? "border-primary bg-brand-tint/40"
                      : "border-border bg-card hover:bg-muted/50",
                  )}
                >
                  <input
                    type="radio"
                    name={`${uid}-source`}
                    value={value}
                    checked={source === value}
                    onChange={() => setSource(value)}
                    className="sr-only"
                  />
                  <span className="text-sm font-medium text-foreground">{title}</span>
                  <span className="text-[12px] leading-4 text-muted-foreground">{hint}</span>
                </label>
              ))}
            </div>

            {source === "existing" ? (
              <div className="space-y-1.5">
                <Label htmlFor={`${uid}-link`}>{recordLabel}</Label>
                {options === null ? (
                  <p className="text-[13px] text-destructive">
                    The {recordLabel.toLowerCase()} list didn’t load. Close this, retry on People, or create a new record instead.
                  </p>
                ) : options.length === 0 ? (
                  <p className="text-[13px] text-muted-foreground">
                    No {recordLabel.toLowerCase()} records yet. Create one from this sign-up instead.
                  </p>
                ) : (
                  <Select value={linkId} onValueChange={setLinkId}>
                    <SelectTrigger id={`${uid}-link`} aria-describedby={`${uid}-link-hint`} className="text-left">
                      <SelectValue placeholder={`Choose a ${recordLabel.toLowerCase()}`} />
                    </SelectTrigger>
                    <SelectContent>
                      {options.map((o) => (
                        <SelectItem key={o.id} value={String(o.id)} disabled={o.heldBy != null}>
                          {o.label}
                          {o.sub ? ` · ${o.sub}` : ""}
                          {o.heldBy ? ` (linked to ${o.heldBy})` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <p id={`${uid}-link-hint`} className="text-[12px] text-muted-foreground">
                  {emailMatch && String(emailMatch.id) === linkId
                    ? "Matches the email they signed up with."
                    : "Records already linked to another login can’t be chosen."}
                </p>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor={`${uid}-first`}>First name</Label>
                  <Input id={`${uid}-first`} value={firstName} onChange={(e) => setFirstName(e.target.value)} autoComplete="off" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`${uid}-last`}>Last name</Label>
                  <Input id={`${uid}-last`} value={lastName} onChange={(e) => setLastName(e.target.value)} autoComplete="off" />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor={`${uid}-email`}>Email</Label>
                  <Input id={`${uid}-email`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`${uid}-phone`}>Phone (optional)</Label>
                  <Input id={`${uid}-phone`} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="off" />
                </div>
                {role !== "tenant" ? (
                  <div className="space-y-1.5">
                    <Label htmlFor={`${uid}-company`}>Company (optional)</Label>
                    <Input id={`${uid}-company`} value={company} onChange={(e) => setCompany(e.target.value)} autoComplete="off" />
                  </div>
                ) : null}
                {user.signup_address && role !== "maintenance" ? (
                  <p className="text-[12px] text-muted-foreground sm:col-span-2">
                    Their sign-up address is saved in the record’s notes.
                  </p>
                ) : null}
              </div>
            )}
          </fieldset>
        ) : null}

        {unconfirmed ? (
          <p className="rounded-sm bg-warning-tint px-3 py-2 text-[13px] text-warning" role="status">
            They haven’t confirmed their email yet. Approve once they click the link we emailed.
          </p>
        ) : noUnitNote ? (
          <p className="text-[13px] text-muted-foreground">{noUnitNote}</p>
        ) : null}

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
          <Button type="button" onClick={() => void submit()} disabled={!ready || saving}>
            {primaryLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
