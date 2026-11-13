# Phase 6 — Notifications (R6)

**Status:** Stub — after Phase 3+ (needs maintenance events).

**Goal:** Configurable staff email alerts on new/updated maintenance requests; push deferred.

## Agents

| Step | Agent | Work | Done |
|------|-------|------|------|
| P6a | BE | On MaintenanceRequests insert/status change → email staff where `gets_request_alerts`; secrets in host env | [ ] |
| P6b | FE | Optional in-app notification list | [ ] |
| P6c | QA | Alert once per event; disabled flag respected | [ ] |

**Recommendation:** Resend (or Supabase) for email.  
**DoD:** Staff email alerts on new/updated requests; push later.
