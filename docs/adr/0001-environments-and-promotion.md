# ADR-0001: Environments and promotion flow

**Status:** Accepted — owner decision, 2026-11-18

## Context

Every pull request merges straight into `master`, and the production database follows
`master`. There is no place to try a change with the real UI and a real database before it
is production. The owner wants: change on staging, test, approve, then push to production.

## Options

1. **`staging` branch → `master`.** Work targets `staging`, which auto-deploys the staging
   site and database. Production ships through one release PR from `staging` to `master`.
2. **`master` is staging, new `production` branch.** Agents keep targeting `master`.
   Requires re-pointing Supabase production at a new branch.
3. **One branch plus an approve button.** `master` deploys to staging; a manual approval
   in GitHub Actions ships the same commit to production. No second branch, but a custom
   pipeline replaces Supabase's built-in one.

## Decision

Option 1. Three environments: local, staging, production.

| Environment | Git branch | Deploys on |
|---|---|---|
| Local | any | manual (`pnpm dev:local`) |
| Staging | `staging` | merge to `staging` |
| Production | `master` | merge of a release PR into `master` |

Rules:

- `staging` becomes the repository default branch, so agent and human PRs target it
  without being told.
- `master` accepts merges **only** from `staging`. A CI check fails any other PR into
  `master`.
- Release PRs are merged with a **merge commit**, never squash or rebase. Squashing makes
  the two branches diverge and every later release conflicts.
- Hotfixes take the same road: PR to `staging`, then an immediate release PR. If a fix
  ever lands on `master` directly, it is merged back to `staging` the same day.
- Both branches are protected: PR required, CI required, Supabase migration check required.

## Consequences

- Names line up across tools: git `staging` ↔ Supabase `staging` ↔ staging site; git
  `master` ↔ Supabase production ↔ production site. Supabase production already follows
  `master`, so nothing is re-pointed.
- Open agent branches that target `master` must be retargeted to `staging` at cutover.
- CI (`.github/workflows/ci.yml`) must also run on `staging`.
- The release PR is the single approval point for production, for UI and database alike.
- Two long-lived branches need the merge-commit discipline above; it is enforced by
  branch settings, not by memory.
