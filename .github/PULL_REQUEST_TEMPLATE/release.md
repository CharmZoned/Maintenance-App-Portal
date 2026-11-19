<!--
Release pull request: staging -> main. Merging this ships to production.
Open it with ?template=release.md on the compare URL.
Merge with a MERGE COMMIT — never squash or rebase.
-->

## Release summary

What users will notice:

## Included pull requests

-

## Database migrations in this release

List each new file under `supabase/migrations/`, or write "None".

-

- [ ] Every migration works with the UI that is live in production right now (add first, remove in a later release)
- [ ] Any migration that rewrites or deletes data states its rollback below and was rehearsed on staging

## Tested on staging

- [ ] Admin
- [ ] Landlord
- [ ] Tenant
- [ ] Maintenance

Tested by:

## Rollback

- UI: Vercel instant rollback to the previous production deployment.
- Database:

## After merge

- [ ] Production migration list gained exactly the versions listed above
- [ ] Production site shows the change
- [ ] Sign-in works on production
