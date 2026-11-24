import { useEffect, useState, type ComponentType } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SIGNUP_ADDRESS_MAX, SIGNUP_NAME_MAX } from "@/hooks/use-auth";
import { parseDemoRole, type DemoRoleKey } from "@/lib/demo-accounts";
import { STAGING_TOOLS_ALLOWED } from "@/lib/env";
import { PASSWORD_MIN_LENGTH } from "@/lib/password-policy";
import { intentLoginLabel } from "@/lib/safe-redirect";
import { AuthCard, AuthField, AuthNotice, AuthShell } from "./auth-card";
import { rememberResetEmail } from "./auth-errors";
import { PasswordInput } from "./password-input";
import { ChoiceGroup, type ChoiceOption } from "@/components/patterns/choice-group";
import { SupportContactNotice } from "@/components/patterns/support-contact-notice";
import type { QuickSignInProps } from "./quick-signin";

export type SignupExtras = {
  fullName: string;
  intentRole: "tenant" | "landlord";
  address: string;
};

/** `landlord` stays the stored intent value; people see "Property owner" (UX-04). */
const ACCOUNT_TYPES: readonly ChoiceOption<SignupExtras["intentRole"]>[] = [
  { value: "tenant", label: "Tenant", description: "I rent a home" },
  { value: "landlord", label: "Property owner", description: "I own rental property" },
];

interface Props {
  onLogin: (email: string, password: string) => Promise<void>;
  onSignup: (
    email: string,
    password: string,
    extras: SignupExtras,
  ) => Promise<"session" | "confirm">;
  onForgot: () => void;
  /** After staging quick sign-in — navigate to the demo role home and clear `?as=`. */
  onDemoSignedIn?: (role: DemoRoleKey) => void;
  error: string | null;
  configured: boolean;
}

