/**
 * UI password minimum — keep signup / login / reset in sync.
 * Match Supabase Auth minimum length once set in the dashboard (≥8).
 * Agents cannot flip Auth settings; see docs/ops/auth-password-policy.md.
 */
export const PASSWORD_MIN_LENGTH = 8;
