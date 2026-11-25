# Staging environment — build plan

**Status:** Phase 1 merged (2026-11-19). Phase 2 in progress: new staging database created (`gzwcegtwzzhtstgzphaw`) but empty; seed, reset and rebuild tooling built; waiting on the owner steps listed under Phase 2 · 2026-11-19
**Design and reasoning:** [`DESIGN_PLAN.md`](DESIGN_PLAN.md) · **Decisions:** [`docs/adr/`](../adr/README.md)

This is the ordered list of work to turn the approved design into a running staging
environment and a staging → production release path. Tasks marked ✅ are built; a phase
is complete only when its checks pass. Do not redo a ✅ task.

## How to read this

- **Agent** tasks are code and configuration changes delivered as pull requests.
- **Owner** tasks are clicks only the account owner can make (GitHub, Vercel, Supabase
  settings, secrets, DNS). Each one says what it unblocks.
- Phases run in order. Production is not touched until Phase 4.
- Every phase ends with checks that must pass before the next begins.

## Owner checklist

Everything that needs you, in the order it is needed.

| # | Action | Where | Unblocks |
|---|---|---|---|
| O1 | Upgrade the GitHub plan, **then** switch the repo to private. Re-grant access to the Vercel, Supabase, Cursor, and Claude GitHub apps if any lose it. | GitHub → Settings | Safe from the start; not a blocker for Phase 1 |
| O3 | Make `staging` the default branch; add protection rules for `staging` and `master` (see 1.2). The branch exists as of 2026-11-18. | GitHub → Settings → Branches / Rules | End of Phase 1 |
| O4 | Add four repository secrets (see 2.7). | GitHub → Settings → Secrets → Actions | Seeding in Phase 2 |
| O5 | Import the repo into the Vercel Pro team; turn on Vercel Authentication. | Vercel | Phase 3 |
| O6 | Invite testers to the Vercel team as Viewers. | Vercel → Team → Members | Testers can open staging |
| O7 | Choose production and staging hostnames; add the DNS records Vercel asks for. | DNS provider | Phase 4 |
| O8 | Turn on "Deploy to production" in the Supabase GitHub integration. | Supabase → Project Settings → Integrations | Phase 4 |
| O9 | Approve the first release pull request. | GitHub | Production goes live |
| O10 | Decide whether to delete the stale `main` branch. | Reply | Housekeeping only |

---

## Phase 1 — Repo foundations

**Goal:** the repo knows about environments and has a `staging` branch with the same
safeguards as `master`. No effect on production.

| # | Who | Task |
|---|---|---|
| 1.1 | Agent | Create `staging` from the tip of `master`. **Done 2026-11-18** (`90a0239`). |
| 1.2 | Owner | Default branch → `staging`. Protection on both branches: pull request required; required checks `typecheck / build / test` and `Supabase Preview`. On `master` only: also require `release source`, and set allowed merge method = merge commit. |
| 1.3 ✅ | Agent | CI: run on `staging` as well as `master`. Add a `release source` job that fails any PR into `master` whose source branch is not `staging`. Stop skipping docs-only changes, so required checks always report. |
| 1.4 ✅ | Agent | Add `supabase/config.toml`: project id, Postgres version, email confirmation, password minimum, local redirect list, the `custom_access_token_hook`. No `[remotes.production]` block — production auth settings stay untouched. Validated with `supabase config validate`. Production's own Auth settings cannot be read from here; see [Production settings to confirm](#production-settings-to-confirm). |
| 1.5 ✅ | Agent | Add `src/client/lib/env.ts` (`APP_ENV`, `isProduction`, production-project guard), declare `VITE_APP_ENV` and `VITE_DEMO_PASSWORD` in `vite-env.d.ts`, document them in `.env.example`. |
| 1.6 ✅ | Agent | Add `vercel.json` with a catch-all rewrite to `/index.html` so deep links survive a refresh. |
| 1.7 ✅ | Agent | Add a default PR template and a release PR template (what is included, migrations listed, tested by, rollback note). |
| 1.8 ✅ | Agent | Docs: replace the stale "staging does not exist" and "repair pending" sections of `docs/ops/schema-migrations.md` with the real state; update the hosting and staging rows in `docs/deferred-work.md`; point `docs/IMPLEMENTATION_PLAN.md` and the README at this plan. |

**Checks**

- CI is green on `staging`.
- A test PR from any branch other than `staging` into `master` is blocked.
- `pnpm build` produces a working app with no environment variable other than the two
  Supabase ones (existing behaviour unchanged).
