import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageShell } from "@/components/page-shell";
import { SuccessNotice } from "@/components/patterns/success-notice";
import { ErrorRetry } from "@/components/patterns/error-retry";
import { displayNameFromEmail, roleLabel } from "@/lib/portal-nav";
import { PASSWORD_MIN_LENGTH } from "@/lib/password-policy";
import { cn } from "@/lib/utils";

type Prefs = {
  emailRequestUpdates: boolean;
  emailNewMessages: boolean;
  alertNewRequests: boolean;
  pushThisDevice: boolean;
};

const PREFS_KEY = "lg-account-notification-prefs";

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) return { ...defaultPrefs(), ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return defaultPrefs();
}

function defaultPrefs(): Prefs {
  return {
    emailRequestUpdates: true,
    emailNewMessages: true,
    alertNewRequests: true,
    pushThisDevice: true,
  };
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <span className="text-sm text-foreground">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative h-[26px] w-11 shrink-0 rounded-full transition-colors",
          checked ? "bg-brand" : "bg-border",
        )}
      >
        <span
          className={cn(
            "absolute top-[3px] size-5 rounded-full bg-white shadow transition-transform",
            checked ? "left-[22px]" : "left-[3px]",
          )}
        />
      </button>
    </div>
  );
}

/**
 * Account settings (Figma N6 Account). Profile/password use Auth user_metadata
 * where possible; notification prefs are local stubs (Q7).
 */
export function AccountPage({
  email,
  role,
  showStaffAlerts = false,
  onSignOut,
}: {
  email: string;
  role: string;
  /** Admin/landlord/maintenance get “Alert me about new requests”. */
  showStaffAlerts?: boolean;
  onSignOut: () => void;
}) {
  const [name, setName] = useState(() => displayNameFromEmail(email));
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileMsg, setProfileMsg] = useState<string | null>(null);
  const [profileErr, setProfileErr] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState<string | null>(null);
  const [pwErr, setPwErr] = useState<string | null>(null);

  const [prefs, setPrefs] = useState<Prefs>(() => loadPrefs());

  async function loadProfile() {
    setLoading(true);
    setLoadError(null);
    try {
      const { data, error } = await supabase.auth.getUser();
      if (error) throw error;
      const meta = data.user?.user_metadata ?? {};
      if (typeof meta.full_name === "string" && meta.full_name.trim()) {
        setName(meta.full_name);
      } else {
        setName(displayNameFromEmail(data.user?.email ?? email));
      }
      if (typeof meta.phone === "string") setPhone(meta.phone);
    } catch (err) {
      setLoadError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadProfile();
  }, [email]);

  function savePrefs(next: Prefs) {
    setPrefs(next);
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setProfileBusy(true);
    setProfileMsg(null);
    setProfileErr(null);
    try {
      const { error } = await supabase.auth.updateUser({
        data: { full_name: name.trim(), phone: phone.trim() || null },
      });
      if (error) throw error;
      setProfileMsg("Profile saved.");
    } catch (err) {
      setProfileErr((err as Error).message);
    } finally {
      setProfileBusy(false);
    }
  }

  async function updatePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwMsg(null);
    setPwErr(null);
    if (!currentPassword) {
      setPwErr("Enter your current password.");
      return;
    }
    if (newPassword.length < PASSWORD_MIN_LENGTH) {
      setPwErr(`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
      return;
    }
    setPwBusy(true);
    try {
      // Stub: re-auth with current password before updating (no dedicated verify API).
      const { error: signErr } = await supabase.auth.signInWithPassword({
        email,
        password: currentPassword,
      });
      if (signErr) throw new Error("Current password is incorrect.");
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setCurrentPassword("");
      setNewPassword("");
      setPwMsg("Password updated.");
    } catch (err) {
      setPwErr((err as Error).message);
    } finally {
      setPwBusy(false);
    }
  }

  const metaLine = `${name || displayNameFromEmail(email)} · ${roleLabel(role)}`;

  return (
    <PageShell title="Account" meta={metaLine}>
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading account…</p>
      ) : loadError ? (
        <ErrorRetry message={loadError} onRetry={() => void loadProfile()} />
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <form
              onSubmit={saveProfile}
              className="flex flex-col gap-3 rounded-md border border-border bg-card p-4"
            >
              <h2 className="text-[15px] font-semibold">Profile</h2>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="acct-name" className="text-xs font-medium text-muted-foreground">
                  Name
                </label>
                <Input
                  id="acct-name"
                  className="h-11"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="acct-phone" className="text-xs font-medium text-muted-foreground">
                  Phone
                </label>
                <Input
                  id="acct-phone"
                  className="h-11"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  inputMode="tel"
                />
              </div>
              <div className="flex flex-col gap-0.5">
                <p className="text-xs text-muted-foreground">Email</p>
                <p className="text-sm font-medium">{email}</p>
              </div>
              {profileErr && <p className="text-sm text-destructive">{profileErr}</p>}
              {profileMsg && <SuccessNotice message={profileMsg} />}
              <div>
                <Button type="submit" variant="brand" className="h-9 px-3.5" disabled={profileBusy}>
                  {profileBusy ? "Saving…" : "Save profile"}
                </Button>
              </div>
            </form>

            <form
              onSubmit={updatePassword}
              className="flex flex-col gap-3 rounded-md border border-border bg-card p-4"
            >
              <h2 className="text-[15px] font-semibold">Password</h2>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="acct-current-pw" className="text-xs font-medium text-muted-foreground">
                  Current password
                </label>
                <Input
                  id="acct-current-pw"
                  className="h-11"
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="acct-new-pw" className="text-xs font-medium text-muted-foreground">
                  New password
                </label>
                <Input
                  id="acct-new-pw"
                  className="h-11"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  minLength={PASSWORD_MIN_LENGTH}
                  required
                />
              </div>
              {pwErr && <p className="text-sm text-destructive">{pwErr}</p>}
              {pwMsg && <SuccessNotice message={pwMsg} />}
              <div>
                <Button type="submit" variant="brand" className="h-9 px-3.5" disabled={pwBusy}>
                  {pwBusy ? "Updating…" : "Update password"}
                </Button>
              </div>
            </form>
          </div>

          <section className="rounded-md border border-border bg-card p-4">
            <h2 className="text-[15px] font-semibold">Notifications</h2>
            <p className="mb-2 text-xs text-muted-foreground">
              Preferences are saved on this device only (notification backend pending).
            </p>
            <ToggleRow
              label="Email · request updates"
              checked={prefs.emailRequestUpdates}
              onChange={(v) => savePrefs({ ...prefs, emailRequestUpdates: v })}
            />
            <ToggleRow
              label="Email · new messages"
              checked={prefs.emailNewMessages}
              onChange={(v) => savePrefs({ ...prefs, emailNewMessages: v })}
            />
            {showStaffAlerts ? (
              <ToggleRow
                label="Alert me about new requests"
                checked={prefs.alertNewRequests}
                onChange={(v) => savePrefs({ ...prefs, alertNewRequests: v })}
              />
            ) : null}
            <ToggleRow
              label="Push on this device"
              checked={prefs.pushThisDevice}
              onChange={(v) => savePrefs({ ...prefs, pushThisDevice: v })}
            />
          </section>

          <button
            type="button"
            onClick={onSignOut}
            className="rounded-md border border-border bg-card px-4 py-3 text-sm font-medium text-destructive hover:bg-destructive-tint"
          >
            Sign out
          </button>
        </div>
      )}
    </PageShell>
  );
}