export function LoginPage({
  onLogin,
  onSignup,
  onForgot,
  onDemoSignedIn,
  error,
  configured,
}: Props) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [intentRole, setIntentRole] = useState<"tenant" | "landlord">(() => {
    const key = new URLSearchParams(window.location.search).get("intent")?.trim().toLowerCase();
    return key === "landlord" ? "landlord" : "tenant";
  });
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  // Hide the last server error once the person switches between sign in / sign up.
  const [showServerError, setShowServerError] = useState(true);
  /** Email a confirmation link was sent to — replaces the form so it can't be sent twice. */
  const [confirmSentTo, setConfirmSentTo] = useState<string | null>(null);
  // Capture once — login URL intent does not change while this screen is mounted.
  const [intent] = useState(() => new URLSearchParams(window.location.search).get("intent"));
  const [autoRole] = useState<DemoRoleKey | null>(() =>
    parseDemoRole(new URLSearchParams(window.location.search).get("as")),
  );
  const [QuickSignIn, setQuickSignIn] = useState<ComponentType<QuickSignInProps> | null>(null);
  const subtitle = mode === "signup" ? "Create an account" : intentLoginLabel(intent);

  // ADR-0006: only dynamically import when the build env is explicitly staging/local.
  useEffect(() => {
    const env = import.meta.env.VITE_APP_ENV;
    if (env !== "staging" && env !== "local") return;
    if (!STAGING_TOOLS_ALLOWED) return;
    let cancelled = false;
    void import("./quick-signin").then((mod) => {
      if (!cancelled) setQuickSignIn(() => mod.QuickSignIn);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) return;
    if (mode === "signup") {
      if (!fullName.trim()) {
        setLocalError("Enter your full name.");
        return;
      }
      if (password.length < PASSWORD_MIN_LENGTH) {
        setLocalError(`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
        return;
      }
    }
    setBusy(true);
    setLocalError(null);
    setShowServerError(true);
    try {
      if (mode === "login") {
        await onLogin(email.trim(), password);
      } else {
        const result = await onSignup(email.trim(), password, {
          fullName: fullName.trim(),
          intentRole,
          address: address.trim(),
        });
        if (result === "confirm") {
          setConfirmSentTo(email.trim());
          setPassword("");
        }
      }
    } catch {
      /* surfaced via error prop */
    } finally {
      setBusy(false);
    }
  }

  function switchMode(next: "login" | "signup") {
    setMode(next);
    setLocalError(null);
    setShowServerError(false);
  }

  if (confirmSentTo) {
    return (
      <AuthShell>
        <AuthCard wide>
          <AuthNotice tone="muted">
            <h1 className="text-[15px] font-semibold text-foreground">Check your email</h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              We sent a link to{" "}
              <span className="font-medium text-foreground">{confirmSentTo}</span> to verify your
              account. Open it, then we review new accounts within one business day — we’ll email
              you once you’re approved.
            </p>
          </AuthNotice>
          <p className="text-xs text-muted-foreground">
            No email after a few minutes? Check spam, or contact the office below.
          </p>
          <SupportContactNotice
            variant="urgent"
            lead="While your account is pending,"
            audience={intentRole === "landlord" ? "owner" : "tenant"}
          />
          <Button
            type="button"
            variant="outline"
            className="h-11 w-full"
            onClick={() => {
              setConfirmSentTo(null);
              switchMode("login");
            }}
          >
            Back to sign in
          </Button>
        </AuthCard>
      </AuthShell>
    );
  }

  const serverError = showServerError ? error : null;

  return (
    <AuthShell>
      <form onSubmit={submit}>
        <AuthCard title={subtitle} wide={mode === "signup"}>
          {!configured && (
            <AuthNotice tone="warning">
              Missing <code>VITE_SUPABASE_URL</code> / <code>VITE_SUPABASE_ANON_KEY</code>. Copy{" "}
              <code>.env.example</code> to <code>.env</code>.
            </AuthNotice>
          )}
          {(localError || serverError) && (
            <AuthNotice tone="danger">{localError ?? serverError}</AuthNotice>
          )}

          {mode === "signup" && (
            <AuthField label="Full name" htmlFor="full-name">
              <Input
                id="full-name"
                className="h-11"
                autoComplete="name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                maxLength={SIGNUP_NAME_MAX}
                required
              />
            </AuthField>
          )}

          <AuthField label="Email" htmlFor="email">
            <Input
              id="email"
              className="h-11"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </AuthField>

          <AuthField label="Password" htmlFor="password">
            <PasswordInput
              id="password"
              value={password}
              onChange={setPassword}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              required
              minLength={mode === "signup" ? PASSWORD_MIN_LENGTH : undefined}
            />
            {mode === "signup" && (
              <p className="text-xs text-muted-foreground">
                At least {PASSWORD_MIN_LENGTH} characters.
              </p>
            )}
          </AuthField>

          {mode === "signup" && (
            <>
              <ChoiceGroup
                label="Account type"
                name="account-type"
                value={intentRole}
                onChange={setIntentRole}
                options={ACCOUNT_TYPES}
                hint={
                  <>
                    {/* Stub: intent is stored on signup metadata; admin still assigns the real role. */}
                    <p>Preference only — an admin assigns your portal role after review.</p>
                    <p>Maintenance technician? Ask the office for an invite.</p>
                  </>
                }
              />
              <AuthField
                label={
                  intentRole === "landlord"
                    ? "Property address (optional)"
                    : "Your address or unit (optional)"
                }
                htmlFor="address"
              >
                <Input
                  id="address"
                  className="h-11"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  maxLength={SIGNUP_ADDRESS_MAX}
                  autoComplete="street-address"
                  aria-describedby={intentRole === "landlord" ? "address-hint" : undefined}
                />
                {intentRole === "landlord" ? (
                  <p id="address-hint" className="text-xs text-muted-foreground">
                    Your main property — you can add more later.
                  </p>
                ) : null}
              </AuthField>
            </>
          )}

          {mode === "login" && (
            <button
              type="button"
              className="text-left text-[13px] font-medium text-brand-text hover:underline"
              onClick={() => {
                rememberResetEmail(email);
                onForgot();
              }}
            >
              Forgot password?
            </button>
          )}

          <Button
            type="submit"
            variant="brand"
            className="h-12 w-full rounded-md text-[15px]"
            disabled={busy || !configured}
          >
            {busy
              ? mode === "login"
                ? "Signing in…"
                : "Creating account…"
              : mode === "login"
                ? "Sign in"
                : "Create account"}
          </Button>

          {mode === "signup" ? (
            <p className="text-xs text-muted-foreground">
              We’ll email a confirmation link. After you confirm, we review new accounts within one
              business day.
            </p>
          ) : null}

          {mode === "signup" ? (
            <SupportContactNotice
              variant="urgent"
              lead="While your account is pending,"
              audience={intentRole === "landlord" ? "owner" : "tenant"}
            />
          ) : null}

          <button
            type="button"
            className="text-left text-[13px] text-muted-foreground hover:text-foreground hover:underline"
            onClick={() => switchMode(mode === "login" ? "signup" : "login")}
          >
            {mode === "login" ? "New here? Create an account" : "Already have an account? Sign in"}
          </button>
        </AuthCard>
      </form>
      {mode === "login" && QuickSignIn ? (
        <QuickSignIn
          onSignIn={onLogin}
          onSignedIn={onDemoSignedIn}
          autoRole={autoRole}
          configured={configured}
        />
      ) : null}
    </AuthShell>
  );
}
