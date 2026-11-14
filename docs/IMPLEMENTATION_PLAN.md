# Landlord Gopher — implementation plan (pointer)

**Last revised:** 2026-11-14 (WS-S S1)

This file used to hold the full phased plan. That snapshot is archived at
[`docs/archive/IMPLEMENTATION_PLAN.pre-wave3.md`](archive/IMPLEMENTATION_PLAN.pre-wave3.md).

## Current trackers (use these)

| Doc | Role |
|-----|------|
| [`docs/parallel-work-plan.md`](parallel-work-plan.md) | Wave 1–2 stream definitions + historical kickoffs |
| [`docs/wave3-plan.md`](wave3-plan.md) | Wave 3 streams (repo index; fuller copy may also live in the Cursor Project store under the same relative path) |
| [`docs/deferred-work.md`](deferred-work.md) | Parked items (hosting/URL, R6, Stripe, hygiene backlog, etc.) |
| [`docs/ops/schema-migrations.md`](ops/schema-migrations.md) | Migration / no live-only DDL rules |
| [`docs/ops/ci-required-checks.md`](ops/ci-required-checks.md) | CI workflow + making the check required |
| [`docs/phases/`](phases/) | Per-phase briefs (historical DoD) |
| [`docs/supabase-schema.md`](supabase-schema.md) | Schema field notes |

## Status snapshot (after Wave 1–2 on `master`)

| Wave / phase | Status |
|--------------|--------|
| Phase 0–1, 1.5, 2, 3, 5 | **Done** (merged) |
| Wave 1 (WS-A–D) | **Done** — grants, roles, enums, doc delete |
| Wave 2 (WS-E–J) | **Done** — AuthZ, landlord docs, lease sync, QA, tests |
| Wave 3 | **In progress** — ops, Accept & schedule, perf, thin calendar, hygiene (WS-S), login redirect |
| Phase 4 (website CTAs) | Blocked on **portal hosting/URL** (deferred until owner provides the link) |
| Phase 6 / R6 / web push | **Hold** (WS-L) |

**Default branch:** `master` only. Legacy `main` ↔ `master` sync is retired.

**Product data path:** Supabase Auth + Postgres + RLS (not D1/Hono). Legacy Worker / Clawnify deploy assets live under [`archive/`](../archive/README.md).
