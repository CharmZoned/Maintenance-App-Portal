import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PASSWORD_MIN_LENGTH } from "@/lib/password-policy";
import { SuccessNotice } from "@/components/patterns/success-notice";
import { AuthCard, AuthField, AuthNotice, AuthShell } from "./auth-card";
import { forgetResetEmail, recallResetEmail, rememberResetEmail, RESET_LINK_EXPIRED } from "./auth-errors";
import { PasswordInput } from "./password-input";

/** Text-style secondary action under the primary button (matches the login screen). */
function AuthLinkButton({ onClick, children }: { onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      className="self-start rounded-sm text-[13px] font-medium text-brand-text outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/40"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

interface RequestProps {
  onSubmit: (email: string) => Promise<void>;
  onBack: () => void;
  error: string | null;
}

export function ResetRequestPage({ onSubmit, onBack, error }: RequestProps) {
  // Prefill from the last reset request or the sign-in form (see rememberResetEmail).
  const [email, setEmail] = useState(recallResetEmail);
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = email.trim();
    if (!value) return;
    setBusy(true);
    try {
      rememberResetEmail(value);
      await onSubmit(value);
      setSentTo(value);
    } catch {
      /* error prop */
    } finally {
      setBusy(false);
    }
  }

  if (sentTo) {
    return (
      <AuthShell>
        <AuthCard>
          <AuthNotice tone="muted">
            <h1 className="text-[15px] font-semibold text-foreground">Check your email</h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              If an account exists for <span className="font-medium text-foreground">{sentTo}</span>,
              a link to set a new password is on its way. It can take a minute to arrive — check
              spam if you don’t see it.
            </p>
          </AuthNotice>
          <Button
            type="button"
            variant="brand"
            className="h-12 w-full rounded-md text-[15px]"
            onClick={onBack}
          >
            Back to sign in
          </Button>
          <AuthLinkButton onClick={() => setSentTo(null)}>Use a different email</AuthLinkButton>
        </AuthCard>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <form onSubmit={submit}>
        <AuthCard title="Reset password">
          <p className="text-sm text-muted-foreground">
            Enter the email you sign in with. We’ll send a link to set a new password.
          </p>
          {error && <AuthNotice tone="danger">{error}</AuthNotice>}
          <AuthField label="Email" htmlFor="reset-email">
            <Input
              id="reset-email"
              className="h-11"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </AuthField>
          <Button
            type="submit"
            variant="brand"
            className="h-12 w-full rounded-md text-[15px]"
            disabled={busy}
          >
            {busy ? "Sending…" : "Send reset link"}
          </Button>
          <AuthLinkButton onClick={onBack}>Back to sign in</AuthLinkButton>
        </AuthCard>
      </form>
    </AuthShell>
  );
}

/**
 * `/reset-password` with no session: the email link expired, was already used,
 * or the page was opened directly. No password fields — they could never save.
 */
export function ResetLinkExpiredPage({
  onRequestNew,
  onBack,
}: {
  onRequestNew: () => void;
  onBack: () => void;
}) {
  return (
    <AuthShell>
      <AuthCard>
        <AuthNotice tone="muted">
          <h1 className="text-[15px] font-semibold text-foreground">{RESET_LINK_EXPIRED}</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            For your security, each reset link works once and expires after a short time. Send
            yourself a new one to choose a password.
          </p>
        </AuthNotice>
        <Button
          type="button"
          variant="brand"
          className="h-12 w-full rounded-md text-[15px]"
          onClick={onRequestNew}
        >
          Send a new link
        </Button>
        <AuthLinkButton onClick={onBack}>Back to sign in</AuthLinkButton>
      </AuthCard>
    </AuthShell>
  );
}

interface ConfirmProps {
  /**
   * `recovery`: signed in by a reset email link — "Choose a new password",
   * leaving signs out. `change`: already signed in and opened the page
   * directly — "Change password", Cancel goes back to the portal.
   */
  mode: "recovery" | "change";
  /** Shown so the person knows which account they are changing. */
  email?: string | null;
  onSubmit: (password: string) => Promise<void>;
  onCancel: () => void;
  onDone: () => void;
  error: string | null;
}

export function ResetConfirmPage({ mode, email, onSubmit, onCancel, onDone, error }: ConfirmProps) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const recovery = mode === "recovery";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < PASSWORD_MIN_LENGTH) {
      setLocalError(`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setLocalError("Passwords do not match.");
      return;
    }
    setBusy(true);
    setLocalError(null);
    try {
      await onSubmit(password);
      forgetResetEmail();
      setDone(true);
    } catch {
      /* error prop */
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <AuthShell>
        <AuthCard title="Password updated">
          <SuccessNotice message="Your password was updated." className="w-full py-6" />
          <p className="text-sm text-muted-foreground">
            Use it the next time you sign in. Continue to your home.
          </p>
          <Button
            type="button"
            variant="brand"
            className="h-12 w-full rounded-md text-[15px]"
            onClick={onDone}
          >
            Continue
          </Button>
        </AuthCard>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <form onSubmit={submit}>
        <AuthCard title={recovery ? "Choose a new password" : "Change password"}>
          {email ? (
            <p className="text-sm text-muted-foreground">
              For <span className="font-medium text-foreground">{email}</span>
            </p>
          ) : null}
          {(localError || error) && (
            <AuthNotice tone="danger">{localError ?? error}</AuthNotice>
          )}
          <AuthField label="New password" htmlFor="new-password">
            <PasswordInput
              id="new-password"
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
              minLength={PASSWORD_MIN_LENGTH}
              required
            />
            <p className="text-xs text-muted-foreground">
              At least {PASSWORD_MIN_LENGTH} characters.
            </p>
          </AuthField>
          <AuthField label="Confirm password" htmlFor="confirm-password">
            <PasswordInput
              id="confirm-password"
              value={confirm}
              onChange={setConfirm}
              autoComplete="new-password"
              minLength={PASSWORD_MIN_LENGTH}
              required
            />
          </AuthField>
          <Button
            type="submit"
            variant="brand"
            className="h-12 w-full rounded-md text-[15px]"
            disabled={busy}
          >
            {busy ? "Saving…" : "Update password"}
          </Button>
          <AuthLinkButton onClick={onCancel}>{recovery ? "Back to sign in" : "Cancel"}</AuthLinkButton>
        </AuthCard>
      </form>
    </AuthShell>
  );
}
