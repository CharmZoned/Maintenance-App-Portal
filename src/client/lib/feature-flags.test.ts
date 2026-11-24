import { describe, expect, it } from "vitest";
import { resolveFeatureFlags } from "./feature-flags";

describe("resolveFeatureFlags", () => {
  it("is off when unset", () => {
    expect(resolveFeatureFlags({}).workerSelfClaim).toBe(false);
  });

  it("is on only for the exact value true", () => {
    expect(resolveFeatureFlags({ VITE_FEATURE_WORKER_SELF_CLAIM: "true" }).workerSelfClaim).toBe(true);
    expect(resolveFeatureFlags({ VITE_FEATURE_WORKER_SELF_CLAIM: " TRUE " }).workerSelfClaim).toBe(true);
    for (const value of ["1", "yes", "on", "false", ""]) {
      expect(resolveFeatureFlags({ VITE_FEATURE_WORKER_SELF_CLAIM: value }).workerSelfClaim).toBe(false);
    }
  });
});
