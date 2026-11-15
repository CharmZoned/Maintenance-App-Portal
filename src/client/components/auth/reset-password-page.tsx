import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PASSWORD_MIN_LENGTH } from "@/lib/password-policy";
import { SuccessNotice } from "@/components/patterns/success-notice";
import { AuthCard, AuthField, AuthNotice, AuthShell } from "./auth-card";
import { PasswordInput } from "./password-input";

interface RequestProps {
  onSubmit: (email: string) => Promise<void>;
  onBack: () => void;
  error: string | null;
}

export function ResetRequestPage({ onSubmit, onBack, error }: RequestProps) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    try {
      await onSubmit(email.trim());
      setSent(true);
    } catch {
      /* error prop */
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell>
      <form onSubmit={submit}>
        <AuthCard title="Reset password">
          <p className="text-sm text-muted-foreground">
            We’ll email a link to set a new password.
          </p>
          {error && <AuthNotice tone="danger">{error}</AuthNotice>}
          {sent ? (
            <AuthNotice tone="success">
              If that email exists, a reset link is on its way.
            </AuthNotice>
          ) : (
            <AuthField label="Email" htmlFor="reset-email">
              <Input
                id="reset-email"
                className="h-11"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </AuthField>
          )}
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="h-11" onClick={onBack}>
              Back
            </Button>
            {!sent && (
              <Button type="submit" variant="brand" className="h-11 flex-1" disabled={busy}>
                {busy ? "Sending…" : "Send reset link"}
              </Button>
            )}
          </div>
        </AuthCard>
      </form>
    </AuthShell>
  );
}

interface ConfirmProps {
  onSubmit: (password: string) => Promise<void>;
  onDone: () => void;
  error: string | null;
}

export function ResetConfirmPage({ onSubmit, onDone, error }: ConfirmProps) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

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
          <p className="text-sm text-muted-foreground">Continue to your home.</p>
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
        <AuthCard title="Choose a new password">
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
        </AuthCard>
      </form>
    </AuthShell>
  );
}
