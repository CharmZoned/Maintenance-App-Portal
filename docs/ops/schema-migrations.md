# Schema migrations (ops)

**Project:** Landlord Gopher Supabase `bgjkjtfgrfiszbzatriq`  
**Source of truth:** `supabase/migrations/` on a git branch → PR → `master`, then apply to the target DB.

## Rule (no live-only DDL)

1. **Never** apply schema changes to shared/live Supabase (MCP `apply_migration`, SQL Editor, Dashboard) unless the identical SQL already exists as a file under `supabase/migrations/` on a branch with an open (or merged) PR.
2. Write the migration file first → open/update the PR → **then** apply to live (or staging) using that file’s contents.
3. If you already applied live by mistake: capture the SQL into a new timestamped migration on a branch immediately, and do not leave live ahead of `master` (LGA-17 / Phase 5 `#11` pattern).

Agents: phase-ship expects migrations in the PR. Live apply is a **post-file** step, not a substitute for the repo.

## Recommended apply order

1. Add `supabase/migrations/YYYYMMDDHHMMSS_<name>.sql` on `cursor/...` branch.
2. Open PR; keep SQL reviewable (additive preferred; never break `inquiries`).
3. Prefer applying first on a **staging** Supabase branch / non-production project when available.
4. After human review (or with explicit ops go-ahead), apply the same SQL to live.
5. Update `docs/deferred-work.md` / `docs/supabase-schema.md` if the change is user-visible or ops-relevant.

## Staging recommendation

Today this org uses a single shared project for portal + website Auth. That makes live-only experiments costly.

**Recommended:** create a Supabase **preview/staging branch** (or a separate staging project) linked to non-production portal deploys. Apply new migrations there first; promote to production only after the PR is ready. Until staging exists, treat live as production: file-in-repo + PR before any DDL.

## Drift check (quick)

Compare Supabase MCP `list_migrations` names against filenames in `supabase/migrations/` on `master`. Live-only names (e.g. applied via MCP without a matching repo file) are drift — capture them before the next phase.

Baseline pre-Phase-1 migrations may exist only on the remote history; portal phase work starts at `20261113160000_*`. New work must always land in this folder.
