# Landlord Gopher — Implementation plan (Phase 2 planning note)

> **Note:** The full Phase 0–6 tracker (R1–R8, verified facts, multi-agent packages) ships with the Phase 1 MVP branch [`cursor/phase0-phase1-mvp-8ed9`](https://github.com/CharmZoned/Maintenance-App-Portal/compare/master...cursor/phase0-phase1-mvp-8ed9). This file on `master` (via the Phase 2 planning PR) records the **Phase 2** plan expansion and how it relates to Phase 1 leftovers.

## Phase status snapshot

| Phase | Focus | Status |
|-------|--------|--------|
| 0 | Docs / schema tracker | On Phase 1 branch |
| 1 | Auth, RLS, Supabase data cutover, landlords | MVP @ `c6af01a`; open/merge via compare (no open PR from agent — collaborator) |
| **2** | **Account approval UI + Applications UI** | **Planning — see [`docs/phases/phase-2.md`](phases/phase-2.md)** |
| 3–6 | Tenant maint, website, docs, notify | Later |

## Phase 2 — Account approval + Applications UI (R2, R8)

**Goal:** Pending users cannot use the portal; staff/admin can approve, reject, or suspend accounts; rental Applications UI is separate from account approval.

| Step | Agent | Work |
|------|-------|------|
| P2a | BE | Admin-only status update policies/RPC; Applications read/write RLS; keep inquiries untouched |
| P2b | FE | Admin Users page: pending / approve / reject / suspend; signup → pending |
| P2c | FE | Applications list/detail (rental applicants) — clearly labeled |
| P2d | QA | Pending blocked; approve unlocks; reject/suspend stick |

**Already in Phase 1 (do not rebuild):** `account_status` column; app `unapproved` gate; SQL helpers require `approved`.

**Phase 1 follow-ups (not Phase 2 features):** admin-gate remaining portfolio mutate UI for `maintenance` role; finish `lease-dialog` effect deps; optional payment RPC / FORCE RLS — listed in [`docs/phases/phase-2.md`](phases/phase-2.md#phase-1-leftovers-do-before-or-in-a-small-phase-1-follow-up-pr--not-phase-2-product).

**DoD:** Pending users cannot use portal; staff can approve; Applications UI ≠ account approval.

**Start feature work only after** this planning doc is accepted and Phase 1 is mergeable.
