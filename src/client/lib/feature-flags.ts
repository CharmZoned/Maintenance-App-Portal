/**
 * Build-time feature flags. A flag is on only when its env var is exactly
 * "true" (case-insensitive); anything else, including unset, is off, so an
 * unfinished workflow can never appear by accident.
 *
 *   VITE_FEATURE_WORKER_SELF_CLAIM — technicians see Job offers and can Claim
 *   and Release jobs. Off at launch: admins assign work directly (audit UX-06).
 */

export type FeatureFlags = {
  workerSelfClaim: boolean;
};

export type FeatureFlagEnv = {
  VITE_FEATURE_WORKER_SELF_CLAIM?: string;
};

function isOn(raw: string | undefined): boolean {
  return raw?.trim().toLowerCase() === "true";
}

export function resolveFeatureFlags(env: FeatureFlagEnv): FeatureFlags {
  return {
    workerSelfClaim: isOn(env.VITE_FEATURE_WORKER_SELF_CLAIM),
  };
}

export const FEATURES: FeatureFlags = resolveFeatureFlags(import.meta.env);
