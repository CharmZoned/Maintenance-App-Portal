import { describe, expect, it, vi } from "vitest";
import { AUTH_ERROR_COPY, isRecoveryLinkHash, plainAuthError } from "./auth-errors";

describe("plainAuthError", () => {
  it("never shows raw GoTrue text for a missing session", () => {
    expect(plainAuthError({ message: "Auth session missing!" })).toBe(
      AUTH_ERROR_COPY.sessionMissing,
    );
    expect(plainAuthError({ message: "x", code: "session_not_found" })).toBe(
      AUTH_ERROR_COPY.sessionMissing,
    );
    expect(AUTH_ERROR_COPY.sessionMissing).not.toMatch(/session/i);
  });

  it("maps sign-in and sign-up errors by code, then by message", () => {
    expect(plainAuthError({ message: "Invalid login credentials", code: "invalid_credentials" })).toBe(
      AUTH_ERROR_COPY.invalidCredentials,
    );
    expect(plainAuthError({ message: "Email not confirmed" })).toBe(
      AUTH_ERROR_COPY.emailNotConfirmed,
    );
    expect(plainAuthError({ message: "User already registered" })).toBe(
      AUTH_ERROR_COPY.userExists,
    );
    expect(
      plainAuthError({ message: "Unable to validate email address: invalid format" }),
    ).toBe(AUTH_ERROR_COPY.invalidEmail);
    expect(
      plainAuthError({ message: "Password should be at least 6 characters.", code: "weak_password" }),
    ).toBe(AUTH_ERROR_COPY.weakPassword);
    expect(
      plainAuthError({ message: "New password should be different from the old password.", code: "same_password" }),
    ).toBe(AUTH_ERROR_COPY.samePassword);
    expect(plainAuthError({ message: "Email rate limit exceeded" })).toBe(
      AUTH_ERROR_COPY.rateLimited,
    );
    expect(plainAuthError({ message: "Database error saving new user" })).toBe(
      AUTH_ERROR_COPY.signupFailed,
    );
  });

  it("explains network failures without developer instructions", () => {
    expect(plainAuthError({ message: "Failed to fetch" })).toBe(AUTH_ERROR_COPY.network);
    expect(plainAuthError({ message: "fetch failed" })).toBe(AUTH_ERROR_COPY.network);
    expect(AUTH_ERROR_COPY.network).not.toMatch(/supabase|pnpm|VITE_/i);
  });

  it("falls back to a generic sentence for unknown errors", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(plainAuthError({ message: "Something odd: 0x1F" })).toBe(AUTH_ERROR_COPY.generic);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("isRecoveryLinkHash", () => {
  it("is true only for a recovery fragment carrying tokens", () => {
    expect(isRecoveryLinkHash("#access_token=a&refresh_token=b&type=recovery")).toBe(true);
    expect(isRecoveryLinkHash("#access_token=a&refresh_token=b&type=signup")).toBe(false);
    expect(isRecoveryLinkHash("#type=recovery")).toBe(false);
    expect(
      isRecoveryLinkHash("#error=access_denied&error_code=otp_expired&error_description=x"),
    ).toBe(false);
    expect(isRecoveryLinkHash("")).toBe(false);
  });
});
