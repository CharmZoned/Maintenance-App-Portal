# ADR-0006: One-click role sign-in on staging

**Status:** Accepted — owner decision, 2026-11-18: Option A, behind the Vercel login

## Context

The owner wants four buttons on the staging login page — Admin, Landlord, Tenant,
Maintenance — that sign in and land on that role's screen with no password to remember.
The four roles match the `app_role` enum exactly.

Constraints:

- The repository is public: no password or hash may be committed.
- Whatever makes the buttons work must be impossible to trigger against production.
- The app is a static site with no server of its own.

## Options

### A. Demo password as a staging-only build variable (chosen)

The staging build receives `VITE_DEMO_PASSWORD` from Vercel. Each button calls the normal
`signInWithPassword` with that role's demo email. Role emails are not secret and live in
code, shared with the test seed.

- Simple: no new server code, same auth path real users take, works identically on
  `pnpm dev:local`.
- The password is readable by anyone who can load the staging bundle, so this relies on
  the site gate ([ADR-0005](0005-staging-access-gate.md)).

### B. Unlock once per browser

No password in the bundle. The first time, a tester pastes an access code (the demo
password); it is kept in that browser's storage and the buttons work from then on.

- Does not depend on the site gate or the host.
- Not quite "no passwords": one paste per device, and again after clearing site data.

### C. Server-side session minting

A function holding the service-role key issues a session for the chosen demo user.

- Nothing secret reaches the browser.
- Puts a sign-in-as-anyone endpoint into a codebase that deploys to production. A single
  misconfigured variable would turn it into a production backdoor. **Rejected.**

## Decision

**Option A**, with four independent production guards:

1. **Not built.** Quick sign-in lives in its own module, loaded with a dynamic import
   inside an `import.meta.env.VITE_APP_ENV !== "production"` branch, so the bundler drops
   it from production builds. A CI step builds with production settings and fails if the
   marker string `data-quick-signin` appears in `dist/`.
2. **Not configured.** `VITE_DEMO_PASSWORD` is set only on Vercel's staging and preview
   environments.
3. **Refuses at runtime.** The module returns nothing if `VITE_SUPABASE_URL` contains the
   production project ref.
4. **No accounts.** Demo users use a reserved, undeliverable domain and are created only
   by the staging seed, which aborts if pointed at the production ref.

### Behaviour

- Card titled "Staging quick sign-in" above the normal form, four buttons, each showing the
  role, the persona name, and what they can see (for example "Tenant · Tina · Unit 1A").
- Click → sign in → route to that role's home (`ROLE_HOME` in `safe-redirect.ts`: admin
  `/dashboard`, landlord and tenant `/home`, maintenance `/maintenance`). Failure shows the Supabase error inline
  with a hint to run "Reset staging data".
- `/login?as=admin|landlord|tenant|maintenance` does the same without a click; it honours
  the existing `?redirect=` handling.
- The staging ribbon carries a role switcher that signs out and back in as another role.
- The email/password form remains for testing real sign-up, reset, and approval.

### Code touchpoints

| File | Change |
|---|---|
| `src/client/lib/env.ts` (new) | `APP_ENV`, `isProduction`, production-ref guard |
| `src/client/components/auth/quick-signin.tsx` (new) | The card; staging/local only |
| `src/client/components/auth/login-page.tsx` | Lazy-mount the card; handle `?as=` |
| `src/client/components/chrome/staging-ribbon.tsx` (new) | Ribbon and role switcher |
| `src/client/vite-env.d.ts` | Declare the two new variables |
| `tests/emulator/dev-local.ts` | Pass `VITE_APP_ENV=local` and the emulator password |
| `tests/emulator/seed.ts` | Becomes the shared persona list |
| `.github/workflows/ci.yml` | Production-bundle guard step |

## Consequences

- One click, no secrets in the repo, no new backend.
- Security rests on the gate plus the fact that staging holds only synthetic data. If the
  password leaks, re-running the seed rotates it.
- Anyone past the gate is effectively a staging admin. That is intended: staging is a
  sandbox that can be reset at any time.
- If the owner later wants staging open without a gate, switch to Option B; the UI is the
  same, only the source of the password changes.
