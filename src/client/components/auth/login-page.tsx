import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Props {
  onLogin: (email: string, password: string) => Promise<void>;
  onForgot: () => void;
  error: string | null;
  configured: boolean;
}

export function LoginPage({ onLogin, onForgot, error, configured }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setBusy(true);
    try {
      await onLogin(email.trim(), password);
    } catch {
      /* surfaced via error prop */
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-100 via-white to-emerald-50 p-6">
      <div className="w-full max-w-md space-y-6">
        <div className="space-y-1 text-center">
          <p className="text-sm font-medium tracking-wide text-emerald-800">Landlord Gopher</p>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">LG Maintenance Portal</h1>
          <p className="text-sm text-muted-foreground">Staff and admin sign-in</p>
        </div>

        <form onSubmit={submit} className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          {!configured && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Missing <code>VITE_SUPABASE_URL</code> / <code>VITE_SUPABASE_ANON_KEY</code>. Copy{" "}
              <code>.env.example</code> to <code>.env</code>.
            </p>
          )}
          {error && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
          )}
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <Button type="submit" className="w-full" disabled={busy || !configured}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
          <button
            type="button"
            className="w-full text-center text-sm text-emerald-800 underline-offset-2 hover:underline"
            onClick={onForgot}
          >
            Forgot password?
          </button>
        </form>
      </div>
    </div>
  );
}
