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

## Staging recommendation (WS-I / hygiene #8)

Today this org uses a single shared project for portal + website Auth (`bgjkjtfgrfiszbzatriq`). That makes live-only experiments costly.

### Proposal (not created yet)

| Item | Value |
|------|-------|
| **Preferred shape** | Supabase **development branch** named `staging` on project `bgjkjtfgrfiszbzatriq` (fresh DB; production data does **not** copy) |
| **Alt** | Separate non-prod Supabase project in org `rivvzbmemflrcziliczd` (heavier; only if branching is unavailable) |
| **Quoted cost (2026-11-14)** | Branch create ≈ **$0.01344 / hour** (`get_cost` type=`branch`) — **owner must confirm before create** |
| **WS-I status** | **Paused** — `create_branch` was attempted and **did not succeed** (tool required cost confirmation ID). No staging branch exists (`list_branches` empty). No further paid create until owner OK. |
| **Until staging exists** | Treat live as production: file-in-repo + PR before any DDL; prefer history repair (`migration repair`) over re-applying SQL |

After owner confirms cost: `create_branch` name=`staging` with `confirm_cost_id` → document resulting `project_ref` here → dry-run new migrations on the branch before live.

Portal hosting / URL / `NEXT_PUBLIC_PORTAL_URL` are **out of WS-I** (deferred until owner provides the link).

## Drift check (quick)

Compare Supabase MCP `list_migrations` to `supabase/migrations/` on `master` on **both**:

| Check | Drift if… |
|-------|-----------|
| **Name** | Live name has no matching `*_name.sql` on `master` (and no open PR owning it) |
| **Version** | Live version ≠ repo file prefix for the same logical migration |

Name-only checks miss MCP clock stamps. Track mismatches in `docs/deferred-work.md` until repaired.

Baseline pre-Phase-1 migrations may exist only on the remote history; portal phase work starts at `20261113160000_*`. New work must always land in this folder. Pre-repo maintenance ACL still live on prod is summarized in [`live-maintenance-acl-baseline.md`](./live-maintenance-acl-baseline.md).

## Migration history inventory + repair plan (hygiene #8)

**Snapshotted:** 2026-11-14 via MCP `list_migrations` / `schema_migrations` on `bgjkjtfgrfiszbzatriq` vs `supabase/migrations/` on `master` @ `33424b7`.  
**Scope:** History alignment only (`supabase migration repair`). **No DDL.** Do not run while another migration/RLS PR is open.

### A. Already aligned (repo prefix = live version)

| Version | Name |
|---------|------|
| `20261113193000` | `phase1_5_force_rls_payment_rpc` |
| `20261113241000` | `phase_lga18_landlord_approve_access` |
| `20261114010000` | `fix_authenticated_portfolio_and_mr_grants` |
| `20261114020000` | `fix_user_roles_pending_and_set_account_status` |
| `20261114030000` | `harden_landlord_helpers_and_mr_notes` |
| `20261114040000` | `property_documents_storage_path_bind` |

### B. True duplicate live entries (same logical migration stamped twice)

These are the hygiene **#8** duplicates: MCP/early apply left a clock (or alt) stamp **and** a later matching (or second) stamp.

| Keep (repo / canonical) | Revert (duplicate live stamp) | Notes |
|-------------------------|-------------------------------|-------|
| `20261114010000` `fix_authenticated_portfolio_and_mr_grants` | `20261113232311` same name | Early Wave-1 apply + later matching stamp |
| `20261114020000` `fix_user_roles_pending_and_set_account_status` | `20261113232318` same name | Same pattern |
| `20261113242000` `lga15_maintenance_status_category_checks` (**mark applied** — not on live yet) | `20261113213707` `lga15_maintenance_status_category_checks` **and** `20261113215853` `lga15_maintenance_status_category_checks_241000` | Two live stamps; neither equals repo prefix |

### C. MCP clock stamp ≠ repo prefix (SQL already applied; versions disagree)

Revert the live clock version, then mark the **repo** prefix as applied (history only — do **not** re-run SQL).

| Live clock version | Live name | Repo file prefix to mark applied |
|--------------------|-----------|----------------------------------|
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

### D. Permanent / documented live-only exceptions (do **not** “repair away”)

| Live version | Name | Why keep |
|--------------|------|----------|
| `20261010152511` … `20261109204421` | Pre-portal baseline (intake → photos/comments) | Expected remote-only history; see [`live-maintenance-acl-baseline.md`](./live-maintenance-acl-baseline.md) |
| `20261113214011` | `phase_acl_mr_update_uses_helper` | Intermediate live ACL step; superseded in effect by later `phase_acl_mr_update_new_row_check` / repo `20261113252100_*` — leave stamped; do not re-apply |
| `20261114002715` | `public_unit_listings` | Website/listings path; not in portal `supabase/migrations/` |
| `20261114002848` | `fix_listing_photo_path_check` | Same; website-adjacent |

If a secondary env must match listings DDL, capture those two into a dedicated repo (website or portal) migration PR first — still no live-only DDL.

### E. Repair command sequence (run after owner go-ahead + CLI linked)

Requires `supabase` CLI logged in / `SUPABASE_ACCESS_TOKEN`, linked to `bgjkjtfgrfiszbzatriq`. **History only** — no SQL files executed.

```bash
# From repo root, linked to project bgjkjtfgrfiszbzatriq
# Must target remote history (--remote). --yes skips prompts for hosted changes.
# 1) Drop true duplicates / clock stamps (B + C + lga15 pair)
supabase migration repair --remote --yes --status reverted \
  20261113232311 20261113232318 \
  20261113213707 20261113215853 \
  20261113162610 20261113164630 \
  20261113195835 20261113201805 \
  20261113203316 20261113204421 20261113205730 \
  20261113212113 20261113213318 \
  20261113213530 20261113215737

# 2) Mark repo prefixes as applied (C + lga15 canonical)
supabase migration repair --remote --yes --status applied \
  20261113160000 20261113180000 \
  20261113200000 20261113203000 \
  20261113210000 20261113213000 20261113220000 \
  20261113230000 20261113233000 \
  20261113242000 \
  20261113252000 20261113252100
```

**Verify:** MCP `list_migrations` — every portal file under `supabase/migrations/` has a matching version; duplicate names from §B gone; §D exceptions remain.

**WS-I status:** Inventory + plan documented this PR. **Live repair not executed** in this pass (no CLI token in agent env; serialize with any open mig/RLS PR; prefer after staging exists or with explicit ops go-ahead). Update deferred-work when repair is run.
