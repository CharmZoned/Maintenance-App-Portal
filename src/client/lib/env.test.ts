import { describe, expect, it } from "vitest";
import {
  PRODUCTION_PROJECT_REF,
  isProductionSupabaseUrl,
  resolveAppEnv,
  stagingToolsAllowed,
} from "./env";

const PROD_URL = `https://${PRODUCTION_PROJECT_REF}.supabase.co`;
const STAGING_URL = "https://stagingbranchref.supabase.co";

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

  it("spots the production project in any URL form", () => {
    expect(isProductionSupabaseUrl(PROD_URL)).toBe(true);
    expect(isProductionSupabaseUrl(PROD_URL.toUpperCase())).toBe(true);
    expect(isProductionSupabaseUrl(`${PROD_URL}/rest/v1`)).toBe(true);
    expect(isProductionSupabaseUrl(STAGING_URL)).toBe(false);
    expect(isProductionSupabaseUrl("http://127.0.0.1:54330")).toBe(false);
    expect(isProductionSupabaseUrl(undefined)).toBe(false);
  });

  it("allows staging tools only off production, on both counts", () => {
    expect(stagingToolsAllowed("staging", STAGING_URL)).toBe(true);
    expect(stagingToolsAllowed("local", "http://127.0.0.1:54330")).toBe(true);
    // A production build never gets them, whatever it points at.
    expect(stagingToolsAllowed("production", STAGING_URL)).toBe(false);
    // A staging build wired to the production database never gets them either.
    expect(stagingToolsAllowed("staging", PROD_URL)).toBe(false);
    expect(stagingToolsAllowed("local", PROD_URL)).toBe(false);
  });
});
