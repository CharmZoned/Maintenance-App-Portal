# Staging environment — build plan

**Status:** Phase 1 built on branch `claude/amazing-pasteur-tzcs1d`, awaiting merge into `staging` and owner action O3 · 2026-11-18
**Design and reasoning:** [`DESIGN_PLAN.md`](DESIGN_PLAN.md) · **Decisions:** [`docs/adr/`](../adr/README.md)

This is the ordered list of work to turn the approved design into a running staging
environment and a staging → production release path. Nothing here has been started.

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
- The `Supabase Preview` check passes on the PR that adds `config.toml`.

### Production settings to confirm

These live only in the Supabase dashboard for production and cannot be read by an agent.
The owner checks them once (Authentication → Sign In / Providers, URL Configuration,
Hooks, Emails) so staging can be set to match. None blocks Phase 2.

- Is the custom access token hook enabled?
- Is "Confirm email" on, and are sign-ups allowed?
- Minimum password length, required characters, leaked-password protection.
- Site URL and the redirect allow-list.
- Custom SMTP or Supabase's built-in mailer.

## Phase 2 — Staging database

**Goal:** a staging database built entirely from the repo, holding the demo world.

| # | Who | Task |
|---|---|---|
| 2.1 | Agent | Announce, then delete the broken branch `ffczsojnowxthntnliac`. This destroys its seven `phase4-*` accounts and cannot be undone (approved in [ADR-0003](../adr/0003-staging-database.md)). |
| 2.2 | Agent | Create a persistent Supabase branch `staging` linked to git `staging`. Put its project ref in `[remotes.staging]` in `config.toml` and in the ops doc, then push to `staging` — Supabase applies `config.toml` to a persistent branch only once a `[remotes]` block names it. |
| 2.3 | Agent | Confirm all 59 migrations applied from zero and the recorded versions equal the repo filenames. Fix any failure with a new forward migration, never by editing an applied file. |
| 2.4 | Agent | Verify what migrations do not carry: email confirmation and the 8-character minimum are enforced; a signed-in JWT contains `user_role`; the four storage buckets exist; the realtime publication exists. Check whether the three on-hold Edge Functions were deployed to the branch and remove them if so. |
| 2.5 | Agent | Run Supabase security and performance advisors on staging and compare with production. |
| 2.6 | Agent | Seed: split `tests/emulator/seed.ts` into one world definition with two targets (emulator, real Supabase). Extend the world: active and ended leases, several months of rent charges and payments, maintenance requests in every status with photos and comments, property documents, a pending account. Add `scripts/staging/seed.ts`, which aborts unless the target is the staging project ref and creates demo users already email-confirmed (the built-in mailer cannot deliver to demo addresses). |
| 2.7 | Owner | Add secrets: `STAGING_SUPABASE_URL`, `STAGING_SERVICE_ROLE_KEY`, `STAGING_DB_URL`, `STAGING_DEMO_PASSWORD` (a long random value; it is reused in Vercel in Phase 3). |
| 2.8 | Agent | Add the manually triggered "Reset staging data" workflow: clear domain tables, delete demo users, re-seed. Run it once. |

**Checks**

- Staging's migration list is identical to `supabase/migrations/`.
- The reset workflow finishes green, twice in a row (it must be repeatable).
- Each of the four demo accounts can sign in through the API and sees only what its role
  allows — the existing R7 permission tests are the reference.
- `pnpm test` still passes: the emulator uses the same world definition.

## Phase 3 — Staging site

**Goal:** the staging site is live behind the Vercel login, with the four buttons.

| # | Who | Task |
|---|---|---|
| 3.1 | Owner | Import the repo into Vercel (framework: Vite, output `dist`). Vercel builds `master` once on import; with no production variables set, that build only shows the app's "missing configuration" notice and cannot reach any database. It is configured in Phase 4. |
| 3.2 | Owner + Agent | Create the `staging` custom environment tracking the `staging` branch. Set `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_APP_ENV=staging`, `VITE_DEMO_PASSWORD` for staging and preview. Leave `VITE_DEMO_PASSWORD` unset for production. |
| 3.3 | Owner | Turn on Vercel Authentication (Standard Protection). Create a protection-bypass token for automation and store it as a GitHub secret. |
| 3.4 | Agent | Add the staging and preview addresses to the staging auth redirect list in `[remotes.staging.auth]`. |
| 3.5 | Agent | Build the quick sign-in card: four buttons, lazy-loaded only outside production, on the login page above the normal form. |
| 3.6 | Agent | Build `/login?as=<role>`, the staging ribbon with build id and role switcher, the `[STAGING]` tab title, alternate favicon, and `noindex`. Previews show `PREVIEW · <branch>`. |
| 3.7 | Agent | Wire the same card into `pnpm dev:local` so it is testable without staging. |
| 3.8 | Agent | Tests: unit tests for the environment guard; a browser test that clicks each button on the emulator and lands on the right home; a CI step that builds for production and fails if `data-quick-signin` appears in `dist/`. |

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
| 4.5 | Agent | Rehearsal release: one harmless additive migration and one visible UI change, taken through `staging` → test → release PR → `master`. |
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
