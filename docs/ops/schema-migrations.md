# Schema migrations (ops)

**Project:** Landlord Gopher Supabase `bgjkjtfgrfiszbzatriq` (production)  
**Source of truth:** `supabase/migrations/` in this repo. A change travels feature branch → PR into `staging` → release PR `staging` → `master` ([ADR-0001](../adr/0001-environments-and-promotion.md)). This portal repo is the only place database structure changes are written — the website repo applies none ([ADR-0009](../adr/0009-schema-ownership.md)).  
**Status (verified 2026-11-18):** production's migration history matches the repo (see [Drift check](#drift-check-quick)); a staging database exists but is broken and must not be used until it is rebuilt (see [Staging database](#staging-database-adr-0003)).

## Rule (file only — no live-only DDL)

[ADR-0004](../adr/0004-database-promotion.md) (accepted 2026-11-18) turns the old "file first, then apply by hand" rule into **"file only"**:

1. Every schema change is a file under `supabase/migrations/` on a feature branch with a PR into `staging`. **No** schema change reaches staging or production through the Dashboard, SQL Editor, or MCP `apply_migration`.
2. **Once Phase 4 of [`docs/staging/BUILD_PLAN.md`](../staging/BUILD_PLAN.md) lands**, production migrations are applied automatically by the Supabase GitHub integration when the release PR (`staging` → `master`) merges. Nobody applies to production by hand from then on.
3. **Until Phase 4 lands**, if a migration must reach production it is still applied by hand, with a recorded version **equal to the repo file prefix** (CLI `supabase db push`) — **never** via MCP `apply_migration`, which stamps a different version. Compare `list_migrations` with the repo first (read-only) so nothing already recorded is pushed again.
4. An applied migration file is never edited. Mistakes are corrected by a new migration.
5. If you already applied live by mistake: capture the SQL into a new timestamped migration on a branch immediately, and do not leave live ahead of `master` (LGA-17 / Phase 5 `#11` pattern).

Agents: phase-ship expects migrations in the PR. Applying is never a substitute for the repo file, and an agent never uses MCP `apply_migration` on staging or production.

## Filenames and versions (must stay unique)

- Repo files are `YYYYMMDDHHMMSS_<snake_name>.sql`. The **14-digit prefix is the migration version**.
- **Every new migration version must be unique** across `staging`, `master`, and all open PRs. Do not reuse a timestamp already claimed by another branch (coordinate or bump by ≥1 second / use a later slot).
- Prefer bumping forward from the latest repo prefix on `staging` (and scan open `cursor/*` branches before picking).

## Applying without version drift

Supabase MCP `apply_migration` often **stamps a new clock version** (e.g. live `20261113201805_phase2_authz_approve_staff_gate`) that does **not** match the repo filename (`20261113203000_phase2_authz_approve_staff_gate.sql`). CLI / deploy tooling then treats the repo file as “pending” even though the SQL already ran.

