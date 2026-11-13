import { useCallback, useEffect, useMemo, useState } from "react";
import { UserCog } from "lucide-react";
import * as data from "@/lib/data";
import type { UserAccountRow, StaffMember } from "@/lib/data";
import { useApp } from "@/context";
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
import type { AccountStatus, AppRole } from "@/types.supabase";

type StatusFilter = AccountStatus | "all";

const STATUS_FILTERS: { id: StatusFilter; label: string }[] = [
  { id: "pending", label: "Pending" },
  { id: "approved", label: "Approved" },
  { id: "rejected", label: "Rejected" },
  { id: "suspended", label: "Suspended" },
  { id: "all", label: "All" },
];

const ROLES: AppRole[] = ["admin", "maintenance", "landlord", "tenant"];

function statusVariant(status: AccountStatus): "default" | "secondary" | "destructive" | "outline" {
  if (status === "approved") return "default";
  if (status === "pending") return "secondary";
  if (status === "rejected" || status === "suspended") return "destructive";
  return "outline";
}

/** Staff/admin portal or linked tenant shell. */
function canApproveForPortal(user: UserAccountRow): boolean {
  if (user.role === "admin") return true;
  if (user.role === "maintenance" && user.staff_id != null) return true;
  if (user.role === "tenant" && user.tenant_id != null) return true;
  return false;
}

function approveBlockedReason(user: UserAccountRow): string | null {
  if (!user.role) return "Assign a role before approving.";
  if (user.role === "maintenance" && user.staff_id == null) {
    return "Link a Staff row before approving a maintenance account.";
  }
  if (user.role === "tenant" && user.tenant_id == null) {
    return "Link a Tenant row before approving a tenant account.";
  }
  if (user.role === "landlord") {
    return "Landlord self-serve is not shipped yet — approve only after changing role to admin, maintenance (+ staff), or tenant (+ tenant link).";
  }
  return null;
}

