# ADR-0007: Staging data and seeding

**Status:** Accepted — owner decision, 2026-11-18

## Context

Supabase branches start empty; production data is never copied. Staging needs believable
data and one working account per role. The repo already has a demo world in
`tests/emulator/seed.ts` used by the test suite and `pnpm dev:local`.

Supabase can run a `seed.sql` on a branch, but only once, when the branch is created — and
creating login users in SQL means committing a password hash, which a public repo rules
out.

## Options

1. **Scripted synthetic seed (chosen).** A script creates the demo world and the demo
   users through the Supabase admin API, with the password supplied from a secret. Run on
   demand from GitHub Actions.
2. **`seed.sql` run by Supabase.** Automatic at branch creation, but cannot hold
   credentials and does not re-run.
3. **Anonymised copy of production.** Most realistic, but needs a scrubbing pipeline and
   carries a real risk of leaking tenant data into a sandbox where everyone is admin.

## Decision

Option 1.

- **One demo world.** Extend `tests/emulator/seed.ts` so the same definition seeds the
  emulator, local dev, and staging. It gains what a convincing demo needs: active and
  ended leases, rent charges and payments across several months, maintenance requests in
  every status with photos and comments, property documents, and a pending account in the
  approval queue.
- **Four primary personas** behind the buttons — admin, landlord, tenant, maintenance —
  plus the existing secondary ones (second tenant, second worker, pending user) for
  permission-boundary testing.
- **"Reset staging data" workflow.** A manually triggered GitHub Action truncates the
  domain tables, deletes the demo users, and re-seeds. It also runs once after the
  database is rebuilt. A nightly schedule is optional.
- **Hard stop on production.** The script refuses to run unless the target project ref is
  the staging ref.
- **No production data in staging, ever.** That is what makes one-click admin acceptable.

Secrets (GitHub Actions, never in the repo): staging service-role key, staging database
URL, demo password. The same demo password is entered in Vercel's staging variables.

## Consequences

- Testers can break data freely; one click restores it.
- Rotating the demo password is: change the secret in GitHub and Vercel, run the reset,
  redeploy staging.
- Staging will not reproduce oddities that exist only in real data. Data-shape risks in a
  migration are covered by the checks in [ADR-0004](0004-database-promotion.md), not by
  copying production.
- Uploaded files are not seeded by SQL. The script uploads a few sample photos and
  documents to staging storage so those screens are not empty.
