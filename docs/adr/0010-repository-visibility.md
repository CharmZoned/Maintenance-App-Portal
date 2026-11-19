# ADR-0010: Repository visibility

**Status:** Accepted — owner decision, 2026-11-18: make the repository private

## Context

`CharmZoned/Maintenance-App-Portal` is a **public** GitHub repository (confirmed
2026-11-18: the repo page loads without signing in). It carries an MIT licence inherited
from the open-source template it started from.

What is world-readable today:

- The full database schema and every row-level-security policy for a live product that
  holds tenant, lease, and payment data.
- Ops documents naming the production Supabase project ref and describing known gaps and
  deferred security work.
- The complete history of security fixes, which doubles as a list of what used to be
  exploitable.

None of this is a credential, and RLS is meant to hold even when the schema is known. But
publishing the policies and the backlog of unfixed items makes an attacker's job easier,
and it constrains this project: staging demo credentials cannot be seeded from SQL, and
fork pull requests become a route to preview builds.

## Options

1. **Make it private (chosen).** One setting. CI, Vercel, and Supabase integrations
   keep working once their GitHub apps are granted access.
2. **Stay public, deliberately.** Keep the open-source lineage visible. Accept the
   exposure and keep every secret out of the repo, as this plan already does.
3. **Split.** Publish a sanitised template; keep the Landlord Gopher product private.
   Most work, only worthwhile if open-sourcing is a goal.

## Decision

Option 1. The GitHub account is on the free plan today; the owner will move to a paid
plan.

Order matters: **upgrade the GitHub plan first, then switch the repository to private.**
Done the other way round, branch protection is lost in between.

## Consequences

- On the free plan, private repositories lose branch protection, which
  [ADR-0001](0001-environments-and-promotion.md) depends on — hence the paid plan.
  Private repositories also draw on a monthly Actions-minutes allowance.
- After the switch, re-grant repository access to the Vercel, Supabase, Cursor, and
  Claude GitHub apps if any of them lose it.
- The staging design in this plan is safe either way. It was written for the public case,
  so nothing needs to change if the repo stays public.
- Going private does not un-publish history already cloned or indexed. Treat anything
  that was ever committed as known.
- Until the switch happens, the fork-PR rules in [ADR-0008](0008-pr-previews.md) apply.
