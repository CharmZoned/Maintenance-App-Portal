# Wave 3 plan (repo pointer — not canonical)

**Canonical plan:** Cursor Project store `docs/wave3-plan.md` (not this file).  
**Also see:** [`docs/parallel-work-plan.md`](./parallel-work-plan.md) stream defs; WS-I ops truth in [`docs/ops/schema-migrations.md`](./ops/schema-migrations.md).  
**Base:** `master` @ Wave 1–2 complete (PRs #19–#29).  
**Mode:** **Staffing approved** — implementers launched for **I / K / N / O / R / S1**. **Pointer-only** — do not re-plan scope or treat this copy as authoritative over the store plan.

## Owner choices (2026-11-14)

| Item | Choice |
|------|--------|
| **WS-O** thin calendar | **YES** — staffed |
| **WS-P** Zillow research | **NO** — leave deferred |
| **WS-Q** website visual | **NO** — leave deferred |
| **Portal hosting + URL** (**roadmap #3** = hygiene **#13**) | **Out of Wave 3** — deferred until owner provides the link (live landlordgopher.com still old WordPress; Next.js not launched). ≠ hygiene #3 |
| Status labels (hygiene #11) | **Open** |

## Streams (staffed)

| Stream | Size | Conflict | Start |
|--------|------|----------|-------|
| **WS-I** Staging Supabase + migration history repair (#8 only) | S–M | Low–med vs S history | Now — **no** hosting/URL. Status SoT: [`docs/ops/schema-migrations.md`](./ops/schema-migrations.md) § Staging / §E |
| **WS-K** Accept & schedule | M | **High** on `work-order-dialog.tsx` | Now |
| **WS-N** Perf/docs (one lane) | S–M | Low–med | Now |
| **WS-O** Thin read-only calendar | M | Med; prefer after K | After K (or coordinated) |
| **WS-S** Security & hygiene (items 1–7, 10; lanes S1→S2→S3) | L program | **Serialize migrations (S2)** | **S1 (#1–2) first** (launched) |
| **WS-R** Login `?redirect=` (#9) | S | Low | Now |

## Hygiene map (owner order)

1–2 → **WS-S S1** (CI required; archive D1/Hono/Clawnify + plan refresh + `main` sync) — parallel with I/K/N/O  
**S2 order 3→10→5→4→6** → anon payment EXECUTE; Settings admin-only; `email_confirmed_at` approve; last-admin; 5-photo DB — **no migration overlap**  
7 → **WS-S S3** (leaked-password + min length) — parallel OK  
8 → **WS-I** (staging + history only)  
9 → **WS-R**  
11 → owner decision, then small FE  
12 web push → **WS-L hold**  
13 hosting/deploy + portal URL + website env → **deferred-work** (not Wave 3)

## Hold / not staffed

**WS-L** (R6 + web push) · **WS-M** · **WS-P** · **WS-Q** · **Portal hosting + URL** · Stripe · Jayla #4/#12 · full calendar / inspections / permits

## Migrations

Never live-only DDL — file under `supabase/migrations/` on a PR first (`docs/ops/schema-migrations.md`). Latest on `master`: `20261114050000_*` (#37). S2 next slots ≥ `20261114060000`; reserve `20261114100000+` for WS-L.

Full kickoffs, acceptance, and conflict matrix: Project store plan + [parallel-work-plan.md](./parallel-work-plan.md).