**Required when applying to a shared DB by hand** (only until Phase 4 lands — see [Rule](#rule-file-only--no-live-only-ddl)):

1. Apply so the recorded version **equals** the repo file prefix (CLI `supabase db push` / linked migration apply against that file). This is the only allowed way to apply.
2. **Recovery only** — if an MCP/Dashboard apply has already stamped a different version (a breach of the rule above), immediately align **remote** history (no DDL — history rows only). Always pass **`--remote`** (local default would miss production history). Cases:
   - **Clock ≠ repo prefix (repo version not yet in history):** `repair --remote --yes --status reverted <clock>` then **immediately** `repair --remote --yes --status applied <repo_prefix>`. Never `db push` / migrate between those two — a half-finished repair makes CLI treat already-applied SQL as pending and may re-execute it.
   - **True duplicate (repo prefix already present + extra clock stamp):** `repair --remote --yes --status reverted <duplicate_clock>` **only** — do not re-`applied` the matching repo prefix.
   - **Recovery if `reverted` succeeded and `applied` failed:** re-run **only** the missing `applied` stamps; never `db push` until `list_migrations` verifies every repo prefix is present.

Do not leave a permanent “name matches, version differs” gap without a deferred-work row and a repair plan.

## Recommended apply order

1. Pick a **unique** `YYYYMMDDHHMMSS` not used on `staging`, `master`, or open PRs.
2. Add `supabase/migrations/YYYYMMDDHHMMSS_<name>.sql` on a feature branch (e.g. `cursor/...`).
3. Open a PR into **`staging`**; keep SQL reviewable (additive preferred; never break `inquiries`). CI and the `Supabase Preview` check must pass — see [`ci-required-checks.md`](./ci-required-checks.md).
4. Merge into `staging`. Once Phase 2 of the build plan has rebuilt the staging database, that merge applies the migration there and it is tested on staging. **Until then there is no usable staging database** — do not apply to or test on the existing broken branch (see [Staging database](#staging-database-adr-0003)).
5. Production: the migration ships in the release PR `staging` → `master` (merge commit only). Once Phase 4 lands, merging that PR applies it automatically. **Until Phase 4 lands**, and only if it must reach production, apply by hand after human review (or with explicit ops go-ahead) **with matching version** (CLI `supabase db push`) — never MCP `apply_migration`. See [Applying without version drift](#applying-without-version-drift).
6. Update `docs/deferred-work.md` / `docs/supabase-schema.md` if the change is user-visible or ops-relevant.

## Staging database (ADR-0003)

**Source of truth for staging-database + migration-history status:** this section + the historical inventory below. Other docs should link here instead of restating it. Decision: [ADR-0003](../adr/0003-staging-database.md). Steps: [`docs/staging/BUILD_PLAN.md`](../staging/BUILD_PLAN.md) Phase 2. Design: [`docs/staging/DESIGN_PLAN.md`](../staging/DESIGN_PLAN.md).

Production is a single shared project for portal + website (`bgjkjtfgrfiszbzatriq`). That makes live-only experiments costly, which is why a working staging database is being built.

> **Update 2026-11-19:** the broken branch described below (`ffczsojnowxthntnliac`) has been **deleted**. A new staging branch was created the same day: **project ref `gzwcegtwzzhtstgzphaw`**. It is empty (no migrations applied) until the "Rebuild staging database" workflow has been run, and must not be used for testing before then; see the owner steps in [`docs/staging/BUILD_PLAN.md`](../staging/BUILD_PLAN.md). Also found: 24 of production's 59 migration records hold no SQL, so a staging branch must be rebuilt from the files in `supabase/migrations/`, not from production's records. Two migrations (`20261118190000`, `20261119090000`) are on `staging` and not yet applied to production — that is expected; they ship with the first release.

### Current state (verified 2026-11-18)

An earlier version of this doc said no staging branch existed. That was wrong — one does, and it is broken.

| Item | Value |
|------|-------|
| **Supabase branch** | `staging` on project `bgjkjtfgrfiszbzatriq` — project ref `ffczsojnowxthntnliac`, created 2026-11-14 |
| **Last run** | `MIGRATIONS_FAILED` |
| **Persistent** | No |
| **Linked git branch** | None |
| **Missing migrations** | `20261114224032_inquiry_email_controls`, `20261114233000_visibility_helpers_require_approved` |
| **Version mismatches** | Four migrations recorded under versions that are not repo file prefixes: `20261114000000`, `20261114180000`, `20261114181000`, `20261114190000` |
| **Use it for testing?** | **No.** Without `visibility_helpers_require_approved` its access helpers do not require an approved account, so a permissions test that passes there proves nothing ([ADR-0003](../adr/0003-staging-database.md)). Do not apply, dry-run, or repair on it. |

### Decision and what happens next

- **Owner decision (ADR-0003, accepted 2026-11-18):** the branch is **deleted and rebuilt** as a persistent Supabase branch linked to git `staging`, with every migration applied from zero. It is not repaired in place. This is Phase 2 of the build plan; nothing in this doc should be run to "fix" the current branch.
- After the rebuild, the new project ref is recorded here, and a merge into git `staging` applies new migrations to the staging database.
- **Until then:** treat `bgjkjtfgrfiszbzatriq` as production with no staging in front of it. The checks available before production are the local emulator (`pnpm test`, built from `supabase/migrations/`) and the `Supabase Preview` check on the PR.

Related, same verification date:

- `supabase/config.toml` did not exist on `master` @ `90a0239`; Phase 1 of the build plan adds it. It must exist before the staging rebuild (ADR-0003).
- No Edge Functions are deployed on production. Three exist in `supabase/functions/`; they stay on hold with Stripe.
- Portal hosting is no longer deferred: it is planned on Vercel in Phases 3–4 of the build plan. Hostnames are still to be chosen by the owner (needed for Phase 4 only).

## Drift check (quick)

Compare Supabase MCP `list_migrations` to `supabase/migrations/` on `master` on **both**:

| Check | Drift if… |
|-------|-----------|
| **Name** | Live name has no matching `*_name.sql` on `master` (and no open PR owning it) |
| **Version** | Live version ≠ repo file prefix for the same logical migration |

Name-only checks miss MCP clock stamps. Track mismatches in `docs/deferred-work.md` until repaired.

**Last check — 2026-11-18:** production (`bgjkjtfgrfiszbzatriq`) records 59 versions, identical to the 59 file prefixes in `supabase/migrations/` on `master` @ `90a0239`. No drift on production. The `staging` Supabase branch does drift — see [Staging database](#staging-database-adr-0003); it is rebuilt, not repaired.

Pre-portal setup scripts (`20261010152511` … `20261109204421`) now ship in this folder so a fresh Supabase project can rebuild from the repo. Live already has those version stamps — **do not re-run** them on production (`db push` should treat them as applied). Portal phase work continues from `20261113160000_*`. Pre-repo maintenance ACL notes: [`live-maintenance-acl-baseline.md`](./live-maintenance-acl-baseline.md).

## One-shot repair inventory (hygiene #8) — snapshotted 2026-11-14 — HISTORICAL

> **HISTORICAL — completed, verified matching on 2026-11-18. Do not run.**
>
> - Production's migration history has 59 versions, identical to the 59 file prefixes in `supabase/migrations/` on `master` @ `90a0239`. The mismatches inventoried in §B and §C below **no longer exist on production**.
> - Who ran the repair, and when, is not recorded.
> - **The §E command sequence must NOT be run again.** It reverts and re-stamps versions that are no longer the state of production.
> - §A–§E are kept unchanged below for the record only. They describe production as of 2026-11-14, not today — for example, the three §D versions `20261113214011`, `20261114002715`, and `20261114002848` now have files in `supabase/migrations/` under the same versions.
> - Current rules are in [Rule](#rule-file-only--no-live-only-ddl) and [Recommended apply order](#recommended-apply-order) above.

**Not standing daily ops** — a dated inventory + command sequence for this drift episode. After a successful §E run, update the §E status line (repaired @ date/SHA) and the deferred-work repair row; do **not** re-run blindly on a later date without a fresh `list_migrations` diff.

**Snapshotted:** 2026-11-14 via MCP `list_migrations` / `schema_migrations` on `bgjkjtfgrfiszbzatriq` vs `supabase/migrations/` on `master` @ `33424b7` (see PR #31).  
**Scope:** History alignment only (`supabase migration repair`). **No DDL.** Do not run while another migration/RLS PR is open. **Never repair/revert §D versions.**

### A. Clean match (repo prefix = live version; no duplicate clock)

| Version | Name |
|---------|------|
| `20261113193000` | `phase1_5_force_rls_payment_rpc` |
| `20261113241000` | `phase_lga18_landlord_approve_access` |
| `20261114030000` | `harden_landlord_helpers_and_mr_notes` |
| `20261114040000` | `property_documents_storage_path_bind` |

Matching repo rows that also have a duplicate clock are listed only under **§B** (keep the matching row; revert the extra stamp).

### B. True duplicate live entries (repo prefix already present + extra clock)

**Action:** `reverted` on the duplicate clock **only** (do not re-`applied` the matching repo prefix).

| Keep (already on live) | Revert (duplicate stamp only) | Notes |
|------------------------|-------------------------------|-------|
| `20261114010000` `fix_authenticated_portfolio_and_mr_grants` | `20261113232311` same name | Early Wave-1 apply + later matching stamp |
| `20261114020000` `fix_user_roles_pending_and_set_account_status` | `20261113232318` same name | Same pattern |

### C. MCP clock stamp ≠ repo prefix (SQL already applied; repo prefix missing from history)

**Action:** `reverted` on each live clock, then **immediately** `applied` on the repo prefix (history only — do **not** re-run SQL).

| Live clock version(s) to revert | Live name(s) | Repo file prefix to mark applied |
|---------------------------------|--------------|----------------------------------|
| `20261113162610` | `phase1_account_status_and_rls` | `20261113160000` |
| `20261113164630` | `phase1_enforce_account_status` | `20261113180000` |
| `20261113195835` | `phase2_account_approval_applications` | `20261113200000` |
| `20261113201805` | `phase2_authz_approve_staff_gate` | `20261113203000` |
| `20261113203316` | `phase3_tenant_maintenance_status_history` | `20261113210000` |
| `20261113204421` | `phase3_tighten_tenant_insert_photo_path` | `20261113213000` |
| `20261113205730` | `phase3_storage_acl_tenant_comments` | `20261113220000` |
| `20261113212113` | `phase5_property_documents` | `20261113230000` |
| `20261113213318` | `phase5_documents_unit_cascade` | `20261113233000` |
| `20261113213530` | `phase_acl_landlord_readonly_apps_admin` | `20261113252000` |
| `20261113215737` | `phase_acl_mr_update_new_row_check` | `20261113252100` |
| `20261113213707` **and** `20261113215853` | `lga15_maintenance_status_category_checks` / `…_241000` | `20261113242000` (neither live stamp equals repo prefix) |

### D. Permanent / documented live-only exceptions (do **not** “repair away”)

| Live version | Name | Why keep |
|--------------|------|----------|
| `20261010152511` … `20261109204421` | Pre-portal setup (intake → photos/comments) | **Now in** `supabase/migrations/` (same prefixes). Live history already stamped — never re-apply SQL; fresh envs get them via normal `db push`. See [`live-maintenance-acl-baseline.md`](./live-maintenance-acl-baseline.md) |
| `20261113214011` | `phase_acl_mr_update_uses_helper` | Intermediate live ACL step; superseded in effect by later `phase_acl_mr_update_new_row_check` / repo `20261113252100_*` — leave stamped; do not re-apply |
| `20261114002715` | `public_unit_listings` | Website/listings path; not in portal `supabase/migrations/` |
| `20261114002848` | `fix_listing_photo_path_check` | Same; website-adjacent |

If a secondary env must match listings DDL, capture those two into a dedicated repo (website or portal) migration PR first — still no live-only DDL.

### E. Repair command sequence — HISTORICAL, DO NOT RUN (was: run after **ops go-ahead** + CLI linked)

> **Do not run.** Production already matches the repo (verified 2026-11-18). Kept for the record only.

Requires `supabase` CLI logged in (env `SUPABASE_ACCESS_TOKEN` only — **never** commit, paste into chat, or put in repo `.env`). Project must be linked to `bgjkjtfgrfiszbzatriq`. **History only** — no SQL files executed. **Gate (historical — no longer applies; there is no go-ahead to give, this sequence is closed):** explicit ops go-ahead (staging optional — do not block repair on the paused `staging` create).

**Atomicity:** Run step 1 then step 2 as **one** ops action (`&&` below). After step 1 alone, §C repo prefixes are unmarked — `supabase db push` would treat already-applied Phase 1–5 / lga15 SQL as pending and **re-run** it.

**Recovery (if step 1 succeeded and step 2 failed):** Do **not** `db push`. Re-run **only** step 2 (`applied` list). If unsure which stamps landed, compare MCP `list_migrations` to the §C “mark applied” column and apply the missing prefixes only. **Do not repair/revert §D.**

```bash
# From repo root, linked to project bgjkjtfgrfiszbzatriq
# HISTORY ONLY — updates supabase_migrations rows; does NOT run or undo SQL/DDL.
# Must target remote (--remote). --yes skips CLI prompts on hosted changes (ops go-ahead first).
# Do NOT include §D versions in either list.
# Reverted list = §B duplicate clocks + §C clocks (incl. both lga15 stamps).
# Applied list = §C repo prefixes only (incl. 20261113242000). Do not re-applied §B keep-rows.
set -euo pipefail
supabase migration repair --remote --yes --status reverted \
  20261113232311 20261113232318 \
  20261113213707 20261113215853 \
  20261113162610 20261113164630 \
  20261113195835 20261113201805 \
  20261113203316 20261113204421 20261113205730 \
  20261113212113 20261113213318 \
  20261113213530 20261113215737 \
&& supabase migration repair --remote --yes --status applied \
  20261113160000 20261113180000 \
  20261113200000 20261113203000 \
  20261113210000 20261113213000 20261113220000 \
  20261113230000 20261113233000 \
  20261113242000 \
  20261113252000 20261113252100
```

**Verify:** MCP `list_migrations` — every portal file under `supabase/migrations/` has a matching version; §B duplicate names gone; §D exceptions remain. Only then is `db push` safe for **new** migrations.

**WS-I status:** **Verified matching on 2026-11-18** against `master` @ `90a0239` — production's 59 recorded versions equal the 59 repo file prefixes. Who ran the repair, and when, is not recorded. §E is closed: **do not run it again.** (Previous status, 2026-11-14 / PR #31: docs inventory + plan done, live repair not executed.) The deferred-work repair row is marked done.
