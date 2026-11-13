<img src="readme-banner.png" alt="OpenProperty preview" width="100%" />

# LG Maintenance Portal (OpenProperty)

[![Deploy with Clawnify](https://app.clawnify.com/deploy-button.svg)](https://app.clawnify.com/deploy?repo=clawnify/OpenProperty)

**Landlord Gopher** staff/admin portal. Phase 1 uses **Supabase Auth + Postgres + RLS** for portfolio data (landlords, properties, units, tenants, leases, rent, maintenance, vendors, settings). The legacy Worker still exists but **all `/api/*` routes return 410 Gone** (unauthenticated D1 CRUD is retired). Accounts must be `account_status = approved` to pass the app gate and RLS helpers.

See [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) and [`docs/phases/phase-1.md`](docs/phases/phase-1.md).

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

Open-source **property management software** lineage (Clawnify OpenProperty template), adapted for Landlord Gopher.

## Features

### Dashboard
- **At-a-glance KPIs** — occupancy rate, active leases, outstanding rent, open work orders
- **This month's rent** — collected, outstanding, overdue at a glance
- **Open work orders** + **upcoming lease expirations** — what to act on this week

### Properties & units
- Property cards with type, address, color tag, occupancy snapshot
- Per-property page with summary tiles, unit grid, and the property's open work orders
- Units track bedrooms, bathrooms, square footage, market rent, and status (vacant / occupied / turnover / unavailable)

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
- Hono on Cloudflare Workers (D1-native — same code locally and in production)
- `lucide-react` for icons
- pushState URL routing

## Develop

```bash
pnpm install
pnpm dev          # Vite at :5173, Wrangler at :8787 (D1 schema applied automatically)
pnpm typecheck
pnpm build
```

The dev script applies `src/server/schema.sql` to the local D1 database, then runs Vite and Wrangler in parallel. The schema seeds 3 sample properties, 5 units, and 3 vendors so the app is usable on first boot.

## Deploy

If you have the Clawnify CLI installed:

```bash
clawnify deploy
```

Or wire it up to Cloudflare Workers + D1 directly using the bindings in `wrangler.toml` (binding `DB`, database name `open-property-db`).

## Project layout

```
docs/               Implementation plan + phase briefs + schema notes
supabase/migrations Phase 1 additive RLS / account_status
src/
  server/           Legacy Hono + D1 (unused by Phase 1 client)
  client/
    app.tsx         Auth gate + shell + routing
    lib/
      supabase.ts   Browser client
      data.ts       Supabase queries/mutations
      mappers.ts    D1/UI ↔ Supabase field mapping
    components/
      auth/         Login, reset password, blocked
      landlords/    Landlord CRUD
      dashboard/ properties/ tenants/ leases/ rent/ maintenance/ settings/
    hooks/          use-auth, use-router, use-app-state
```

## What's intentionally not included

To keep this template self-hostable with no third-party SaaS dependencies and no public-facing endpoints, these features are out of scope:

- Listing syndication to external rental sites
- Real credit / background screening (placeholder application records only)
- 2-way SMS, email blasts, automated texting
- Online card / ACH payment processing
- Public tenant or owner portals

These can all be layered on top once you fork the template.

## License

MIT
