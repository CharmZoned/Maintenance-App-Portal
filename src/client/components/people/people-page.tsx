import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Plus } from "lucide-react";
import { useApp } from "@/context";
import * as data from "@/lib/data";
import type { StaffMember, UserAccountRow } from "@/lib/data";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { EmptyState, ErrorRetry, SkeletonRow } from "@/components/patterns";
import { TenantDialog } from "@/components/tenants/tenant-dialog";
import { LandlordDialog } from "@/components/landlords/landlord-dialog";
import { ConfirmDelete } from "@/components/ui/alert-dialog";
import type { Landlord, Vendor } from "@/types";
import { portalStatusFromAccounts } from "@/lib/people-portal-status";
import { PeopleTabBar, isPeopleTab, type PeopleTabId } from "./people-tab-bar";
import { ApprovalCard } from "./approval-card";
import { AssignAccountDialog } from "./assign-account-dialog";
import { PersonRow } from "./person-row";
import { TeamRow } from "./team-row";
import { TeamMemberDialog } from "./team-member-dialog";
import { VendorRow } from "./vendor-row";
import { displayName } from "./account-labels";
import { useResource, type Resource } from "./use-resource";

const EMPTY_ACCOUNTS: UserAccountRow[] = [];
const EMPTY_STAFF: StaffMember[] = [];
const EMPTY_JOBS = new Map<number, number>();
const EMPTY_LANDLORDS: Landlord[] = [];
const EMPTY_VENDORS: Vendor[] = [];

function Skeletons() {
  return (
    <div className="overflow-hidden rounded-md border border-border" aria-busy="true" aria-label="Loading">
      <SkeletonRow />
      <SkeletonRow />
      <SkeletonRow />
    </div>
  );
}

