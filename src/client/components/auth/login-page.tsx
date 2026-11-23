import { useEffect, useState, type ComponentType } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SIGNUP_ADDRESS_MAX, SIGNUP_NAME_MAX } from "@/hooks/use-auth";
import { parseDemoRole, type DemoRoleKey } from "@/lib/demo-accounts";
import { STAGING_TOOLS_ALLOWED } from "@/lib/env";
import { PASSWORD_MIN_LENGTH } from "@/lib/password-policy";
import { intentLoginLabel } from "@/lib/safe-redirect";
import { AuthCard, AuthField, AuthNotice, AuthShell } from "./auth-card";
import { PasswordInput } from "./password-input";
import { cn } from "@/lib/utils";
import type { QuickSignInProps } from "./quick-signin";

export type SignupExtras = {
  fullName: string;
  intentRole: "tenant" | "landlord";
  address: string;
};

interface Props {
  onLogin: (email: string, password: string) => Promise<void>;
  onSignup: (
    email: string,
    password: string,
    extras: SignupExtras,
  ) => Promise<"session" | "confirm">;
  onForgot: () => void;
  error: string | null;
  configured: boolean;
}

export function LoginPage({ onLogin, onSignup, onForgot, error, configured }: Props) {
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
  const [info, setInfo] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
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
        setInfo(null);
        return;
      }
      if (password.length < PASSWORD_MIN_LENGTH) {
        setLocalError(`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
        setInfo(null);
        return;
      }
    }
    setBusy(true);
    setInfo(null);
    setLocalError(null);
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
          setInfo(
            "Check your email to verify your account. After verification your status is pending until an admin approves you.",
          );
        }
      }
    } catch {
      /* surfaced via error prop */
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell>
      {mode === "login" && QuickSignIn ? (
        <QuickSignIn onSignIn={onLogin} autoRole={autoRole} />
      ) : null}
      <form onSubmit={submit}>
        <AuthCard title={subtitle} wide={mode === "signup"}>
          {!configured && (
            <AuthNotice tone="warning">
              Missing <code>VITE_SUPABASE_URL</code> / <code>VITE_SUPABASE_ANON_KEY</code>. Copy{" "}
              <code>.env.example</code> to <code>.env</code>.
            </AuthNotice>
          )}
          {(localError || error) && <AuthNotice tone="danger">{localError ?? error}</AuthNotice>}
          {info && <AuthNotice tone="success">{info}</AuthNotice>}

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
              <div className="flex w-full flex-col gap-1.5">
                <p className="text-xs font-medium text-muted-foreground">I am a…</p>
                <div className="flex gap-2" role="group" aria-label="Account type">
                  {(
                    [
                      ["tenant", "Tenant"],
                      ["landlord", "Property owner"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setIntentRole(value)}
                      aria-pressed={intentRole === value}
                      className={cn(
                        "flex-1 rounded-sm border px-3 py-2.5 text-[13px] font-medium",
                        intentRole === value
                          ? "border-brand bg-brand-tint text-brand-text"
                          : "border-border bg-card text-foreground",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  {/* Stub: intent is stored on signup metadata; admin still assigns the real role. */}
                  Preference only — an admin assigns your portal role after review.
                </p>
              </div>
              <AuthField label="Your address or unit (optional)" htmlFor="address">
                <Input
                  id="address"
                  className="h-11"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  maxLength={SIGNUP_ADDRESS_MAX}
                  autoComplete="street-address"
                />
              </AuthField>
            </>
          )}

          {mode === "login" && (
            <button
              type="button"
              className="text-left text-[13px] font-medium text-brand-text hover:underline"
              onClick={onForgot}
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

          <button
            type="button"
            className="text-left text-[13px] text-muted-foreground hover:text-foreground hover:underline"
            onClick={() => {
              setMode(mode === "login" ? "signup" : "login");
              setInfo(null);
              setLocalError(null);
            }}
          >
            {mode === "login" ? "New here? Create an account" : "Already have an account? Sign in"}
          </button>
        </AuthCard>
      </form>
    </AuthShell>
  );
}
