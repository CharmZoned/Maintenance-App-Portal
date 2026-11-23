/**
 * Staging / local one-click role sign-in.
 * Loaded only when VITE_APP_ENV is "staging" or "local" (see login-page).
 * Marker `data-quick-signin` must not appear in a production bundle (CI guard).
 */
import { useEffect, useRef, useState } from "react";
import {
  DEMO_ACCOUNTS,
  DEMO_ROLE_ORDER,
  demoPassword,
  formatDemoSignInError,
  type DemoRoleKey,
} from "@/lib/demo-accounts";
import { STAGING_TOOLS_ALLOWED } from "@/lib/env";
import { AuthNotice } from "./auth-card";
import { cn } from "@/lib/utils";

const MISSING_DEMO_PASSWORD =
  "Demo password is not configured (VITE_DEMO_PASSWORD). For staging, set it in the host env; for local, use pnpm dev:local.";

const MISSING_SUPABASE_ENV =
  "Supabase is not configured (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY). Copy .env.example or use pnpm dev:local.";

export type QuickSignInProps = {
  onSignIn: (email: string, password: string) => Promise<void>;
  /** Called after a successful demo sign-in so the app can route to that role's home and clear `?as=`. */
  onSignedIn?: (role: DemoRoleKey) => void;
  /** When set, auto-sign-in once for `/login?as=<role>`. */
  autoRole?: DemoRoleKey | null;
  /** False when Vite Supabase env vars are missing — buttons stay disabled with a clear warning. */
  configured?: boolean;
};

export function QuickSignIn({
  onSignIn,
  onSignedIn,
  autoRole,
  configured = true,
}: QuickSignInProps) {
  const [busyRole, setBusyRole] = useState<DemoRoleKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const autoTried = useRef(false);
  const password = demoPassword();
  const canSignIn = Boolean(password) && configured;

  async function signInAs(role: DemoRoleKey) {
    if (!configured) {
      setError(MISSING_SUPABASE_ENV);
      return;
    }
    if (!password) {
      setError(MISSING_DEMO_PASSWORD);
      return;
    }
    setBusyRole(role);
    setError(null);
    try {
      await onSignIn(DEMO_ACCOUNTS[role].email, password);
      onSignedIn?.(role);
    } catch (err) {
      setError(formatDemoSignInError(err));
    } finally {
      setBusyRole(null);
    }
  }

  // `/login?as=` — one attempt after mount.
  useEffect(() => {
    if (!STAGING_TOOLS_ALLOWED || !autoRole || autoTried.current) return;
    autoTried.current = true;
    void signInAs(autoRole);
  }, [autoRole]);

  if (!STAGING_TOOLS_ALLOWED) return null;

  return (
    <div
      data-quick-signin
      className="mt-4 flex w-full max-w-[342px] flex-col gap-3 rounded-lg border border-pink-300 bg-pink-50 px-4 py-4"
    >
      <div>
        <p className="text-sm font-semibold text-pink-950">Staging quick sign-in</p>
        <p className="mt-0.5 text-xs text-pink-800/80">Test data only — not production.</p>
      </div>

      {error && <AuthNotice tone="danger">{error}</AuthNotice>}

      {!configured && <AuthNotice tone="warning">{MISSING_SUPABASE_ENV}</AuthNotice>}

      {configured && !password && (
        <AuthNotice tone="warning">{MISSING_DEMO_PASSWORD}</AuthNotice>
      )}

      <div className="grid grid-cols-1 gap-2">
        {DEMO_ROLE_ORDER.map((key) => {
          const account = DEMO_ACCOUNTS[key];
          const busy = busyRole === key;
          return (
            <button
              key={key}
              type="button"
              data-quick-signin-role={key}
              disabled={Boolean(busyRole) || !canSignIn}
              onClick={() => void signInAs(key)}
              className={cn(
                "rounded-md border border-pink-200 bg-white px-3 py-2.5 text-left transition-colors",
                "hover:border-pink-400 hover:bg-pink-100/60",
                "disabled:cursor-not-allowed disabled:opacity-60",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-400/50",
              )}
            >
              <span className="block text-[13px] font-semibold text-pink-950">
                {busy ? "Signing in…" : account.roleLabel}
              </span>
              <span className="block text-xs text-pink-900/75">
                {account.name} · {account.blurb}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