/** Loading / error+retry / content for one tab's own list. */
function ResourceGate<T>({
  resource,
  what,
  children,
}: {
  resource: Resource<T>;
  what: string;
  children: ReactNode;
}) {
  if (resource.state === "loading" || resource.state === "idle") return <Skeletons />;
  if (resource.state === "error") {
    return (
      <div className="rounded-md border border-border bg-card">
        <ErrorRetry
          message={`We couldn't load ${what}. Check your connection and try again.`}
          onRetry={() => void resource.reload()}
        />
      </div>
    );
  }
  return <>{children}</>;
}

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Figma 06 People — N7 container with Approvals / Tenants / Landlords / Team / Vendors.
 * Each tab loads its own list, so one failure shows an error + Retry in that
 * tab only. Approve… opens one dialog (role + record + confirm).
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
    canMutatePortfolio,
    refreshLookups,
  } = useApp();

  const accounts = useResource(data.listUserAccounts, EMPTY_ACCOUNTS, isAdmin);
  const fetchTenants = useCallback(() => listTenants(), [listTenants]);
  const tenants = useResource(fetchTenants, [], true);
  const staff = useResource(data.listStaff, EMPTY_STAFF, isAdmin);
  const openJobs = useResource(data.countOpenJobsByStaff, EMPTY_JOBS, isAdmin);
  // Landlords and vendors load here too, so a failure shows as an error with
  // Retry instead of "No landlords yet" (which invites a duplicate record).
  const landlordList = useResource(data.listLandlords, EMPTY_LANDLORDS, true);
  const vendorList = useResource(data.listVendors, EMPTY_VENDORS, true);

  const [tab, setTab] = useState<PeopleTabId>("tenants");
  const [tenantDialog, setTenantDialog] = useState(false);
  const [landlordDialog, setLandlordDialog] = useState(false);
  const [editingLandlord, setEditingLandlord] = useState<Landlord | undefined>();
  const [teamDialog, setTeamDialog] = useState<{ member?: StaffMember } | null>(null);
  const [assigning, setAssigning] = useState<UserAccountRow | null>(null);
  const [rejecting, setRejecting] = useState<UserAccountRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const pending = useMemo(
    () => accounts.data.filter((a) => a.account_status === "pending"),
    [accounts.data],
  );
  const accountsReady = accounts.state === "ready";

  // Tab from ?tab= when present. Otherwise, once (after the queue has loaded):
  // Approvals when anything is waiting, else Tenants (Figma N7 note). Never
  // jump away later, e.g. right after approving the last sign-up.
  const urlTab = useMemo(() => {
    const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
    const t = params.get("tab");
    return isPeopleTab(t) ? t : null;
  }, [search]);
  const defaulted = useRef(false);
  useEffect(() => {
    if (urlTab) {
      setTab(urlTab);
      defaulted.current = true;
      return;
    }
    if (defaulted.current) return;
    if (isAdmin && (accounts.state === "loading" || accounts.state === "idle")) return;
    defaulted.current = true;
    setTab(pending.length > 0 ? "approvals" : "tenants");
  }, [urlTab, isAdmin, accounts.state, pending.length]);

  function selectTab(id: string) {
    if (!isPeopleTab(id)) return;
    setTab(id);
    if (replace) replace(`/people?tab=${id}`);
  }

  async function reject(user: UserAccountRow) {
    setBusyId(user.user_id);
    try {
      await data.setAccountStatus(user.user_id, "rejected");
      setNotice(`${displayName(user)}’s sign-up was rejected.`);
      await accounts.reload({ quiet: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
      setRejecting(null);
    }
  }

  const statusFor = (link: Parameters<typeof portalStatusFromAccounts>[1]) =>
    // Without the account list a chip would claim "Not invited" — show none instead.
    isAdmin && accountsReady ? portalStatusFromAccounts(accounts.data, link) : undefined;

  const metaFor = (id: PeopleTabId): string => {
    if (id === "approvals") {
      if (!isAdmin) return "Admins only";
      if (!accountsReady) return accounts.state === "error" ? "Couldn't load sign-ups" : "Loading…";
      return pending.length ? `${pending.length} awaiting approval` : "No pending sign-ups";
    }
    if (id === "tenants") {
      if (tenants.state !== "ready") return tenants.state === "error" ? "Couldn't load tenants" : "Loading…";
      return plural(tenants.data.length, "tenant", "tenants");
    }
    if (id === "landlords") {
      if (landlordList.state !== "ready") return landlordList.state === "error" ? "Couldn't load landlords" : "Loading…";
      return plural(landlordList.data.length, "landlord", "landlords");
    }
    if (id === "team") {
      if (staff.state !== "ready") return staff.state === "error" ? "Couldn't load the team" : "Loading…";
      return plural(staff.data.length, "team member", "team members");
    }
    if (vendorList.state !== "ready") return vendorList.state === "error" ? "Couldn't load vendors" : "Loading…";
    return plural(vendorList.data.length, "vendor", "vendors");
  };

  const primaryAction =
    tab === "tenants" && canMutatePortfolio ? (
      <Button variant="default" size="header" onClick={() => setTenantDialog(true)}>
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
      <Button variant="default" size="header" type="button" onClick={() => setTeamDialog({})}>
        <Plus className="size-4" /> Add team member
      </Button>
    ) : null;

  const tenantsForDialog = tenants.state === "ready" ? tenants.data : null;
  const staffForDialog = staff.state === "ready" ? staff.data : null;

  return (
    <PageShell title="People" meta={metaFor(tab)} actions={primaryAction} width="max-w-none">
      <Tabs value={tab} onValueChange={selectTab} activationMode="automatic">
        <PeopleTabBar active={tab} approvalsCount={pending.length} />

        <TabsContent value="approvals" className="mt-4 space-y-3 focus-visible:ring-offset-0">
          <p className="text-[13px] text-muted-foreground">
            New sign-ups wait here. Approve… lets you pick their role and link or create their record in one step.
          </p>
          {!isAdmin ? (
            <EmptyState message="Approvals are restricted to admins." />
          ) : (
            <ResourceGate resource={accounts} what="sign-ups">
              {pending.length === 0 ? (
                <EmptyState message="No pending sign-ups. New accounts appear here after they sign up." />
              ) : (
                <div className="grid gap-3 xl:grid-cols-2">
                  {pending.map((user) => (
                    <ApprovalCard
                      key={user.user_id}
                      user={user}
                      busy={busyId === user.user_id}
                      onApprove={() => setAssigning(user)}
                      onReject={() => setRejecting(user)}
                      onOpenInUsers={() =>
                        navigate(`/users?user=${encodeURIComponent(user.user_id)}&from=approvals`)
                      }
                    />
                  ))}
                </div>
              )}
            </ResourceGate>
          )}
        </TabsContent>

        <TabsContent value="tenants" className="mt-4 space-y-3 focus-visible:ring-offset-0">
          <p className="text-[13px] text-muted-foreground">
            Name, unit, phone, and portal status. Open a row for full tenant detail.
          </p>
          <ResourceGate resource={tenants} what="tenants">
            {tenants.data.length === 0 ? (
              <EmptyState
                message="No tenants yet. Add a tenant to start signing leases."
                actionLabel={canMutatePortfolio ? "Add tenant" : undefined}
                onAction={canMutatePortfolio ? () => setTenantDialog(true) : undefined}
              />
            ) : (
              <div className="overflow-hidden rounded-md border border-border">
                {tenants.data.map((t) => {
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
                      status={statusFor({ tenantId: t.id, email: t.email })}
                      onClick={() => navigate(`/tenants/${t.id}`)}
                    />
                  );
                })}
              </div>
            )}
          </ResourceGate>
        </TabsContent>

        <TabsContent value="landlords" className="mt-4 space-y-3 focus-visible:ring-offset-0">
          <p className="text-[13px] text-muted-foreground">
            Name, contact, and portal status for each landlord.
          </p>
          <ResourceGate resource={landlordList} what="landlords">
            {landlordList.data.length === 0 ? (
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
              {landlordList.data.map((l) => {
                const name = l.company_name?.trim() || `${l.first_name} ${l.last_name}`.trim();
                const meta = [l.email, l.phone].filter(Boolean).join(" · ") || "—";
                return (
                  <PersonRow
                    key={l.id}
                    name={name}
                    meta={meta}
                    status={statusFor({ landlordId: l.id, email: l.email })}
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
          </ResourceGate>
        </TabsContent>

        <TabsContent value="team" className="mt-4 space-y-3 focus-visible:ring-offset-0">
          <p className="text-[13px] text-muted-foreground">
            Name, trades, contact, open jobs and portal status. Open a row to edit.
          </p>
          {!isAdmin ? (
            <EmptyState message="The team list is restricted to admins." />
          ) : (
            <ResourceGate resource={staff} what="the team">
              {staff.data.length === 0 ? (
                <EmptyState
                  message="No team members yet. Add the people who work maintenance requests."
                  actionLabel="Add team member"
                  onAction={() => setTeamDialog({})}
                />
              ) : (
                <div className="overflow-hidden rounded-md border border-border">
                  {staff.data.map((s) => {
                    const jobs =
                      openJobs.state === "ready"
                        ? plural(openJobs.data.get(s.id) ?? 0, "open job", "open jobs")
                        : openJobs.state === "loading"
                          ? "Open jobs · …"
                          : undefined;
                    const trades = s.services?.length ? s.services.join(", ") : null;
                    return (
                      <TeamRow
                        key={s.id}
                        name={`${s.first_name} ${s.last_name}`}
                        meta={[s.job_title ?? s.company_name, trades, s.email].filter(Boolean).join(" · ") || "—"}
                        openJobs={jobs}
                        alerts={s.gets_request_alerts}
                        inactive={s.active === false}
                        status={statusFor({ staffId: s.id, email: s.email })}
                        onClick={() => setTeamDialog({ member: s })}
                      />
                    );
                  })}
                </div>
              )}
              {openJobs.state === "error" ? (
                <p className="text-[13px] text-muted-foreground">
                  Open job counts didn’t load.{" "}
                  <button
                    type="button"
                    className="font-medium text-foreground underline underline-offset-2"
                    onClick={() => void openJobs.reload()}
                  >
                    Retry
                  </button>
                </p>
              ) : null}
            </ResourceGate>
          )}
        </TabsContent>

        <TabsContent value="vendors" className="mt-4 space-y-3 focus-visible:ring-offset-0">
          <p className="text-[13px] text-muted-foreground">
            Vendors directory with category and contact details.
          </p>
          <ResourceGate resource={vendorList} what="vendors">
          {vendorList.data.length === 0 ? (
            <EmptyState message="No vendors yet." />
          ) : (
            <div className="overflow-hidden rounded-md border border-border">
              {vendorList.data.map((v) => (
                <VendorRow
                  key={v.id}
                  name={v.name}
                  meta={[v.category, v.phone, v.email].filter(Boolean).join(" · ")}
                />
              ))}
            </div>
          )}
          </ResourceGate>
        </TabsContent>
      </Tabs>

      <TenantDialog
        open={tenantDialog}
        onOpenChange={setTenantDialog}
        onSaved={() => void tenants.reload({ quiet: true })}
      />
      <LandlordDialog
        open={landlordDialog}
        onOpenChange={setLandlordDialog}
        landlord={editingLandlord}
        onSaved={() => void landlordList.reload({ quiet: true })}
      />
      <TeamMemberDialog
        open={teamDialog != null}
        onOpenChange={(o) => {
          if (!o) setTeamDialog(null);
        }}
        member={teamDialog?.member}
        hasLogin={
          teamDialog?.member != null &&
          accounts.data.some((a) => a.staff_id === teamDialog.member!.id)
        }
        onSaved={(m) => {
          if (teamDialog?.member) setNotice(`Saved ${m.first_name} ${m.last_name}.`);
          void staff.reload({ quiet: true });
        }}
      />
      <AssignAccountDialog
        open={assigning != null}
        onOpenChange={(o) => {
          if (!o) setAssigning(null);
        }}
        user={assigning}
        mode="approve"
        accounts={accounts.data}
        tenants={tenantsForDialog}
        landlords={landlordList.data}
        staff={staffForDialog}
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
        open={rejecting != null}
        onOpenChange={(o) => {
          if (!o) setRejecting(null);
        }}
        title={rejecting ? `Reject ${displayName(rejecting)}?` : "Reject sign-up?"}
        description="They stay signed in but can't use the portal. You can re-approve them later on Users."
        confirmLabel="Reject sign-up"
        onConfirm={() => {
          if (rejecting) void reject(rejecting);
        }}
      />
    </PageShell>
  );
}
