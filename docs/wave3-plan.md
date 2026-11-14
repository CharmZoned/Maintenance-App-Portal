# Wave 3 plan (pointer)

**Canonical plan:** Cursor Project store  
`docs/wave3-plan.md` (Landlord Gopher Project) — approve there before staffing implementers.

**Base:** `master` @ Wave 1–2 complete (PRs #19–#29; no open portal PRs as of plan authoring).  
**Mode:** Planning only until owner approval. **Do not** implement WS-I/K/N or add-ons from this pointer alone without the approved Project plan.

## Core streams (parallel OK after approval)

| Stream | Size | Conflict | Start |
|--------|------|----------|-------|
| **WS-I** Ops: portal URL + staging + migration repair | S–M | Low | Immediately (needs owner portal-host choice for Production env) |
| **WS-K** Accept & schedule UX (+ optional dialog split) | M | **High** on `work-order-dialog.tsx` | Immediately; sole large rewrite of that dialog |
| **WS-N** Perf / query slim / docs polish (one lane) | S–M | Low–medium | Immediately; prefer dashboard N+1 or list slim; avoid WO dialog |

## Optional add-ons (owner opt-in)

| Stream | Roadmap | Notes |
|--------|---------|-------|
| **WS-O** Thin read-only property calendar | #9 skinny | Month view of existing dates only; prefer after WS-K |
| **WS-P** Zillow sync **research** | #10 | Docs spike only — no production sync |
| **WS-Q** Website visual polish | #11 | Needs short owner/Jayla brief; website repo |

## Hold (do not staff)

- **WS-L** R6 / Phase 6 notifications  
- **WS-M** Full landlord self-serve  
- Stripe #13–15 · Jayla listings #4 · Jayla access #12 · full calendar / inspections / permits  

## Merge gate (summary)

Portal URL wired for website CTAs (**I**); richer admin Accept & schedule (**K**); at least one coherent perf/docs PR (**N**); optional O/P/Q done or re-parked.  

**Migrations:** never live-only DDL — SQL must exist under `supabase/migrations/` on a PR before apply (`docs/ops/schema-migrations.md`). Wave 3 core is expected FE/ops/docs; next free prefixes ≥ `20261114050000` (reserve `20261114100000+` for WS-L).

## Kickoffs

Use the full kickoff prompts in the Project store Wave 3 plan (or adapt from `docs/parallel-work-plan.md` WS-I / WS-K / WS-N sections). Stream definitions for I/K/N remain in [parallel-work-plan.md](./parallel-work-plan.md); Wave 1–2 history stays there for context.
