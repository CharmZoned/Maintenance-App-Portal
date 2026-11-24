import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Landlord } from "@/types";
import { ArrowLeft, UserCog } from "lucide-react";
import * as data from "@/lib/data";
import type { UserAccountRow, StaffMember } from "@/lib/data";
import { useApp } from "@/context";
import { cn } from "@/lib/utils";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ConfirmDelete } from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { ErrorRetry, SkeletonRow } from "@/components/patterns";
import { AssignAccountDialog, type AssignAccountMode } from "@/components/people/assign-account-dialog";
import {
  RECORD_LABEL,
  ROLE_LABEL,
  assignedRole,
  displayName,
  linkedIdFor,
  roleNeedsRecord,
  signupClaim,
} from "@/components/people/account-labels";
import { useResource } from "@/components/people/use-resource";
import type { AccountStatus, AppRole } from "@/types.supabase";

type StatusFilter = AccountStatus | "all";

const STATUS_FILTERS: { id: StatusFilter; label: string }[] = [
  { id: "pending", label: "Pending" },
  { id: "approved", label: "Approved" },
  { id: "rejected", label: "Rejected" },
  { id: "suspended", label: "Suspended" },
  { id: "all", label: "All" },
];

const ROLES: AppRole[] = ["tenant", "landlord", "maintenance", "admin"];

const EMPTY_ACCOUNTS: UserAccountRow[] = [];
const EMPTY_STAFF: StaffMember[] = [];
const EMPTY_LANDLORDS: Landlord[] = [];

function statusVariant(status: AccountStatus): "default" | "secondary" | "destructive" | "outline" {
  if (status === "approved") return "default";
  if (status === "pending") return "secondary";
  if (status === "rejected" || status === "suspended") return "destructive";
  return "outline";
}

/** Explicit null = unconfirmed. Undefined = RPC predates column — do not UI-block. */
function isEmailUnconfirmed(user: UserAccountRow): boolean {
  return user.email_confirmed_at === null;
}

function parseSearch(search: string) {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  return { userId: params.get("user"), from: params.get("from") };
}

/**
 * Users — every portal login, its role, linked record and approval status.
 * Role changes and approvals go through the same dialog as People → Approvals,
 * so a role that needs a Tenant / Landlord / Team member record asks for it in
 * the same step. `?user=<id>` opens on that account (scrolled to, highlighted,
 * focused); `&from=approvals` adds a way back.
 */
