<img src="readme-banner.png" alt="OpenProperty preview" width="100%" />

# LG Maintenance Portal

**Landlord Gopher** staff/admin/landlord/tenant portal. Product data path is
**Supabase Auth + Postgres + RLS** (landlords, properties, units, tenants,
leases, rent, maintenance, vendors, settings, documents). Accounts must be
`account_status = approved` to pass the app gate and RLS helpers.

See [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) (pointer to
current trackers), [`docs/deferred-work.md`](docs/deferred-work.md), and
[`docs/ops/ci-required-checks.md`](docs/ops/ci-required-checks.md).

Legacy D1 / Hono / Clawnify Worker assets are preserved under
[`archive/`](archive/README.md) — not a deploy path.

### Local env (required for the UI)

```bash
cp .env.example .env
# Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (Landlord Gopher project)
pnpm install
pnpm exec vite   # or: pnpm build && serve dist
```

Bootstrap the first admin after creating an Auth user:

```sql
select private.assign_admin('you@example.com');
```

Open-source **property management software** lineage (Clawnify OpenProperty
template), adapted for Landlord Gopher on Supabase.

## Features

### Dashboard
- **At-a-glance KPIs** — occupancy rate, active leases, outstanding rent, open work orders
- **This month's rent** — collected, outstanding, overdue at a glance
- **Open work orders** + **upcoming lease expirations** — what to act on this week

### Properties & units
- Property cards with type, address, color tag, occupancy snapshot
- Per-property page with summary tiles, unit grid, and the property's open work orders
- Units track bedrooms, bathrooms, square footage, market rent, occupancy (vacant / occupied), and readiness (ready / turnover / rehab)

### Tenants
- Searchable list showing each tenant's active unit and contact info
- Detail page with active lease, contact, employer, income, emergency contact, lease history

### Leases
- One row per lease with tenant, property · unit, term, monthly rent, and status
- Filters for active / upcoming / ended / all
- Edit-in-dialog with start / end / rent / deposit / due day / late fee / status

### Rent ledger
- One charge per active lease per month, generated idempotently with one click
- Period navigator (◀ / today / ▶) and totals: charged, collected, outstanding, overdue
- Record payments by amount, method, date, and reference. Status auto-updates as payments roll in
- Past payments visible per charge with one-click removal

### Maintenance
- Work orders with title, description, priority (urgent / high / normal / low), and status (open / assigned / in progress / completed / cancelled)
- Tabs: open / unassigned / assigned / in progress / completed / all
- Link work orders to a property, unit, and vendor; track scheduled date and cost

### Vendors & policy
- Vendor directory by category (plumber / electrician / HVAC / handyman / cleaning / landscaping / general)
- Rent policy defaults: due day, late fee, grace days, currency

## Stack

- React 19 + Vite + TypeScript
- Tailwind CSS v4 + shadcn/ui (Radix primitives)
- Supabase Auth + PostgREST + Storage (RLS)
- `lucide-react` / Phosphor icons
- pushState URL routing

## Develop

```bash
pnpm install
pnpm dev          # Vite at :5173
pnpm typecheck
pnpm build
```

## Test

```bash
pnpm test:ui      # dashboard at http://localhost:4600 — requirements, workflows, what needs fixing
pnpm test         # data-layer tests (~25s); CI runs this on PRs to master
pnpm test:all     # everything, incl. the real UI in a browser; writes tests/.results/report.html
pnpm dev:local    # run the portal against a local backend with demo logins (never touches live)
```

Tests run against a local Supabase emulator built from `supabase/migrations/`. See [`tests/README.md`](tests/README.md).

## CI

PRs to `master` run `pnpm typecheck`, `pnpm build`, and `pnpm test` via
[`.github/workflows/ci.yml`](.github/workflows/ci.yml). Making that check
**required** needs an owner click in branch protection — see
[`docs/ops/ci-required-checks.md`](docs/ops/ci-required-checks.md).

## Project layout

```
archive/            Legacy D1/Hono/Clawnify Worker (410 stub + schema) — not primary
docs/               Plan pointer, deferred work, phase briefs, schema notes, ops
supabase/migrations Additive RLS / AuthZ / product SQL (file before apply)
src/
  client/
    app.tsx         Auth gate + shell + routing
    lib/
      supabase.ts   Browser client
      data.ts       Supabase queries/mutations
      mappers.ts    UI ↔ Supabase field mapping
    components/     Feature pages + dialogs
    hooks/          use-auth, use-router, use-app-state
```

## What's intentionally not included

To keep this portal focused, these stay out of scope or deferred (see
`docs/deferred-work.md`):

- Listing syndication to external rental sites
- Real credit / background screening (placeholder application records only)
- 2-way SMS, email blasts, automated texting (Phase 6 / R6 hold)
- Online card / ACH payment processing (Stripe hold)
- Full landlord self-serve portfolio CRUD

## License

MIT
