# ADR-0002: UI hosting on Vercel

**Status:** Accepted — owner decision, 2026-11-18. Domains still open.

## Context

The portal is a static single-page app (Vite, React, pushState routing) that talks to
Supabase directly from the browser. It is not hosted anywhere today; hosting has been
deferred in `docs/deferred-work.md`. Staging and production both need a host.

## Options

| | Vercel | Cloudflare | Netlify |
|---|---|---|---|
| Static hosting | Yes | Yes, free | Yes |
| Branch → environment mapping | Yes (custom environments) | Yes | Yes |
| Gate in front of staging | Vercel Authentication free; shared password $20/month per project | Cloudflare Access free, email allowlist | Paid plan |
| Commercial use on free tier | No — Hobby is non-commercial | Yes | Yes |
| Supabase integration | First-party | Manual env vars | Manual env vars |

## Decision

Vercel, one project connected to this repository:

- **Production** environment tracks `main`, serves the production domain.
- **Staging** custom environment tracks `staging`, serves the staging domain.
- **Preview** deployments for other branches per [ADR-0008](0008-pr-previews.md).

Build `pnpm build`, output `dist`. Add `vercel.json` with a catch-all rewrite to
`/index.html`; without it, deep links such as `/maintenance/123` return 404 on refresh.

Environment variables, set per environment in Vercel and never committed:

| Variable | Production | Staging | Preview |
|---|---|---|---|
| `VITE_SUPABASE_URL` | production project | staging branch | staging branch |
| `VITE_SUPABASE_ANON_KEY` | production key | staging key | staging key |
| `VITE_APP_ENV` | `production` | `staging` | `staging` |
| `VITE_DEMO_PASSWORD` | **unset** | set | set (team-authored only) |

Variables are entered by hand rather than through the Supabase–Vercel integration. With a
single long-lived staging branch, static values are simpler and avoid the integration's
documented sync race on preview deployments.

## Consequences

- The owner's Vercel team is already on **Pro**, which a commercial product requires.
  Viewer seats are free and unlimited. See [ADR-0005](0005-staging-access-gate.md).
- Pro includes one custom environment per project, which is exactly the staging
  environment. More cost $50/month per pack of five.
- Rollback of the UI is Vercel's instant rollback to the previous production deployment.
- Still needed from the owner: production and staging hostnames, and DNS access.
- Supabase Auth must list both site URLs in its redirect allowlist, or sign-up
  confirmation and password-reset links will bounce.
