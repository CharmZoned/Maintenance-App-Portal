import { describe, expect, it } from "vitest";
import {
  PRODUCTION_PROJECT_REF,
  isKnownNonProductionBackend,
  isProductionSupabaseUrl,
  resolveAppEnv,
  stagingToolsAllowed,
} from "./env";

const PROD_URL = `https://${PRODUCTION_PROJECT_REF}.supabase.co`;
const STAGING_URL = "https://abcdefghijklmnopqrst.supabase.co";
const EMULATOR_URL = "http://127.0.0.1:54330";

describe("env", () => {
  it("treats a missing or unknown VITE_APP_ENV as production", () => {
    expect(resolveAppEnv(undefined)).toBe("production");
    expect(resolveAppEnv(null)).toBe("production");
    expect(resolveAppEnv("")).toBe("production");
    expect(resolveAppEnv("prod")).toBe("production");
    expect(resolveAppEnv("preview")).toBe("production");
  });

  it("recognises staging and local, ignoring case and whitespace", () => {
    expect(resolveAppEnv("staging")).toBe("staging");
    expect(resolveAppEnv(" Staging ")).toBe("staging");
    expect(resolveAppEnv("LOCAL")).toBe("local");
  });

  it("spots the production project by hostname", () => {
    expect(isProductionSupabaseUrl(PROD_URL)).toBe(true);
    expect(isProductionSupabaseUrl(PROD_URL.toUpperCase())).toBe(true);
    expect(isProductionSupabaseUrl(`${PROD_URL}/rest/v1`)).toBe(true);
    expect(isProductionSupabaseUrl(STAGING_URL)).toBe(false);
    expect(isProductionSupabaseUrl(EMULATOR_URL)).toBe(false);
    // The ref appearing somewhere other than the host does not make it production.
    expect(isProductionSupabaseUrl(`${STAGING_URL}/?from=${PRODUCTION_PROJECT_REF}`)).toBe(false);
  });

  it("accepts only backends known not to be production", () => {
    expect(isKnownNonProductionBackend(STAGING_URL)).toBe(true);
    expect(isKnownNonProductionBackend(EMULATOR_URL)).toBe(true);
    expect(isKnownNonProductionBackend("http://localhost:54330")).toBe(true);
    expect(isKnownNonProductionBackend(PROD_URL)).toBe(false);
  });

  it("denies by default when the backend cannot be identified", () => {
    expect(isKnownNonProductionBackend(undefined)).toBe(false);
    expect(isKnownNonProductionBackend(null)).toBe(false);
    expect(isKnownNonProductionBackend("")).toBe(false);
    expect(isKnownNonProductionBackend("not a url")).toBe(false);
    // A custom domain could front production, so it is not trusted.
    expect(isKnownNonProductionBackend("https://api.example.com")).toBe(false);
    // Look-alike hosts are not hosted project addresses.
    expect(isKnownNonProductionBackend("https://abcdefghijklmnopqrst.supabase.co.evil.test")).toBe(false);
    expect(isKnownNonProductionBackend("https://short.supabase.co")).toBe(false);
  });

  it("allows staging tools only off production, on both counts", () => {
    expect(stagingToolsAllowed("staging", STAGING_URL)).toBe(true);
    expect(stagingToolsAllowed("local", EMULATOR_URL)).toBe(true);
    // A production build never gets them, whatever it points at.
    expect(stagingToolsAllowed("production", STAGING_URL)).toBe(false);
    // A staging build wired to the production database never gets them either.
    expect(stagingToolsAllowed("staging", PROD_URL)).toBe(false);
    expect(stagingToolsAllowed("local", PROD_URL)).toBe(false);
    // Nor does one with no backend configured, or one behind an unrecognised host.
    expect(stagingToolsAllowed("staging", undefined)).toBe(false);
    expect(stagingToolsAllowed("staging", "https://api.example.com")).toBe(false);
  });
});
