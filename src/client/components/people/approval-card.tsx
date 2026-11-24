import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import { PortalStatus } from "./portal-status";
import type { UserAccountRow } from "@/lib/data";
import { displayName, signupClaim } from "./account-labels";

/**
 * Figma `Approval card` — who signed up (name, email, what they said they
 * are, address) + Approve… / Reject. Approve opens the assign dialog, where
 * the role and record are chosen; it is the one primary action on the card.
 */
export function ApprovalCard({
  user,
  busy,
  onApprove,
  onReject,
  onOpenInUsers,
}: {
  user: UserAccountRow;
  busy?: boolean;
  onApprove: () => void;
  onReject: () => void;
  onOpenInUsers?: () => void;
}) {
  const name = displayName(user);
  const hasName = Boolean(user.full_name?.trim());
  const unconfirmed = user.email_confirmed_at === null;
  const emailLine =
    user.email_confirmed_at === undefined
      ? null
      : unconfirmed
        ? "Email not confirmed yet — waiting on them to click the link"
        : "Email confirmed";

  return (
    <article
      aria-label={`Sign-up from ${name}`}
      className="flex flex-col gap-3 rounded-md border border-border bg-card p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold text-foreground">{name}</h3>
          {hasName ? (
            <p className="truncate text-[13px] text-muted-foreground">{user.email ?? "(no email)"}</p>
          ) : null}
        </div>
        <PortalStatus status="pending" />
      </div>
      <dl className="grid gap-1 text-[13px]">
        <div className="flex flex-wrap gap-x-1.5">
          <dt className="sr-only">Role</dt>
          <dd className="font-medium text-foreground">{signupClaim(user)}</dd>
        </div>
        {user.signup_address ? (
          <div className="flex flex-wrap gap-x-1.5">
            <dt className="text-muted-foreground">Address:</dt>
            <dd className="min-w-0 break-words text-foreground">{user.signup_address}</dd>
          </div>
        ) : null}
        {user.phone ? (
          <div className="flex flex-wrap gap-x-1.5">
            <dt className="text-muted-foreground">Phone:</dt>
            <dd className="text-foreground">{user.phone}</dd>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-x-1.5 text-muted-foreground">
          <dt className="sr-only">Signed up</dt>
          <dd>
            Signed up {formatDate(user.created_at)}
            {emailLine ? (
              <>
                {" · "}
                <span className={unconfirmed ? "text-warning" : undefined}>{emailLine}</span>
              </>
            ) : null}
          </dd>
        </div>
      </dl>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="default"
          disabled={busy || unconfirmed}
          onClick={onApprove}
          aria-describedby={unconfirmed ? `approve-hint-${user.user_id}` : undefined}
        >
          Approve…
        </Button>
        <Button size="default" variant="secondary" disabled={busy} onClick={onReject}>
          Reject
        </Button>
        {onOpenInUsers ? (
          <Button size="default" variant="ghost" disabled={busy} onClick={onOpenInUsers}>
            Open in Users
          </Button>
        ) : null}
        {unconfirmed ? (
          <span id={`approve-hint-${user.user_id}`} className="sr-only">
            Approve is available once they confirm their email.
          </span>
        ) : null}
      </div>
    </article>
  );
}
