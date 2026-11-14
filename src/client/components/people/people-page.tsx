import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { useApp } from "@/context";
import * as data from "@/lib/data";
import type { UserAccountRow } from "@/lib/data";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorRetry, SkeletonRow } from "@/components/patterns";
import { TenantDialog } from "@/components/tenants/tenant-dialog";
import { LandlordDialog } from "@/components/landlords/landlord-dialog";
import { ConfirmDelete } from "@/components/ui/alert-dialog";
import type { Landlord, Tenant } from "@/types";
import { portalStatusFromAccounts } from "@/lib/people-portal-status";
import { PeopleTabBar, type PeopleTabId } from "./people-tab-bar";
import { ApprovalCard } from "./approval-card";
import { PersonRow } from "./person-row";
import { TeamRow } from "./team-row";
import { VendorRow } from "./vendor-row";

type LoadState = "loading" | "ready" | "error";

function approveBlockedReason(user: UserAccountRow): string | null {
  if (user.email_confirmed_at === null) {
    return "Email must be confirmed before approving.";
  }
  if (!user.role) return "Assign a role before approving.";
  if (user.role === "maintenance" && user.staff_id == null) {
    return "Link a Staff row before approving a maintenance account.";
  }
  if (user.role === "tenant" && user.tenant_id == null) {
    return "Link a Tenant row before approving a tenant account.";
  }
  if (user.role === "landlord" && user.landlord_id == null) {
    return "Link a Landlord row before approving a landlord account.";
  }
  return null;
}

/**
 * Figma 06 People — N7 container with Approvals / Tenants / Landlords / Team / Vendors.
 * Reuses existing list/approval APIs; portal status is derived (invite API stub).
 */
