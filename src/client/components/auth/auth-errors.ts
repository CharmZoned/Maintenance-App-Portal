import { PASSWORD_MIN_LENGTH } from "@/lib/password-policy";

/** Shown when a reset link is missing, expired or already used. */
export const RESET_LINK_EXPIRED = "This reset link has expired or was already used.";

export const AUTH_ERROR_COPY = {
  network: "We can’t reach the sign-in service. Check your connection and try again.",
  invalidCredentials:
    "That email and password don’t match. Check them and try again, or reset your password.",
  emailNotConfirmed:
    "Confirm your email first. Open the link we sent when you created your account.",
  userExists: "An account with this email already exists. Sign in instead, or reset your password.",
  invalidEmail: "Enter a valid email address, like name@example.com.",
  weakPassword: `Choose a longer password — at least ${PASSWORD_MIN_LENGTH} characters.`,
  samePassword: "Your new password must be different from your current one.",
  rateLimited: "Too many attempts. Wait a minute, then try again.",
  sessionMissing: `${RESET_LINK_EXPIRED} Request a new link to reset your password.`,
  signupFailed: "We couldn’t create your account just now. Try again in a moment.",
  generic: "Something went wrong. Try again in a moment.",
} as const;

type AuthErrorLike = { message?: string | null; code?: string | null } | null | undefined;

/**
 * Turn a Supabase Auth error into a plain sentence for the auth screens.
 * Raw GoTrue text ("Auth session missing!", "Invalid login credentials") never
 * reaches the user; unknown errors fall back to a generic line (and the raw
 * message goes to the console for debugging).
 */
export function plainAuthError(error: AuthErrorLike): string {
  const code = (error?.code ?? "").trim().toLowerCase();
  const message = (error?.message ?? "").trim().toLowerCase();

  if (
    message === "fetch failed" ||
    message === "failed to fetch" ||
    message.includes("load failed") ||
    message.includes("networkerror")
  ) {
    return AUTH_ERROR_COPY.network;
  }
  if (code === "invalid_credentials" || message.includes("invalid login credentials")) {
    return AUTH_ERROR_COPY.invalidCredentials;
  }
  if (code === "email_not_confirmed" || message.includes("email not confirmed")) {
    return AUTH_ERROR_COPY.emailNotConfirmed;
  }
  if (
    code === "user_already_exists" ||
    code === "email_exists" ||
    message.includes("already registered")
  ) {
    return AUTH_ERROR_COPY.userExists;
  }
  if (
    code === "email_address_invalid" ||
    message.includes("unable to validate email") ||
    message.includes("invalid format")
  ) {
    return AUTH_ERROR_COPY.invalidEmail;
  }
  if (code === "same_password" || message.includes("different from the old password")) {
    return AUTH_ERROR_COPY.samePassword;
  }
  if (code === "weak_password" || message.includes("password should")) {
    return AUTH_ERROR_COPY.weakPassword;
  }
  if (
    code.startsWith("over_") ||
    message.includes("rate limit") ||
    message.includes("for security purposes")
  ) {
    return AUTH_ERROR_COPY.rateLimited;
  }
  if (
    code === "session_not_found" ||
    code === "session_expired" ||
    code === "otp_expired" ||
    code === "refresh_token_not_found" ||
    code === "no_authorization" ||
    message.includes("auth session missing") ||
    message.includes("session not found") ||
    message.includes("invalid or has expired")
  ) {
    return AUTH_ERROR_COPY.sessionMissing;
  }
  if (code === "unexpected_failure" || message.includes("database error saving new user")) {
    return AUTH_ERROR_COPY.signupFailed;
  }
  if (error?.message) console.warn("[auth]", error.code ?? "", error.message);
  return AUTH_ERROR_COPY.generic;
}

/** True for the URL fragment a valid reset email link lands with (`type=recovery` + tokens). */
export function isRecoveryLinkHash(hash: string): boolean {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  return params.get("type") === "recovery" && params.has("access_token");
}

const RESET_EMAIL_KEY = "lg.auth.resetEmail";

/** Remember the email a reset was asked for, so "Send a new link" can prefill it. */
export function rememberResetEmail(email: string): void {
  try {
    if (email.trim()) window.localStorage.setItem(RESET_EMAIL_KEY, email.trim());
  } catch {
    /* storage blocked — prefill is a convenience only */
  }
}

export function recallResetEmail(): string {
  try {
    return window.localStorage.getItem(RESET_EMAIL_KEY) ?? "";
  } catch {
    return "";
  }
}

export function forgetResetEmail(): void {
  try {
    window.localStorage.removeItem(RESET_EMAIL_KEY);
  } catch {
    /* ignore */
  }
}
