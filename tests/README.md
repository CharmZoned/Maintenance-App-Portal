# Tests

Automated checks for the portal, organised by requirement (R1–R8) and by
workflow, with a local dashboard that shows what passes and what needs fixing.

Nothing here talks to the live Supabase project. The suite runs against a local
emulator (`tests/emulator`) that carries the project's real schema, RLS policies
and triggers in an in-process Postgres — no Docker, no accounts, no network.

## Commands

| Command | What it does |
|---|---|
| `pnpm test:ui` | Open the dashboard at http://localhost:4600 — run suites with a button, watch the log, browse results |
| `pnpm test` | Unit + requirement + workflow tests (vitest, ~25s) |
| `pnpm test:browser` | Browser tests: the real UI in Chromium (Playwright, ~2 min) |
| `pnpm test:all` | Everything, then writes `tests/.results/report.html` (a single file you can share) |
| `pnpm dev:local` | Run the portal at http://localhost:5198 against the emulator with demo data and one login per role |
| `pnpm typecheck:tests` | Type-check the test code |

First time only, for the browser tests: `pnpm exec playwright install chromium`.

## The dashboard

- **Needs fixing** — every failing check, grouped by requirement, with what the
  app or database actually answered (and a screenshot for browser checks).
- **Requirements** — one row per requirement with pass / fail / planned counts;
  open a row for the individual checks, or re-run just that requirement.
- **Workflows** — each workflow as ordered steps by person (Tenant, Admin,
  Worker), once against the data layer and once in the browser with screenshots.

A failing check is a finding about the app, not a broken test run. `test.todo`
entries show as "planned": written down, feature not built yet.

## Layout

```
tests/
  requirements.json     the list the dashboard shows (R1–R8, WF1–WF2)
  requirements/         one file per requirement — data layer + database rules
  workflows/            multi-person workflows, step by step, data layer
  e2e/                  the same workflows and key screens in a real browser
  unit/                 pure functions (mappers, helpers)
  support/              helpers: sign in as a persona, reset data, ports
  emulator/             local Supabase: REST, Auth, Storage over in-process Postgres
    baseline/           emulator-only platform shim (pre-portal SQL is in supabase/migrations/)
    seed.ts             the standard test world and logins
  dashboard/            runner, local server and the dashboard page
```

## Adding a requirement or workflow

1. Add an entry to `tests/requirements.json` (`R9`, `WF3`, …).
2. Put the id in square brackets in a `describe` or `test` title:

   ```ts
   describe("[R9] Rent reminders", () => {
     test("a tenant is reminded three days before rent is due", async () => { … });
     test.todo("reminders stop once the charge is paid");   // planned, not built
   });
   ```

3. For a workflow, name each step `Person · what they do` — the dashboard turns
   those into the step list:

   ```ts
   describe("[WF3] Move-out", () => {
     test("Tenant · gives notice", …);
     test("Admin · schedules the inspection", …);
   });
   ```

That is all the wiring there is: the dashboard groups by the ids it finds in titles.

## Writing a check

```ts
import * as data from "@/lib/data";
import { clientFor, expectDenied, resetWorld, signInApp } from "../support/harness";

const world = await resetWorld();          // clean database + standard world

await signInApp("tenant");                 // the app's own client, as the tenant
const wo = await data.submitTenantMaintenanceRequest({ … });   // same code the screen calls

const worker = await clientFor("worker");  // a separate client, to ask the database directly
expectDenied(await worker.from("MaintenanceRequests").select().eq("id", wo.id));
```

Logins (password `Password123!`): `admin@`, `worker@`, `worker2@`, `tenant@`,
`tenant2@`, `landlord@`, `pending@` — all `@test.local`. See `emulator/seed.ts`.

## AuthZ / ledger regression coverage (WS-J)

Wave 2 locks in these suites on the PR #18 harness (prefer new assertions over
app changes):

| Area | Where | What it locks in |
|---|---|---|
| Payment ledger RPCs | `requirements/r7-permissions.test.ts` → **payment ledger RPCs** | `record_payment` / `delete_payment` status math, SUM-vs-drift heal, non-admin deny, anon EXECUTE deny (WS-S S2 #3), direct Payment DML deny, positive amount, waived cleared by payment |
| Maintenance photo isolation | `requirements/r4-maintenance-requests.test.ts` → **photo isolation** | Unassigned worker cannot see/upload; landlord read-only on owned requests; photo rows not rewritable |
| Status history append-only | same file → **status history** | Cross-tenant history isolation; prior rows never rewritten when status advances |
| Document visibility isolation | `requirements/r5-property-documents.test.ts` → **visibility isolation** | Tenant/landlord/staff storage + row ACL; other-property deny; pending sees nothing |

R6 notification checks stay `test.todo` until that product stream reopens.

## How the emulator stays faithful

- On start it replays `tests/emulator/baseline/*.sql` (platform shim only) and then
  **every file in `supabase/migrations/`**, in order. Pre-portal setup scripts ship
  in `supabase/migrations/` so a fresh Supabase project can rebuild from the repo.
  A new migration is picked up automatically;
  one that does not apply cleanly fails the run with the file name.
- `baseline/` holds only the small shim for what Supabase provides out of the
  box (roles, `auth`, `storage`, default grants). Pre-portal setup SQL now lives
  in `supabase/migrations/` (same version stamps as live history). After replay,
  table grants and RLS flags match the live project.
- Requests run as the caller's database role with their JWT claims, so RLS,
  grants, CHECK constraints and triggers are enforced by Postgres itself.
- It implements the parts of PostgREST / Auth / Storage the app uses. If the app
  starts using something it does not know (for example embedded selects or `or`
  filters) it answers with error code `EMU001` rather than guessing — extend
  `emulator/rest.ts` when that happens.
- It is not a substitute for a final check against a real Supabase project
  before a release; it is what makes every other day fast and safe.
