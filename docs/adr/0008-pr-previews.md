# ADR-0008: Per-pull-request preview sites

**Status:** Accepted — owner decision, 2026-11-18: previews on the staging database

## Context

Most changes arrive as pull requests from AI agents, many in parallel. Vercel can build a
preview site for every PR. The question is which database a preview talks to, and whether
the cost and complexity are worth it now.

## Options

| | What you get | Cost and catches |
|---|---|---|
| **A. Previews on the staging database** | A link on every PR showing that branch's UI, with the one-click buttons | A PR that changes the schema cannot be previewed properly until it merges to `staging` |
| **B. Previews with a database per PR** | Full isolation, schema changes included | A Supabase branch per PR at ~$0.32/day each, outside the spend cap; each needs seeding; many agent branches at once |
| **C. No previews** | Nothing to manage | UI is first seen after merging to `staging` |

## Decision

**Option A** now. Revisit B if schema-changing PRs become the common case.

- Preview deployments use staging's Supabase URL and key, `VITE_APP_ENV=staging`, and the
  same gate as staging ([ADR-0005](0005-staging-access-gate.md)).
- The ribbon on a preview reads `PREVIEW · <branch>` so it is not confused with staging.
- The existing Supabase check on PRs still validates that migrations apply cleanly.
- Schema-changing PRs are tested after merge to `staging`, before any release.

## Consequences

- The owner can look at an agent's work before it lands on staging, for free.
- Previews share staging's data, so two people testing at once see each other's changes.
- While the repo is still public ([ADR-0010](0010-repository-visibility.md)), a pull
  request from a fork must never receive the demo password. Keep Vercel's default of requiring team approval for fork deployments, and
  scope `VITE_DEMO_PASSWORD` to team-authored branches.
