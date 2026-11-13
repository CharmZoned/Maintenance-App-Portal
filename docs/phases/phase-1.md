# Phase 1 — MVP foundation (R1, R7, R8 core, R3)

**Goal:** Staff/admin sign in and run portfolio screens against Supabase with RLS; every property has a landlord; client no longer calls `/api` for those flows.

**Out of scope:** Account approval UI (Phase 2), tenant submit (Phase 3), website repo (Phase 4), documents, notifications.

---

## Agent packages

### BE — P1a Schema & RLS

- [x] `supabase/migrations/` added for live-aligned additive changes
- [x] `account_status` on `user_roles` (`pending|approved|rejected|suspended`); Phase 1 bootstrap admin treated as approved (see migration comments + `docs/supabase-schema.md`)
- [x] RLS policies for `Leases`, `LeaseTenants`, `RentCharges`, `Payments`, `Vendors`, `Settings`
- [x] Admin write policies for `Landlords`, `Properties`, `Units`, `Tenants`, `Staff` (were select-only)
- [x] `Tenants.unit_id` nullable (portfolio create-before-lease)
- [x] Document `handle_new_user` / `assign_admin` bootstrap
- [x] Do not change maintenance photo policies except as needed (unchanged)
- [x] Do not add anon policies on `inquiries`

### BE — P1b Typegen & admin seed

- [x] Hand-written TS types in `src/client/types.supabase.ts`
- [x] Admin seed steps in `docs/supabase-schema.md` and below

### FE — P1a Auth shell

- [x] `@supabase/supabase-js`; `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`; `.env.example`
- [x] Login, logout, password reset request/confirm, session restore
- [x] Gate: unauthenticated → login; no role → blocked; `admin` or staff-linked (`maintenance` + `staff_id`) → app

### FE — P1b Data-layer cutover

- [x] Replace Hono/D1 client fetches with Supabase queries/mutations
- [x] Field-name mapping layer (`src/client/lib/mappers.ts`)
- [x] Client does not call `/api` for dashboard/properties/units/tenants/leases/rent/maintenance/vendors/settings
- [x] Hono/D1 left in repo but unused by client

### FE — P1c Landlords

- [x] Landlords list / dialog CRUD
- [x] Property create/edit requires `landlord_id`

### QA — P1 verify

- [x] `pnpm typecheck` / `pnpm build`
- [ ] Manual checklist (run after env + admin seed) — see below

---

## Manual test checklist

Prereqs: `.env` with `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`; Phase 1 migration applied; admin seeded (`private.assign_admin` + `account_status = 'approved'`).

| # | Step | Expected |
|---|------|----------|
| 1 | Open app signed out | Login screen; no portfolio queries |
| 2 | Login as admin | Dashboard / nav loads |
| 3 | Refresh | Session restored |
| 4 | Logout | Returns to login |
| 5 | Password reset request | Supabase sends reset email (or shows success) |
| 6 | Create landlord | Appears in Landlords list |
| 7 | Create property **without** landlord | Blocked / validation error |
| 8 | Create property **with** landlord | Saved; landlord shown on detail |
| 9 | Units / tenants / leases / rent / maintenance / vendors / settings CRUD | Reads/writes Supabase; empty states OK |
| 10 | Anon / wrong-role user | Cannot load portfolio data |
| 11 | No service role key in client bundle | Only anon key in Vite env |
| 12 | Website inquiries | Still insertable via service role; unchanged |

---

## Env vars

```bash
VITE_SUPABASE_URL=https://bgjkjtfgrfiszbzatriq.supabase.co
VITE_SUPABASE_ANON_KEY=<anon or publishable key>
```

Optional for password-reset deep link in local dev: ensure Supabase Auth redirect URLs include your Vite origin (e.g. `http://localhost:5173/**`).

---

## Seed first admin

See [docs/supabase-schema.md](../supabase-schema.md#bootstrap-first-admin).