- The `Supabase Preview` check does not fail on the PR that adds `config.toml` (it reported "skipped" — see Plan revisions).

### Production settings to confirm

These live only in the Supabase dashboard for production and cannot be read by an agent.
The owner checks them once (Authentication → Sign In / Providers, URL Configuration,
Hooks, Emails) so staging can be set to match. None blocks Phase 2.

- Is the custom access token hook enabled?
- Is "Confirm email" on, and are sign-ups allowed?
- Minimum password length, required characters, leaked-password protection.
- Site URL and the redirect allow-list.
- Custom SMTP or Supabase's built-in mailer.

## Plan revisions — 2026-11-19

Found while reviewing the repo and both databases before starting Phase 2.

1. **The `Supabase Preview` check validates nothing today.** It reports "skipped" on every
   pull request, including ones that add migrations (#78, #81, #82). A skipped check counts
   as passing, so requiring it does no harm, but it is not the safety net the plan assumed.
   The repo's migrations have therefore never been run from zero on real Supabase — only
   on the in-repo emulator. Consequences:
   - The staging database is the first real test of the migrations, and after Phase 2 it
     is the gate before production: a migration merged to `staging` runs there first.
   - Optional owner setting, not required: turning on **Automatic branching** in the
     Supabase GitHub integration makes the check real (a short-lived database per pull
     request, billed by the hour). [ADR-0008](../adr/0008-pr-previews.md) chose not to do
     this for now.
2. **A branch copied from production's history would be incomplete.** 24 of production's 59
   migration records hold no SQL (they were stamped by the history repair). Any path that
   builds a branch from production's records, rather than from the files in this repo,
   would silently miss those 24 — the likely cause of the old branch's failure. Phase 2
   therefore adds a "rebuild from the repo" step (2.3) that does not depend on how
   Supabase creates the branch.
3. **`staging` is now two migrations ahead of production** (61 files vs. 59 applied) after
   the worker job pool work (#82). That is the intended state — changes wait on `staging`
   for a release — but it means the first release is not a harmless rehearsal: it carries
   a 1,274-line migration that replaces `MaintenanceRequests.cost` with two price tables.
   Task 4.5 is changed accordingly.
4. **The demo world must cover the job pool.** A worker with no services listed sees no
   pooled jobs, so the Maintenance persona is seeded with services, a pooled job, and both
   prices (2.6).

## Phase 2 — Staging database

**Goal:** a staging database built entirely from the repo, holding the demo world.

| # | Who | Task |
|---|---|---|
| 2.1 ✅ | Agent | Announce, then delete the broken branch `ffczsojnowxthntnliac`. **Done 2026-11-19**; its seven `phase4-*` accounts are gone (approved in [ADR-0003](../adr/0003-staging-database.md)). |
| 2.2 | Owner + Agent | Create a persistent Supabase branch `staging` linked to git `staging`. **Created 2026-11-19: project ref `gzwcegtwzzhtstgzphaw`**, recorded in `[remotes.staging]` in `config.toml`. It came up empty (no tables, no migrations, status `MIGRATIONS_FAILED`), as revision 2 predicted, and it is not yet persistent or linked to git — both are owner dashboard settings (see the steps below). |
| 2.3 | Agent | Rebuild from the repo and verify. Add a manually triggered "Rebuild staging database" workflow that drops and re-applies every file in `supabase/migrations/` against staging, guarded against production like the reset workflow. Run it, then confirm the recorded versions equal the repo filenames (61 as of 2026-11-19) and the schema matches the emulator's. Fix any failure with a new forward migration, never by editing an applied file. **Workflow built 2026-11-19** (`staging-rebuild.yml`); not yet run — it needs the database and `STAGING_DB_URL`. |
| 2.4 | Agent | Verify what migrations do not carry: email confirmation and the 8-character minimum are enforced; a signed-in JWT contains `user_role`; the four storage buckets exist; the realtime publication exists. Check whether the three on-hold Edge Functions were deployed to the branch and remove them if so. |
| 2.5 | Agent | Run Supabase security and performance advisors on staging and compare with production. |
| 2.6 ✅ | Agent | Seed: split `tests/emulator/seed.ts` into one world definition with two targets (emulator, real Supabase). Extend the world: active and ended leases, several months of rent charges and payments, maintenance requests in every status with photos and comments, property documents, a pending account. Add `scripts/staging/seed.ts`, which aborts unless the target is the staging project ref and creates demo users already email-confirmed (the built-in mailer cannot deliver to demo addresses). **Built 2026-11-19**; verified on the emulator and a local Postgres 16, not yet on Supabase. |
| 2.7 | Owner | Add secrets: `STAGING_SUPABASE_URL`, `STAGING_SERVICE_ROLE_KEY`, `STAGING_DB_URL` (the **session pooler** connection string), `STAGING_DEMO_PASSWORD` (a random value of 16+ characters; it is reused in Vercel in Phase 3). Optional: `STAGING_ANON_KEY` turns on the sign-in check after seeding. Both workflows only appear in the Actions tab once their files are on the default branch (`staging`). |
| 2.8 | Agent | Add the manually triggered "Reset staging data" workflow: clear domain tables, delete demo users, re-seed. Run it once. **Workflow built 2026-11-19** (`staging-reset.yml`); not yet run — it needs the database and the secrets. |

### Owner steps to finish Phase 2

In this order. The agent verifies the database after steps 4 and 5.

1. **Merge the Phase 2 pull request into `staging`.** The two workflows below only appear
   in GitHub's Actions tab once their files are on the default branch.
2. **Supabase dashboard → Manage Branches → `staging`:** make the branch **persistent**, and
   link it to the GitHub branch `staging`. Until it is persistent Supabase may pause or
   delete it; until it is linked, merges into git `staging` do not reach it.
3. **Add repository secrets** (GitHub → Settings → Secrets and variables → Actions). In the
   Supabase dashboard, switch to the `staging` branch first — each branch has its own keys.

   | Secret | Value |
   |---|---|
   | `STAGING_SUPABASE_URL` | `https://gzwcegtwzzhtstgzphaw.supabase.co` |
   | `STAGING_SERVICE_ROLE_KEY` | Settings → API Keys → the `service_role` (or secret) key |
   | `STAGING_DB_URL` | Connect → **Session pooler** → copy the URI and replace `[YOUR-PASSWORD]` with the database password. Not the direct string, and not port 6543. |
   | `STAGING_DEMO_PASSWORD` | A new random password, 16+ characters, letters and digits. Keep a copy: it is reused in Vercel in Phase 3. |
   | `STAGING_ANON_KEY` (optional) | Settings → API Keys → the publishable key. Turns on the sign-in check after seeding. |

4. **Actions → "Rebuild staging database" → Run workflow** on branch `staging`, typing
   `gzwcegtwzzhtstgzphaw` to confirm. This applies every migration file from zero.
5. **Actions → "Reset staging data" → Run workflow** the same way. This loads the demo world.

If step 4 fails on a migration, that is a real finding: the file works on the emulator but
not on Supabase. It is fixed with a new forward migration, then step 4 is run again.

**Checks**

- Staging's migration list is identical to `supabase/migrations/`, and its tables, functions and policies match what the emulator builds from the same files.
- The reset workflow finishes green, twice in a row (it must be repeatable).
- Each of the four demo accounts can sign in through the API and sees only what its role
  allows — the existing R7 permission tests are the reference.
- `pnpm test` still passes: the emulator uses the same world definition.

## Phase 3 — Staging site

**Goal:** the staging site is live behind the Vercel login, with the four buttons.

**Click-through script for testers:** [`CLICK_THROUGH.md`](CLICK_THROUGH.md)

| # | Who | Task |
|---|---|---|
| 3.1 | Owner | Import the repo into Vercel (framework: Vite, output `dist`). Vercel builds `main` once on import; with no production variables set, that build only shows the app's "missing configuration" notice and cannot reach any database. It is configured in Phase 4. |
| 3.2 | Owner + Agent | Create the `staging` custom environment tracking the `staging` branch. Set `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_APP_ENV=staging`, `VITE_DEMO_PASSWORD` for staging and preview. Leave `VITE_DEMO_PASSWORD` unset for production. |
| 3.3 | Owner | Turn on Vercel Authentication (Standard Protection). Create a protection-bypass token for automation and store it as a GitHub secret. |
| 3.4 | Agent | Add the staging and preview addresses to the staging auth redirect list in `[remotes.staging.auth]`. |
| 3.5 ✅ | Agent | Build the quick sign-in card: four buttons, lazy-loaded only outside production, on the login page below the normal form. |
| 3.6 ✅ | Agent | Build `/login?as=<role>`, the staging ribbon with build id and role switcher, the `[STAGING]` tab title, and `noindex`. Previews show `PREVIEW · <branch>`. (Alternate favicon still optional.) |
| 3.7 ✅ | Agent | Wire the same card into `pnpm dev:local` so it is testable without staging. |
| 3.8 ✅ | Agent | Tests: environment guard and demo-account unit tests; the production-bundle `data-quick-signin` CI check; and `pnpm test:smoke` (`tests/smoke/`), which clicks each quick sign-in button on the emulator, checks the landing page within three seconds (plus `?as=` and the ribbon switcher), then opens every role's main screens read-only. It runs in CI as **browser smoke (emulator)**. **Done 2026-11-24.** |

The same smoke runs against the deployed staging site from **Actions → "Smoke staging site" → Run workflow** (`staging-smoke.yml`, read-only, safe to repeat). It needs the repository variable `STAGING_SITE_URL` (or a URL typed at run time) and the secret `VERCEL_AUTOMATION_BYPASS_SECRET` (the bypass token from 3.3). Without them it ends green with a notice naming what to set.

**Checks**

- The staging address in a private window shows the Vercel login, not the app.
- A Viewer-seat tester gets through the login. If not, switch to Password Protection
  ([ADR-0005](../adr/0005-staging-access-gate.md)).
- Each button lands on its role's home within three seconds: Admin `/dashboard`, Landlord
  and Tenant `/home`, Maintenance `/maintenance`.
- A production build contains no quick sign-in code.
- A pull request gets a preview link that uses the staging database.

## Phase 4 — Production site and first release

**Goal:** production UI is live, and one approval ships UI and database together.

| # | Who | Task |
|---|---|---|
| 4.1 | Owner | Hostnames and DNS for production and staging. |
| 4.2 | Owner + Agent | Configure Vercel's production environment (production Supabase URL and key, `VITE_APP_ENV=production`). |
| 4.3 | Owner + Agent | Set production's Supabase Auth site URL and redirect list to the production hostname. This is a one-time dashboard change on production, recorded in the ops doc. |
| 4.4 | Owner | Turn on "Deploy to production" in the Supabase GitHub integration. From then on the website repo applies no migrations ([ADR-0009](../adr/0009-schema-ownership.md)). |
| 4.5 | Agent | First release. Before opening the release PR, list every migration waiting on `staging` and check each against production's live data (as of 2026-11-19: the worker job pool migrations, which move `MaintenanceRequests.cost` into the landlord price table and drop the column). Take a production backup first. Then `staging` → test → release PR → `master`. |
| 4.6 | Owner | Approve the rehearsal release PR. |
| 4.7 | Agent | Verify: production migration list gained exactly the new version; production site shows the UI change; staging and production are on the same commit. Write the release runbook from what actually happened. |
| 4.8 | Owner | Point the marketing website's portal links at the production hostname (website repo; closes roadmap #3 in `docs/deferred-work.md`). |

**Checks**

- Real users can sign in on the production hostname; sign-up confirmation and
  password-reset emails link back to it.
- The production login page shows no quick sign-in card, and `?as=admin` does nothing.
- The demo accounts do not exist in production.
- Nothing other than a release PR merge changed production during the rehearsal.

## Phase 5 — Hardening

Each item is independent; do them in any order after Phase 4.

| # | Who | Task |
|---|---|---|
| 5.1 | Agent | After every staging deploy, run a browser smoke test against staging: pass the gate with the bypass token, sign in as each role via `?as=`, load the home screen. |
| 5.2 | Agent | Daily drift check: compare migration versions in the repo, staging, and production; open an issue on any mismatch. |
| 5.3 | Agent | Tag each release (`release-YYYY-MM-DD`). |
| 5.4 | Owner + Agent | Staging deployment of the marketing website pointed at the staging database. |
| 5.5 | Agent | Optional nightly "Reset staging data". |

---

## What a normal week looks like afterwards

1. Ask an agent for a change. It opens a pull request into `staging` with a preview link.
2. Open the preview, click a role button, check the change. Merge.
3. Staging updates itself — site and database.
4. When a batch is ready, open the release pull request and approve it. Production updates
   itself — site and database.
5. If testers have made a mess of staging data, run "Reset staging data".

## Not in this plan

- Stripe and the three Edge Functions (on hold).
- Copying or anonymising production data into staging ([ADR-0007](../adr/0007-staging-data-and-seeding.md)).
- A separate database per pull request ([ADR-0008](../adr/0008-pr-previews.md)).
- Changes to the marketing website's code, other than its portal links (4.8) and its own
  staging deployment (5.4).
