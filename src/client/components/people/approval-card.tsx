import { Button } from "@/components/ui/button";
import { PortalStatus } from "./portal-status";
import type { UserAccountRow } from "@/lib/data";

function roleClaim(user: UserAccountRow): string {
  if (user.role === "tenant") return "Said they are: Tenant";
  if (user.role === "landlord") return "Said they are: Property owner";
  if (user.role === "maintenance") return "Said they are: Team member";
  if (user.role === "admin") return "Said they are: Admin";
  return "Said they are: (not set)";
}

function approveLabel(user: UserAccountRow): string {
  if (user.role === "tenant") return "Approve as Tenant of Unit…";
  if (user.role === "landlord") return "Approve as Owner";
  if (user.role === "maintenance") return "Approve as Team member";
  return "Approve";
}

/** Figma `Approval card` — pending signup summary + Approve / Reject. */
export function ApprovalCard({
  user,
  blockedReason,
  busy,
  onApprove,
  onReject,
  onManageLinks,
}: {
  user: UserAccountRow;
  blockedReason?: string | null;
  busy?: boolean;
  onApprove: () => void;
  onReject: () => void;
  onManageLinks?: () => void;
}) {
  const emailConfirmed =
    user.email_confirmed_at === undefined
      ? "Email confirmed: (unknown)"
      : user.email_confirmed_at
        ? "Email confirmed: Yes"
        : "Email confirmed: No — waiting on link";

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-base font-semibold text-foreground">
            {user.email || "(no email)"}
          </p>
          <p className="truncate text-[13px] text-muted-foreground">
            Portal signup · {user.role ?? "no role yet"}
          </p>
        </div>
        <PortalStatus status="pending" />
      </div>
      <div className="space-y-1.5 text-[13px] text-foreground">
        <p>{roleClaim(user)}</p>
        <p className="text-muted-foreground">{emailConfirmed}</p>
        {blockedReason ? <p className="text-warning">{blockedReason}</p> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="default" disabled={busy || Boolean(blockedReason)} onClick={onApprove}>
          {approveLabel(user)}
        </Button>
        <Button size="default" variant="secondary" disabled={busy} onClick={onReject}>
          Reject
        </Button>
        {onManageLinks ? (
          <Button size="default" variant="ghost" disabled={busy} onClick={onManageLinks}>
            Link role…
          </Button>
        ) : null}
      </div>
    </div>
  );
}
