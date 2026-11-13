# Phase 6 — Notifications & messaging (R6) — DEFERRED

**Status:** **Deferred / on hold** (product decision 2026-11-13).  
Do not schedule agents for this phase until explicitly reopened.

**Interim approach:** Use **web app popups, toasts, and confirm dialogs** for operator feedback (success/error, confirm approve/reject, etc.). No email, push, or messaging product work.

---

## Original goal (when reopened)

Configurable staff email alerts on new/updated maintenance requests; optional in-app notification list; messaging threads (staff↔tenant / staff↔landlord) as a separate design — not maintenance comments.

## Agents (parked)

| Step | Agent | Work | Done |
|------|-------|------|------|
| P6a | BE | On MaintenanceRequests insert/status change → email staff where `gets_request_alerts` | [ ] deferred |
| P6b | FE | Optional in-app notification list / messaging UI | [ ] deferred |
| P6c | QA | Alert once per event; disabled flag respected | [ ] deferred |

**Recommendation when reopened:** Resend (or Supabase) for email; native/mobile push still later.

**DoD (future):** Configurable staff email alerts; messaging scoped with RLS; push optional.
