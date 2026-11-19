# ADR-0003: Staging database — rebuild, repair, or separate project

**Status:** Accepted — owner decision, 2026-11-18: Option A, wipe and rebuild

## Context

`docs/ops/schema-migrations.md` says no staging database exists. One does. Inspected on
2026-11-18:

| Property | Value |
|---|---|
| Supabase branch | `staging`, project ref `ffczsojnowxthntnliac`, created 2026-11-14 |
| Last deployment | `MIGRATIONS_FAILED` |
| Persistent | **No** — it is an ephemeral preview branch, which Supabase may pause or delete |
| Linked git branch | None |
| Missing vs. production | `20261114224032_inquiry_email_controls`, `20261114233000_visibility_helpers_require_approved` |
| Version mismatches | Four migrations recorded under different version numbers than the repo files (`20261114000000`, `20261114180000`, `20261114181000`, `20261114190000`) |
| Data | Seven `phase4-*@example.test` accounts, none ever signed in; a handful of portfolio rows |

The missing `visibility_helpers_require_approved` migration is the one that makes access
helpers require an approved account. Without it, staging enforces weaker rules than
production, so a permissions test that passes on staging proves nothing.

The four version mismatches are the same class of problem the repo already fought on
production: Supabase compares version numbers, sees repo files it thinks are unapplied,
tries to run them, and fails because the objects already exist. That is the likely cause
of `MIGRATIONS_FAILED`, and it will recur on every push until the history matches.

## Options

### A. Wipe and rebuild as a persistent branch (chosen)

Delete the branch. Create a new persistent branch named `staging`, linked to git
`staging`. Supabase applies every migration in `supabase/migrations/` from zero. Seed with
the demo world ([ADR-0007](0007-staging-data-and-seeding.md)).

| Pros | Cons |
|---|---|
| History matches the repo exactly, so every future push applies cleanly | The `phase4-*` accounts and their rows are destroyed |
| Proves the repo can build the database from nothing — which is also the disaster-recovery test | New project ref and API keys (nothing uses the old ones; no site is deployed) |
| Uses Supabase's built-in pipeline: push to `staging` migrates staging, release PR migrates production | If a migration cannot run from zero, the rebuild surfaces it and it must be fixed first |
| Persistent, so it is not paused or deleted for inactivity | Branch compute is not covered by the Supabase spend cap or compute credits |
| One dashboard, one bill, about $10/month (micro compute at $0.01344/hour) | Auth settings do not copy from production; they must be declared in `config.toml` |

### B. Repair in place

Keep the branch and its data. Apply the two missing migrations by hand, then rewrite four
history rows so versions match the repo, then convert the branch to persistent and link it
to git.

| Pros | Cons |
|---|---|
| Keeps the `phase4-*` data | The data has no evident value: seven accounts, never used |
| No new keys | Hand-editing migration history is the error-prone procedure the ops doc warns about; a half-finished repair re-runs applied SQL |
| | Never proves a from-zero build works |
| | Any other hand-made difference on the branch stays hidden |
| | Still needs the persistent conversion and git link afterwards |

### C. Separate Supabase project

Abandon branching for staging. Create an independent project in the same organisation and
push migrations to it from CI.

| Pros | Cons |
|---|---|
| Strongest isolation: separate keys, settings, backups, and billing line | No built-in sync — we write and maintain the CI that pushes migrations, config, and functions to each project |
| Independent of the branching feature's limits and changes | Auth and storage settings are configured twice and can drift |
| Can test a Postgres upgrade on staging first | Loses the Supabase check that validates a PR's migrations before merge |
| Roughly the same cost (~$10/month compute) | More secrets to hold in CI (access token, database passwords) |

## Decision

**Option A.** The only thing lost is test data nobody has used. What is gained is a
staging database that is provably built from the repo and stays in step automatically.
Option C is the right move later if staging ever needs production-grade isolation — for
example, a copy of anonymised real data — and nothing in Option A blocks that.

## Progress — 2026-11-19

The broken branch was deleted on 2026-11-19. One finding changes how the rebuild is done:
24 of production's 59 migration records contain no SQL, so a branch created by copying
production's records would be missing those migrations. The new branch is therefore
rebuilt from the files in `supabase/migrations/` by a dedicated workflow, whatever
Supabase puts in it at creation.

## Consequences

- The owner has approved the wipe. It is carried out in Phase 2 of the rollout, after
  `config.toml` exists, and is announced before it runs because it cannot be undone.
- `supabase/config.toml` must exist first; otherwise the new branch comes up with
  Supabase's default Auth settings (no email confirmation, six-character passwords, no
  access-token hook) and behaves differently from production. Supabase applies the file
  to a persistent branch only once `[remotes.staging]` names that branch, so the order
  is: create the branch, record its ref in `[remotes.staging]`, push, then verify.
- Correction, 2026-11-18: an earlier draft said RLS policies read the hook's JWT claims.
  They do not; access helpers look roles up in `user_roles`. The hook is declared for
  parity with production.
- The new project ref goes into `[remotes.staging]` in `config.toml`, into Vercel's
  staging variables, and into `docs/ops/schema-migrations.md`, which is rewritten to
  describe the real state.
- Any migration that fails from zero is fixed with a new forward migration, not by editing
  an applied file.
