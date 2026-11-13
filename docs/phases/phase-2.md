# Phase 2 — Account approval + Applications UI (R2, R8)

**Status:** Stub — start after Phase 1 DoD.

**Goal:** Pending users cannot use the portal; staff can approve/reject/suspend; rental Applications UI is separate from account approval.

## Agents

| Step | Agent | Work | Done |
|------|-------|------|------|
| P2a | BE | Enforce `account_status` via RLS or Edge gate; admin-only update; optional `approve_user` RPC | [ ] |
| P2b | FE | Admin Users page: pending / approve / reject / suspend; signup → pending | [ ] |
| P2c | FE | Applications list/detail (rental applicants) — clearly labeled | [ ] |
| P2d | QA | Pending blocked; approve unlocks; reject/suspend stick | [ ] |

**DoD:** Pending users cannot use portal; staff can approve; Applications UI ≠ account approval.

**Parallel:** P2c can run beside P2b once read policies exist. Phase 4 WEB may overlap once Phase 1 portal URL is stable.