export function PeoplePage({
  search = "",
  navigate,
  replace,
}: {
  search?: string;
  navigate: (to: string) => void;
  replace?: (to: string) => void;
}) {
  const {
    isAdmin,
    listTenants,
    setError,
    setNotice,
    landlords,
    vendors,
    canMutatePortfolio,
  } = useApp();
  const [tab, setTab] = useState<PeopleTabId>("tenants");
  const [state, setState] = useState<LoadState>("loading");
  const [error, setLocalError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<UserAccountRow[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [staff, setStaff] = useState<data.StaffMember[]>([]);
  const [tenantDialog, setTenantDialog] = useState(false);
  const [landlordDialog, setLandlordDialog] = useState(false);
  const [editingLandlord, setEditingLandlord] = useState<Landlord | undefined>();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{
    user: UserAccountRow;
    status: "approved" | "rejected";
  } | null>(null);

  /** Initial mount shows skeletons; mutation refreshes keep current rows. */
  const load = useCallback(
    async (opts?: { keepRows?: boolean }) => {
      if (!opts?.keepRows) setState("loading");
      setLocalError(null);
      try {
        const [acc, ten, st] = await Promise.all([
          isAdmin ? data.listUserAccounts() : Promise.resolve([] as UserAccountRow[]),
          listTenants(),
          isAdmin ? data.listStaff() : Promise.resolve([] as data.StaffMember[]),
        ]);
        setAccounts(acc);
        setTenants(ten);
        setStaff(st);
        setState("ready");
      } catch (err) {
        setLocalError((err as Error).message);
        setState("error");
        setError((err as Error).message);
      }
    },
    [isAdmin, listTenants, setError],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const pending = useMemo(
    () => accounts.filter((a) => a.account_status === "pending"),
    [accounts],
  );

  // Default tab: Approvals when anything waiting, else Tenants (Figma N7 note).
  // Honour ?tab= from URL when present.
  useEffect(() => {
    if (state !== "ready") return;
    const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
    const fromUrl = params.get("tab") as PeopleTabId | null;
    if (
      fromUrl === "approvals" ||
      fromUrl === "tenants" ||
      fromUrl === "landlords" ||
      fromUrl === "team" ||
      fromUrl === "vendors"
    ) {
      setTab(fromUrl);
      return;
    }
    setTab(pending.length > 0 ? "approvals" : "tenants");
  }, [state, pending.length, search]);

  function selectTab(id: PeopleTabId) {
    setTab(id);
    if (replace) replace(`/people?tab=${id}`);
  }

  async function applyStatus(user: UserAccountRow, status: "approved" | "rejected") {
    if (status === "approved" && approveBlockedReason(user)) {
      setError(approveBlockedReason(user) ?? "Cannot approve yet.");
      setConfirm(null);
      return;
    }
    setBusyId(user.user_id);
    try {
      await data.setAccountStatus(user.user_id, status);
      await load({ keepRows: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
      setConfirm(null);
    }
  }

  const meta =
    state === "loading"
      ? "Loading…"
      : tab === "approvals"
        ? pending.length
          ? `${pending.length} awaiting approval`
          : "No pending sign-ups"
        : tab === "tenants"
          ? `${tenants.length} ${tenants.length === 1 ? "tenant" : "tenants"}`
          : tab === "landlords"
            ? `${landlords.length} ${landlords.length === 1 ? "landlord" : "landlords"}`
            : tab === "team"
              ? `${staff.length} team ${staff.length === 1 ? "member" : "members"}`
              : `${vendors.length} ${vendors.length === 1 ? "vendor" : "vendors"}`;

  const primaryAction =
    tab === "tenants" && canMutatePortfolio ? (
      <Button
        variant="default"
        size="header"
        onClick={() => setTenantDialog(true)}
      >
        <Plus className="size-4" /> Add tenant
      </Button>
    ) : tab === "landlords" && canMutatePortfolio ? (
      <Button
        variant="default"
        size="header"
        onClick={() => {
          setEditingLandlord(undefined);
          setLandlordDialog(true);
        }}
      >
        <Plus className="size-4" /> Add landlord
      </Button>
    ) : tab === "team" && isAdmin ? (
      <Button
        variant="default"
        size="header"
        type="button"
        onClick={() =>
          setNotice("Create Staff rows and link them on Users for now.")
        }
      >
        <Plus className="size-4" /> Add team member
      </Button>
    ) : null;

  return (
    <PageShell title="People" meta={meta} actions={primaryAction} width="max-w-none">
      <PeopleTabBar active={tab} approvalsCount={pending.length} onChange={selectTab} />

      {state === "loading" ? (
        <div className="border border-border rounded-md overflow-hidden">
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </div>
      ) : state === "error" ? (
        <ErrorRetry message={error ?? undefined} onRetry={() => void load()} />
      ) : tab === "approvals" ? (
        <div className="space-y-3">
          <p className="text-[13px] text-muted-foreground">
            Pending sign-ups · Approve or reject here. Role links live on Users.
          </p>
          {!isAdmin ? (
            <EmptyState message="Approvals are restricted to admins." />
          ) : pending.length === 0 ? (
            <EmptyState message="No pending sign-ups. New accounts appear here after signup." />
          ) : (
            <div className="flex flex-col gap-3">
              {pending.map((user) => {
                const blocked = approveBlockedReason(user);
                const linkedTenant =
                  user.role === "tenant" && user.tenant_id != null
                    ? tenants.find((t) => t.id === user.tenant_id)
                    : undefined;
                const softWarning =
                  !blocked &&
                  linkedTenant != null &&
                  linkedTenant.active_unit_id == null
                    ? "Linked tenant has no unit — they can sign in but cannot submit maintenance until a unit is assigned."
                    : null;
                return (
                  <ApprovalCard
                    key={user.user_id}
                    user={user}
                    blockedReason={blocked}
                    softWarning={softWarning}
                    busy={busyId === user.user_id}
                    onApprove={() => setConfirm({ user, status: "approved" })}
                    onReject={() => setConfirm({ user, status: "rejected" })}
                    onManageLinks={() => navigate("/users")}
                  />
                );
              })}
            </div>
          )}
        </div>
      ) : tab === "tenants" ? (
        <div className="space-y-3">
          <p className="text-[13px] text-muted-foreground">
            Name, unit, phone, and portal status. Open a row for full tenant detail.
          </p>
          {tenants.length === 0 ? (
            <EmptyState
              message="No tenants yet. Add a tenant to start signing leases."
              actionLabel={canMutatePortfolio ? "Add tenant" : undefined}
              onAction={canMutatePortfolio ? () => setTenantDialog(true) : undefined}
            />
          ) : (
            <div className="overflow-hidden rounded-md border border-border">
              {tenants.map((t) => {
                const unit =
                  t.active_unit_name && t.active_property_name
                    ? `${t.active_unit_name} · ${t.active_property_name}`
                    : t.active_unit_name || "Not linked";
                const parts = [unit, t.phone?.trim()].filter(Boolean);
                return (
                  <PersonRow
                    key={t.id}
                    name={`${t.first_name} ${t.last_name}`}
                    meta={parts.join(" · ")}
                    status={portalStatusFromAccounts(accounts, {
                      tenantId: t.id,
                      email: t.email,
                    })}
                    onClick={() => navigate(`/tenants/${t.id}`)}
                  />
                );
              })}
            </div>
          )}
        </div>
      ) : tab === "landlords" ? (
        <div className="space-y-3">
          <p className="text-[13px] text-muted-foreground">
            Name, contact, and portal status for each landlord.
          </p>
          {landlords.length === 0 ? (
            <EmptyState
              message="No landlords yet. Create a landlord before adding properties."
              actionLabel={canMutatePortfolio ? "Add landlord" : undefined}
              onAction={
                canMutatePortfolio
                  ? () => {
                      setEditingLandlord(undefined);
                      setLandlordDialog(true);
                    }
                  : undefined
              }
            />
          ) : (
            <div className="overflow-hidden rounded-md border border-border">
              {landlords.map((l) => {
                const name =
                  l.company_name?.trim() || `${l.first_name} ${l.last_name}`.trim();
                const meta = [l.email, l.phone].filter(Boolean).join(" · ") || "—";
                return (
                  <PersonRow
                    key={l.id}
                    name={name}
                    meta={meta}
                    status={portalStatusFromAccounts(accounts, {
                      landlordId: l.id,
                      email: l.email,
                    })}
                    onClick={
                      canMutatePortfolio
                        ? () => {
                            setEditingLandlord(l);
                            setLandlordDialog(true);
                          }
                        : undefined
                    }
                  />
                );
              })}
            </div>
          )}
        </div>
      ) : tab === "team" ? (
        <div className="space-y-3">
          <p className="text-[13px] text-muted-foreground">
            Name, job title, contact, request alerts, and portal status.
          </p>
          {staff.length === 0 ? (
            <EmptyState message="No team members yet. Staff rows power maintenance assignment." />
          ) : (
            <div className="overflow-hidden rounded-md border border-border">
              {staff.map((s) => (
                <TeamRow
                  key={s.id}
                  name={`${s.first_name} ${s.last_name}`}
                  meta={[s.job_title, s.email].filter(Boolean).join(" · ") || "—"}
                  openJobs="Open jobs · —"
                  alerts={s.gets_request_alerts}
                  status={portalStatusFromAccounts(accounts, {
                    staffId: s.id,
                    email: s.email,
                  })}
                />
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-[13px] text-muted-foreground">
            Vendors directory with category and contact details.
          </p>
          {vendors.length === 0 ? (
            <EmptyState message="No vendors yet." />
          ) : (
            <div className="overflow-hidden rounded-md border border-border">
              {vendors.map((v) => (
                <VendorRow
                  key={v.id}
                  name={v.name}
                  meta={[v.category, v.phone, v.email].filter(Boolean).join(" · ")}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <TenantDialog
        open={tenantDialog}
        onOpenChange={setTenantDialog}
        onSaved={() => void load({ keepRows: true })}
      />
      <LandlordDialog
        open={landlordDialog}
        onOpenChange={setLandlordDialog}
        landlord={editingLandlord}
      />
      <ConfirmDelete
        open={confirm != null}
        onOpenChange={(o) => {
          if (!o) setConfirm(null);
        }}
        title={confirm?.status === "approved" ? "Approve account?" : "Reject account?"}
        description={
          confirm
            ? `${confirm.user.email ?? "This user"} will be marked ${confirm.status}.`
            : ""
        }
        confirmLabel={confirm?.status === "approved" ? "Approve" : "Reject"}
        onConfirm={() => {
          if (confirm) void applyStatus(confirm.user, confirm.status);
        }}
      />
    </PageShell>
  );
}
