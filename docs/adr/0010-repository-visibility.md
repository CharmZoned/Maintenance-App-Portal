# ADR-0010: Repository visibility

**Status:** Proposed

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

1. **Make it private (recommended).** One setting. CI, Vercel, and Supabase integrations
   keep working once their GitHub apps are granted access.
2. **Stay public, deliberately.** Keep the open-source lineage visible. Accept the
   exposure and keep every secret out of the repo, as this plan already does.
3. **Split.** Publish a sanitised template; keep the Landlord Gopher product private.
   Most work, only worthwhile if open-sourcing is a goal.

## Decision (recommended)

Option 1, unless there is a reason to stay public that is not visible in the repo.

## Consequences

- Check the GitHub plan before switching. On the free plan, private repositories get a
  monthly Actions-minutes allowance and lose branch protection, which
  [ADR-0001](0001-environments-and-promotion.md) depends on. Going private may therefore
  mean a paid GitHub plan.
- The staging design in this plan is safe either way. It was written for the public case,
  so nothing needs to change if the repo stays public.
- Going private does not un-publish history already cloned or indexed. Treat anything
  that was ever committed as known.
- If it stays public: add secret scanning and push protection in the repository settings,
  and keep the fork-PR rules in [ADR-0008](0008-pr-previews.md).
