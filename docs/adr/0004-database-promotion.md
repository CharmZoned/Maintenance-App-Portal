# ADR-0004: Promoting database changes to production

**Status:** Proposed

## Context

Today a migration file is merged to `master`, then someone applies the SQL to production
by hand (Supabase MCP or the SQL editor). That manual step is what stamped mismatched
version numbers into production's history and produced the repair work in
`docs/ops/schema-migrations.md`.

The Supabase GitHub integration is already connected and production already follows
`master`. Its "deploy to production" option applies new migrations, declared Edge
Functions, and declared storage buckets when `master` changes. It does not apply API or
Auth settings, and it never runs seed files against production.

## Options

1. **Automatic on release.** Enable deploy-to-production. Merging the release PR applies
   pending migrations to production. Approval of the release PR is the gate.
2. **Manual after release.** Keep applying by hand after merge, using the CLI so version
   numbers match.
3. **Approval step in CI.** A GitHub Actions job runs `supabase db push` against
   production behind a required-reviewer environment.

| | 1. Automatic | 2. Manual | 3. CI approval |
|---|---|---|---|
| Version drift possible | No | Yes, if a step is skipped or done via MCP | No |
| Human gate | Release PR approval | Whoever runs the command | PR approval plus a second click |
| Things to build | None | None | Workflow, secrets, runbook |
| Production DB credentials outside Supabase | No | On someone's machine | In GitHub secrets |

## Decision (recommended)

Option 1, with these rules:

- **Migrations only.** No schema change reaches staging or production through the
  dashboard, SQL editor, or MCP `apply_migration`. The existing "file first" rule becomes
  "file only".
- **Forward only.** An applied migration file is never edited. Mistakes are corrected by a
  new migration.
- **Expand, then contract.** During a release the database and the site update a minute or
  two apart. Every migration must work with the UI that is already live: add first, switch
  the UI, remove in a later release.
- **The migration check is required.** The Supabase check on a PR runs its migrations on a
  throwaway branch. Make it a required status check on `staging` and `master`.
- **Risky migrations get extra care.** Anything that rewrites or deletes data states its
  rollback in the PR, is rehearsed on staging against realistic volume, and is preceded by
  an on-demand production backup.
- **Reference data ships as a migration.** If production needs a row, it is an idempotent
  `insert … on conflict do nothing` in a migration, reviewed like any other change.

## Consequences

- "Push to prod" is one action for both UI and database: approve the release PR.
- A bad migration reaches production the moment the release merges. The defences are the
  staging run, the required check, and the expand/contract rule — not a later manual step.
- Database rollback means a forward fix or a restore from backup. Production has daily
  backups on the Pro plan; point-in-time recovery is a paid add-on worth revisiting when
  real payments flow through the portal.
- Edge Functions must be declared in `config.toml` to deploy. Until the Stripe hold lifts
  they can stay undeclared, which keeps them off production.
- If the production migration fails while the Vercel deploy succeeds, the new UI may run
  against the old schema. The expand/contract rule makes that safe; Phase 5 can add staged
  production deploys in Vercel (build, then promote after the database step is green).
