# Wave 3 plan (pointer)

**Canonical plan:** Cursor Project store `docs/wave3-plan.md` — **approve there before staffing implementers**.

**Base:** `master` @ Wave 1–2 complete (PRs #19–#29).  
**Mode:** Planning only until owner approval. **Do not** implement from this pointer alone.

## Owner choices (2026-11-14)

| Item | Choice |
|------|--------|
| **WS-O** thin calendar | **YES** — staff after approval |
| **WS-P** Zillow research | **NO** — leave deferred |
| **WS-Q** website visual | **NO** — leave deferred |
| Portal host (WS-I) | **Open** — do not invent |
| Status labels (hygiene #11) | **Open** |

## Streams to staff after approval

| Stream | Size | Conflict | Start |
|--------|------|----------|-------|
| **WS-I** Hosting/deploy + portal URL + staging + migration history (#8, #13) | M | Low–med vs S history | Docs/staging now; **Production waits on host** |
| **WS-K** Accept & schedule | M | **High** on `work-order-dialog.tsx` | Immediately |
| **WS-N** Perf/docs (one lane) | S–M | Low–med | Immediately |
| **WS-O** Thin read-only calendar | M | Med; prefer after K | After K |
| **WS-S** Security & hygiene (items 1–7, 10; lanes S1→S2→S3) | L program | **Serialize migrations (S2)** | **S1 (#1–2) first** |
| **WS-R** Login `?redirect=` (#9) | S | Low | Parallel OK |

## Hygiene map (owner order)

1–2 → **WS-S S1** (CI required; archive D1/Hono/Clawnify + plan refresh + `main` sync) — parallel with I/K/N/O  
3–6, 10 → **WS-S S2** (anon payment EXECUTE; last-admin; email_confirmed approve; 5-photo DB; Settings admin-only) — **no migration overlap**  
7 → **WS-S S3** (leaked-password + min length) — parallel OK  
8, 13 → **WS-I**  
9 → **WS-R**  
11 → owner decision, then small FE  
12 web push → **WS-L hold**

## Hold / not staffed

**WS-L** (R6 + web push) · **WS-M** · **WS-P** · **WS-Q** · Stripe · Jayla #4/#12 · full calendar / inspections / permits

## Migrations

Never live-only DDL — file under `supabase/migrations/` on a PR first (`docs/ops/schema-migrations.md`). S2 claims ≥ `20261114050000`; reserve `20261114100000+` for WS-L.

Full kickoffs, acceptance, and conflict matrix: Project store plan + [parallel-work-plan.md](./parallel-work-plan.md).
