import { useCallback, useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase, isSupabaseConfigured } from "../lib/supabase";
import type { AccountStatus, AppRole } from "../types.supabase";

export interface UserRoleRow {
  user_id: string;
  role: AppRole;
  landlord_id: number | null;
  tenant_id: number | null;
  staff_id: number | null;
  account_status: AccountStatus;
}

export type AuthGate =
  | { state: "loading" }
  | { state: "unauthenticated" }
  | { state: "error"; user: User; message: string }
  | { state: "no_role"; user: User }
  | { state: "unapproved"; user: User; role: UserRoleRow }
  | { state: "forbidden"; user: User; role: UserRoleRow }
  | { state: "ready"; user: User; session: Session; role: UserRoleRow };

function canAccessPortfolio(role: UserRoleRow): boolean {
  if (role.account_status !== "approved") return false;
  if (role.role === "admin") return true;
  if (role.role === "maintenance" && role.staff_id != null) return true;
  if (role.role === "tenant" && role.tenant_id != null) return true;
  return false;
}

export function useAuth() {
  const [gate, setGate] = useState<AuthGate>({ state: "loading" });
  const [authError, setAuthError] = useState<string | null>(null);

  const resolve = useCallback(async (session: Session | null) => {
    if (!session?.user) {
      setGate({ state: "unauthenticated" });
      return;
    }
    const { data, error } = await supabase
      .from("user_roles")
      .select("*")
      .eq("user_id", session.user.id)
      .maybeSingle();
    if (error) {
      setAuthError(error.message);
      setGate({ state: "error", user: session.user, message: error.message });
      return;
    }
    if (!data) {
      setAuthError(null);
      setGate({ state: "no_role", user: session.user });
      return;
    }
    const role = data as UserRoleRow;
    if (role.account_status !== "approved") {
      setAuthError(null);
      setGate({ state: "unapproved", user: session.user, role });
      return;
    }
    if (!canAccessPortfolio(role)) {
      setAuthError(null);
      setGate({ state: "forbidden", user: session.user, role });
      return;
    }
    setAuthError(null);
    setGate({ state: "ready", user: session.user, session, role });
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setAuthError("Supabase env vars are not configured. See .env.example.");
      setGate({ state: "unauthenticated" });
      return;
    }

    let mounted = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      await resolve(data.session);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      void resolve(session);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [resolve]);

  const login = useCallback(async (email: string, password: string) => {
    setAuthError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setAuthError(error.message);
      throw error;
    }
  }, []);

  /** Returns true when email confirmation is required (no session yet). */
  const signup = useCallback(async (email: string, password: string): Promise<"session" | "confirm"> => {
    setAuthError(null);
    const emailRedirectTo = `${window.location.origin}/dashboard`;
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo },
    });
    if (error) {
      setAuthError(error.message);
      throw error;
    }
    if (data.session) return "session";
    return "confirm";
  }, []);

  const logout = useCallback(async () => {
    setAuthError(null);
    await supabase.auth.signOut();
  }, []);

  const requestPasswordReset = useCallback(async (email: string) => {
    setAuthError(null);
    const redirectTo = `${window.location.origin}/reset-password`;
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) {
      setAuthError(error.message);
      throw error;
    }
  }, []);

  const updatePassword = useCallback(async (password: string) => {
    setAuthError(null);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setAuthError(error.message);
      throw error;
    }
  }, []);

  const retryRole = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    await resolve(data.session);
  }, [resolve]);

  return {
    gate,
    authError,
    setAuthError,
    login,
    signup,
    logout,
    requestPasswordReset,
    updatePassword,
    retryRole,
    configured: isSupabaseConfigured(),
  };
}

export type AuthValue = ReturnType<typeof useAuth>;
