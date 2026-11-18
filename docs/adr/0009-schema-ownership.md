# ADR-0009: Schema ownership across portal and website

**Status:** Proposed

## Context

The portal and the Landlord Gopher marketing website share one production database. The
website repository has applied its own migrations to production (listings, inquiries).
The portal repo later had to add five "history parity" copies of those files so
Supabase's checks would pass, and the existing staging branch still records four of them
under the website's version numbers ([ADR-0003](0003-staging-database.md)).

Two repositories writing schema to one database guarantees the drift keeps coming back,
and it would break the staging → production flow in
[ADR-0001](0001-environments-and-promotion.md): a website migration applied directly to
production skips staging entirely.

## Options

1. **This repo owns all schema (recommended).** `supabase/migrations/` here is the only
   source. The website repo carries no migrations and applies none.
2. **Split by schema.** Website tables move to their own Postgres schema with their own
   migration history. Clean separation, but a real migration project on live tables.
3. **Separate databases.** The website gets its own Supabase project. Cleanest long term,
   but the website reads portal units for listings, so it needs an API or sync between
   the two.

## Decision (recommended)

Option 1.

- Any table, view, policy, or function the website needs is added by a PR to this repo
  and travels staging → production like everything else.
- The website repo removes its `supabase/migrations/` folder, or keeps it read-only as
  documentation, and its deploy pipeline never touches the schema.
- The Supabase GitHub integration stays connected to this repo only.
- Once staging is stable, the website gets a staging deployment pointed at the staging
  database so listing and inquiry changes can be tested end to end.

## Consequences

- One migration history, so the Supabase checks stay green without parity files.
- Website changes that need schema work require a PR here first. That is a small
  coordination cost paid deliberately.
- Options 2 and 3 remain open later; nothing here blocks them.
- Needs the website repo's maintainers to agree, and a matching note in that repo.