export function UsersPage({
  search = "",
  navigate,
}: {
  search?: string;
  navigate?: (to: string) => void;
}) {
  const { setError, setNotice, listTenants, refreshLookups } = useApp();
  const accounts = useResource(data.listUserAccounts, EMPTY_ACCOUNTS, true);
  const staff = useResource(data.listStaff, EMPTY_STAFF, true);
  // Own load (not the app-wide lookup, which turns a failure into []), so the
  // approve dialog can say the list didn't load instead of "none yet".
  const landlordList = useResource(data.listLandlords, EMPTY_LANDLORDS, true);
  const landlords = landlordList.data;
  const fetchTenants = useCallback(() => listTenants(), [listTenants]);
  const tenants = useResource(fetchTenants, [], true);

  const { userId: focusUserId, from } = useMemo(() => parseSearch(search), [search]);
  const [filter, setFilter] = useState<StatusFilter>("pending");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [assign, setAssign] = useState<{
    user: UserAccountRow;
    mode: AssignAccountMode;
    role?: AppRole;
  } | null>(null);
  const [confirm, setConfirm] = useState<{
    user: UserAccountRow;
    status: "rejected" | "suspended";
  } | null>(null);
  const [confirmAdmin, setConfirmAdmin] = useState<UserAccountRow | null>(null);

  const rows = accounts.data;
  const visible = useMemo(
    () => (filter === "all" ? rows : rows.filter((r) => r.account_status === filter)),
    [rows, filter],
  );

  // ?user=: show the filter that contains them, then scroll + focus their card.
  const focused = useRef<string | null>(null);
  const cardRefs = useRef(new Map<string, HTMLDivElement>());
  useEffect(() => {
    if (!focusUserId || accounts.state !== "ready" || focused.current === focusUserId) return;
    const target = rows.find((r) => r.user_id === focusUserId);
    if (!target) return;
    setFilter(target.account_status);
    focused.current = focusUserId;
    requestAnimationFrame(() => {
      const el = cardRefs.current.get(focusUserId);
      if (!el) return;
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      el.focus({ preventScroll: true });
    });
  }, [focusUserId, accounts.state, rows]);

  function recordName(user: UserAccountRow): string | null {
    if (!user.role || !roleNeedsRecord(user.role)) return null;
    const id = linkedIdFor(user, user.role);
    if (id == null) return null;
    if (user.role === "tenant") {
      const t = tenants.data.find((x) => x.id === id);
      return t ? `${t.first_name} ${t.last_name}` : `Tenant #${id}`;
    }
    if (user.role === "landlord") {
      const l = landlords.find((x) => x.id === id);
      return l ? l.company_name?.trim() || `${l.first_name} ${l.last_name}` : `Landlord #${id}`;
    }
    const s = staff.data.find((x) => x.id === id);
    return s ? `${s.first_name} ${s.last_name}` : `Team member #${id}`;
  }

  async function applyStatus(user: UserAccountRow, status: "rejected" | "suspended") {
    setBusyId(user.user_id);
    try {
      await data.setAccountStatus(user.user_id, status);
      setNotice(`${displayName(user)} is ${status}.`);
      await accounts.reload({ quiet: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
      setConfirm(null);
    }
  }

  async function makeAdmin(user: UserAccountRow) {
    setBusyId(user.user_id);
    try {
      await data.assignAccountRole(user.user_id, "admin", { approve: false });
      setNotice(`${displayName(user)} is now an admin.`);
      await accounts.reload({ quiet: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
      setConfirmAdmin(null);
    }
  }

  function pickRole(user: UserAccountRow, role: AppRole) {
    if (role === assignedRole(user)) return;
    if (role === "admin") {
      setConfirmAdmin(user);
      return;
    }
    // Roles with a record ask for it in the same step.
    setAssign({ user, mode: "role", role });
  }

  const backToApprovals =
    from === "approvals" && navigate ? (
      <Button variant="ghost" size="sm" onClick={() => navigate("/people?tab=approvals")} className="-ml-2 w-fit">
        <ArrowLeft aria-hidden /> Back to Approvals
      </Button>
    ) : null;

  return (
    <PageShell
      title="Users"
      section="People / Users"
      meta="Portal logins — not rental applications"
      actions={
        <Button
          variant="outline"
          size="sm"
          onClick={() => void accounts.reload()}
          disabled={accounts.state === "loading"}
        >
          Refresh
        </Button>
      }
    >
      {backToApprovals}
      <p className="text-sm text-muted-foreground">
        Approve, change roles and suspend portal logins here. Rental applicants live under{" "}
        <span className="font-medium text-foreground">Applications</span>.
      </p>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by status">
        {STATUS_FILTERS.map((f) => (
          <Button
            key={f.id}
            size="sm"
            variant={filter === f.id ? "default" : "outline"}
            aria-pressed={filter === f.id}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
            {f.id !== "all" && accounts.state === "ready" && (
              <span className="ml-1 opacity-70">
                ({rows.filter((r) => r.account_status === f.id).length})
              </span>
            )}
          </Button>
        ))}
      </div>

      {accounts.state === "loading" || accounts.state === "idle" ? (
        <div className="overflow-hidden rounded-md border border-border" aria-busy="true" aria-label="Loading users">
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </div>
      ) : accounts.state === "error" ? (
        <div className="rounded-md border border-border bg-card">
          <ErrorRetry
            message="We couldn't load portal users. Check your connection and try again."
            onRetry={() => void accounts.reload()}
          />
        </div>
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 px-6 py-20 text-center">
          <UserCog className="size-8 text-faint" aria-hidden />
          <p className="font-medium">No users in this filter</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            New sign-ups appear as pending; email must be confirmed before Approve.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((user) => {
            const busy = busyId === user.user_id;
            const highlighted = user.user_id === focusUserId;
            const linkedName = recordName(user);
            const role = assignedRole(user);
            const linkedTenant =
              user.role === "tenant" && user.tenant_id != null
                ? tenants.data.find((t) => t.id === user.tenant_id)
                : undefined;
            const tenantMissingUnit = linkedTenant != null && linkedTenant.active_unit_id == null;
            const showApprove = user.account_status !== "approved";
            return (
              <Card
                key={user.user_id}
                ref={(el: HTMLDivElement | null) => {
                  if (el) cardRefs.current.set(user.user_id, el);
                  else cardRefs.current.delete(user.user_id);
                }}
                tabIndex={highlighted ? -1 : undefined}
                aria-label={highlighted ? `${displayName(user)} (opened from Approvals)` : undefined}
                className={cn(
                  "space-y-3 p-4 outline-none",
                  highlighted && "ring-2 ring-primary ring-offset-2 ring-offset-background",
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <p className="truncate font-medium">{displayName(user)}</p>
                    {user.full_name ? (
                      <p className="truncate text-[13px] text-muted-foreground">{user.email}</p>
                    ) : null}
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant={statusVariant(user.account_status)}>{user.account_status}</Badge>
                      {isEmailUnconfirmed(user) && <Badge variant="outline">unconfirmed email</Badge>}
                      <span>{signupClaim(user)}</span>
                    </div>
                    {user.signup_address ? (
                      <p className="text-xs text-muted-foreground">Address: {user.signup_address}</p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {showApprove && (
                      <Button
                        size="sm"
                        disabled={busy || isEmailUnconfirmed(user)}
                        title={isEmailUnconfirmed(user) ? "Waiting for them to confirm their email" : undefined}
                        onClick={() => setAssign({ user, mode: "approve" })}
                      >
                        {user.account_status === "pending" ? "Approve…" : "Re-approve…"}
                      </Button>
                    )}
                    {user.account_status === "approved" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => setConfirm({ user, status: "suspended" })}
                      >
                        Suspend
                      </Button>
                    )}
                    {user.account_status !== "rejected" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => setConfirm({ user, status: "rejected" })}
                      >
                        Reject
                      </Button>
                    )}
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs" htmlFor={`role-${user.user_id}`}>
                      Role
                    </Label>
                    <Select
                      value={role ?? "unassigned"}
                      onValueChange={(v) => {
                        if (v === "unassigned") return;
                        pickRole(user, v as AppRole);
                      }}
                      disabled={busy}
                    >
                      <SelectTrigger id={`role-${user.user_id}`}>
                        <SelectValue placeholder="No role yet" />
                      </SelectTrigger>
                      <SelectContent>
                        {!role && (
                          <SelectItem value="unassigned" disabled>
                            No role yet
                          </SelectItem>
                        )}
                        {ROLES.map((r) => (
                          <SelectItem key={r} value={r}>
                            {ROLE_LABEL[r]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {role && roleNeedsRecord(role) ? (
                    <div className="space-y-1.5">
                      <p className="text-xs font-medium">{RECORD_LABEL[role]} record</p>
                      <div className="flex min-h-8 flex-wrap items-center gap-2 text-sm">
                        {linkedName ? (
                          <span className="text-foreground">{linkedName}</span>
                        ) : (
                          <span className="text-warning">Not linked yet</span>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() =>
                            setAssign({ user, mode: "role", role })
                          }
                        >
                          {linkedName ? "Change…" : "Link…"}
                        </Button>
                      </div>
                      {tenantMissingUnit ? (
                        <p className="text-xs text-warning">
                          No unit yet — add a lease on Tenants so they can submit requests.
                        </p>
                      ) : null}
                    </div>
                  ) : !role ? (
                    <p className="self-end pb-1.5 text-[13px] text-muted-foreground">
                      Pick a role to link their record, or use Approve… to do both and approve.
                    </p>
                  ) : null}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <AssignAccountDialog
        open={assign != null}
        onOpenChange={(o) => {
          if (!o) setAssign(null);
        }}
        user={assign?.user ?? null}
        mode={assign?.mode ?? "role"}
        initialRole={assign?.role}
        accounts={rows}
        tenants={tenants.state === "ready" ? tenants.data : null}
        landlords={landlordList.state === "ready" ? landlordList.data : null}
        staff={staff.state === "ready" ? staff.data : null}
        onDone={(_row, message) => {
          setNotice(message);
          void accounts.reload({ quiet: true });
          void tenants.reload({ quiet: true });
          void staff.reload({ quiet: true });
          void landlordList.reload({ quiet: true });
          void refreshLookups();
        }}
      />

      <ConfirmDelete
        open={confirm != null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        title={
          confirm
            ? `${confirm.status === "rejected" ? "Reject" : "Suspend"} ${displayName(confirm.user)}?`
            : ""
        }
        description={
          confirm?.status === "rejected"
            ? "They stay signed in but can't use the portal until re-approved."
            : "They lose access the next time the portal checks their role."
        }
        confirmLabel={confirm?.status === "rejected" ? "Reject" : "Suspend"}
        onConfirm={() => {
          if (confirm) void applyStatus(confirm.user, confirm.status);
        }}
      />
      <ConfirmDelete
        open={confirmAdmin != null}
        onOpenChange={(open) => {
          if (!open) setConfirmAdmin(null);
        }}
        title={confirmAdmin ? `Make ${displayName(confirmAdmin)} an admin?` : ""}
        description="Admins can see and change every record, including tenant screening data and other accounts."
        confirmLabel="Make admin"
        onConfirm={() => {
          if (confirmAdmin) void makeAdmin(confirmAdmin);
        }}
      />
    </PageShell>
  );
}
