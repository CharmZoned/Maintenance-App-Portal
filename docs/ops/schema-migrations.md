# Schema migrations (ops)

**Project:** Landlord Gopher Supabase `bgjkjtfgrfiszbzatriq`  
**Source of truth:** `supabase/migrations/` on a git branch → PR → `master`, then apply to the target DB.

## Rule (no live-only DDL)

1. **Never** apply schema changes to shared/live Supabase (MCP `apply_migration`, SQL Editor, Dashboard) unless the identical SQL already exists as a file under `supabase/migrations/` on a branch with an open (or merged) PR.
2. Write the migration file first → open/update the PR → **then** apply to live (or staging) using that file’s contents.
3. If you already applied live by mistake: capture the SQL into a new timestamped migration on a branch immediately, and do not leave live ahead of `master` (LGA-17 / Phase 5 `#11` pattern).

Agents: phase-ship expects migrations in the PR. Live apply is a **post-file** step, not a substitute for the repo.

## Filenames and versions (must stay unique)

- Repo files are `YYYYMMDDHHMMSS_<snake_name>.sql`. The **14-digit prefix is the migration version**.
- **Every new migration version must be unique** across `master` and all open PRs. Do not reuse a timestamp already claimed by another branch (coordinate or bump by ≥1 second / use a later slot).
- Prefer bumping forward from the latest repo prefix on `master` (and scan open `cursor/*` branches before picking).

## Applying without version drift

Supabase MCP `apply_migration` often **stamps a new clock version** (e.g. live `20261113201805_phase2_authz_approve_staff_gate`) that does **not** match the repo filename (`20261113203000_phase2_authz_approve_staff_gate.sql`). CLI / deploy tooling then treats the repo file as “pending” even though the SQL already ran.

**Required when applying to a shared DB:**

1. Prefer applying so the recorded version **equals** the repo file prefix (CLI `supabase db push` / linked migration apply against that file), **or**
2. Immediately after an MCP/Dashboard apply that stamped a different version, run **`supabase migration repair`** (mark the repo version as applied / align history) so live history and `supabase/migrations/` agree.

Do not leave a permanent “name matches, version differs” gap without a deferred-work row and a repair plan.

## Recommended apply order

1. Pick a **unique** `YYYYMMDDHHMMSS` not used on `master` or open PRs.
2. Add `supabase/migrations/YYYYMMDDHHMMSS_<name>.sql` on a `cursor/...` branch.
3. Open PR; keep SQL reviewable (additive preferred; never break `inquiries`).
4. Prefer applying first on a **staging** Supabase branch / non-production project when available.
5. After human review (or with explicit ops go-ahead), apply the same SQL to live **with matching version** (or repair afterward).
6. Update `docs/deferred-work.md` / `docs/supabase-schema.md` if the change is user-visible or ops-relevant.

## Staging recommendation

Today this org uses a single shared project for portal + website Auth. That makes live-only experiments costly.

**Recommended:** create a Supabase **preview/staging branch** (or a separate staging project) linked to non-production portal deploys. Apply new migrations there first; promote to production only after the PR is ready. Until staging exists, treat live as production: file-in-repo + PR before any DDL.

## Drift check (quick)

Compare Supabase MCP `list_migrations` to `supabase/migrations/` on `master` on **both**:

| Check | Drift if… |
|-------|-----------|
| **Name** | Live name has no matching `*_name.sql` on `master` (and no open PR owning it) |
| **Version** | Live version ≠ repo file prefix for the same logical migration |

Name-only checks miss MCP clock stamps. Track mismatches in `docs/deferred-work.md` until repaired.

Baseline pre-Phase-1 migrations may exist only on the remote history; portal phase work starts at `20261113160000_*`. New work must always land in this folder. Pre-repo maintenance ACL still live on prod is summarized in [`live-maintenance-acl-baseline.md`](./live-maintenance-acl-baseline.md).