export function UsersPage() {
  const { setError, landlords, listTenants } = useApp();
  const [rows, setRows] = useState<UserAccountRow[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [tenants, setTenants] = useState<Awaited<ReturnType<typeof listTenants>>>([]);
  const [filter, setFilter] = useState<StatusFilter>("pending");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{
    user: UserAccountRow;
    status: AccountStatus;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [accounts, staffRows, tenantRows] = await Promise.all([
        data.listUserAccounts(),
        data.listStaff(),
        listTenants(),
      ]);
      setRows(accounts);
      setStaff(staffRows);
      setTenants(tenantRows);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [setError, listTenants]);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(
    () => (filter === "all" ? rows : rows.filter((r) => r.account_status === filter)),
    [rows, filter],
  );

  async function applyStatus(user: UserAccountRow, status: AccountStatus) {
    if (status === "approved" && !canApproveForPortal(user)) {
      setError(approveBlockedReason(user) ?? "Cannot approve this account yet.");
      setConfirm(null);
      return;
    }
    setBusyId(user.user_id);
    try {
      await data.setAccountStatus(user.user_id, status);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
      setConfirm(null);
    }
  }

  async function changeRole(user: UserAccountRow, role: AppRole) {
    if (user.account_status === "approved" && role === "landlord") {
      setError("Suspend or reject before assigning landlord (landlord portal not shipped).");
      return;
    }
    if (
      user.account_status === "approved" &&
      role === "tenant" &&
      user.tenant_id == null
    ) {
      setError("Link a Tenant row before keeping an approved tenant account.");
      return;
    }
    if (
      user.account_status === "approved" &&
      role === "maintenance" &&
      user.staff_id == null
    ) {
      setError("Link a Staff row before keeping an approved maintenance account.");
      return;
    }
    setBusyId(user.user_id);
    try {
      await data.adminSetUserRole(user.user_id, role, {
        landlord_id: role === "landlord" ? user.landlord_id : null,
        tenant_id: role === "tenant" ? user.tenant_id : null,
        staff_id: role === "maintenance" ? user.staff_id : null,
      });
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function changeStaffLink(user: UserAccountRow, staffId: string) {
    if (user.account_status === "approved" && staffId === "none") {
      setError("Suspend or reject before clearing the Staff link on an approved account.");
      return;
    }
    setBusyId(user.user_id);
    try {
      const id = staffId === "none" ? null : Number(staffId);
      await data.adminSetUserRole(user.user_id, "maintenance", { staff_id: id });
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function changeLandlordLink(user: UserAccountRow, landlordId: string) {
    setBusyId(user.user_id);
    try {
      const id = landlordId === "none" ? null : Number(landlordId);
      await data.adminSetUserRole(user.user_id, "landlord", { landlord_id: id });
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function changeTenantLink(user: UserAccountRow, tenantId: string) {
    if (user.account_status === "approved" && tenantId === "none") {
      setError("Suspend or reject before clearing the Tenant link on an approved account.");
      return;
    }
    setBusyId(user.user_id);
    try {
      const id = tenantId === "none" ? null : Number(tenantId);
      await data.adminSetUserRole(user.user_id, "tenant", { tenant_id: id });
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <PageShell
      title="Users"
      meta="Account approval queue — not rental applications"
      actions={
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          Refresh
        </Button>
      }
    >
      <p className="text-sm text-muted-foreground">
        Approve portal sign-ins here. Rental applicants live under{" "}
        <span className="font-medium text-foreground">Applications</span>.
      </p>

      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((f) => (
          <Button
            key={f.id}
            size="sm"
            variant={filter === f.id ? "default" : "outline"}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
            {f.id !== "all" && (
              <span className="ml-1 opacity-70">
                ({rows.filter((r) => r.account_status === f.id).length})
              </span>
            )}
          </Button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading users…</p>
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 px-6 py-20 text-center">
          <UserCog className="size-8 text-faint" aria-hidden />
          <p className="font-medium">No users in this filter</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            New signups appear as pending after email verification.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((user) => {
            const busy = busyId === user.user_id;
            const blockReason = approveBlockedReason(user);
            const showApprove = user.account_status !== "approved";
            return (
              <Card key={user.user_id} className="space-y-3 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <p className="truncate font-medium">{user.email || "(no email)"}</p>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant={statusVariant(user.account_status)}>
                        {user.account_status}
                      </Badge>
                      <span>role: {user.role ?? "none"}</span>
                      {user.staff_id != null && <span>staff #{user.staff_id}</span>}
                      {user.landlord_id != null && <span>landlord #{user.landlord_id}</span>}
                      {user.tenant_id != null && <span>tenant #{user.tenant_id}</span>}
                    </div>
                    {showApprove && blockReason && (
                      <p className="text-xs text-amber-800">{blockReason}</p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {showApprove && (
                      <Button
                        size="sm"
                        disabled={busy || !canApproveForPortal(user)}
                        onClick={() => setConfirm({ user, status: "approved" })}
                      >
                        {user.account_status === "pending" ? "Approve" : "Re-approve"}
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
                    {user.account_status !== "rejected" && user.account_status !== "approved" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => setConfirm({ user, status: "rejected" })}
                      >
                        Reject
                      </Button>
                    )}
                    {user.account_status === "approved" && (
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
                    <Label className="text-xs">Role</Label>
                    <Select
                      value={user.role ?? "unassigned"}
                      onValueChange={(v) => {
                        if (v === "unassigned") return;
                        void changeRole(user, v as AppRole);
                      }}
                      disabled={busy}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Assign role" />
                      </SelectTrigger>
                      <SelectContent>
                        {!user.role && (
                          <SelectItem value="unassigned" disabled>
                            Unassigned
                          </SelectItem>
                        )}
                        {ROLES.map((r) => (
                          <SelectItem key={r} value={r}>
                            {r}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {user.role === "maintenance" && (
                    <div className="space-y-1.5">
                      <Label className="text-xs">Staff link (required for portal access)</Label>
                      <Select
                        value={user.staff_id != null ? String(user.staff_id) : "none"}
                        onValueChange={(v) => void changeStaffLink(user, v)}
                        disabled={busy}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Staff" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem
                            value="none"
                            disabled={user.account_status === "approved"}
                          >
                            None
                            {user.account_status === "approved"
                              ? " (suspend first)"
                              : ""}
                          </SelectItem>
                          {staff.map((s) => (
                            <SelectItem key={s.id} value={String(s.id)}>
                              {s.last_name}, {s.first_name} ({s.email})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  {user.role === "landlord" && (
                    <div className="space-y-1.5">
                      <Label className="text-xs">Landlord link</Label>
                      <Select
                        value={user.landlord_id != null ? String(user.landlord_id) : "none"}
                        onValueChange={(v) => void changeLandlordLink(user, v)}
                        disabled={busy}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Landlord" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          {landlords.map((l) => (
                            <SelectItem key={l.id} value={String(l.id)}>
                              {l.company_name?.trim() || `${l.last_name}, ${l.first_name}`}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  {user.role === "tenant" && (
                    <div className="space-y-1.5">
                      <Label className="text-xs">Tenant link (required for tenant portal)</Label>
                      <Select
                        value={user.tenant_id != null ? String(user.tenant_id) : "none"}
                        onValueChange={(v) => void changeTenantLink(user, v)}
                        disabled={busy}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Tenant" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem
                            value="none"
                            disabled={user.account_status === "approved"}
                          >
                            None
                            {user.account_status === "approved" ? " (suspend first)" : ""}
                          </SelectItem>
                          {tenants.map((t) => (
                            <SelectItem key={t.id} value={String(t.id)}>
                              {t.last_name}, {t.first_name}
                              {t.email ? ` (${t.email})` : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <ConfirmDelete
        open={confirm != null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        title={
          confirm
            ? `${confirm.status === "approved" ? "Approve" : confirm.status === "rejected" ? "Reject" : "Suspend"} “${confirm.user.email ?? confirm.user.user_id}”?`
            : ""
        }
        description={
          confirm?.status === "approved"
            ? "They can use the portal after refreshing their session (Check again / sign in again)."
            : confirm?.status === "rejected"
              ? "They will stay signed in but blocked from the portal until re-approved."
              : "Access is revoked on their next role resolve / refresh."
        }
        confirmLabel={
          confirm?.status === "approved"
            ? "Approve"
            : confirm?.status === "rejected"
              ? "Reject"
              : "Suspend"
        }
        onConfirm={() => {
          if (confirm) void applyStatus(confirm.user, confirm.status);
        }}
      />
    </PageShell>
  );
}
