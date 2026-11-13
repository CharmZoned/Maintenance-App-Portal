# Phase 3 — Tenant maintenance + photos (R4, R7)

**Status:** Implemented on branch `cursor/phase3-tenant-maintenance-0924` (apply migration live + merge PR).  
**Goal:** Tenant submits maintenance with category + photos; staff updates status with a visible trail; comments respect visibility.  
**Alerts:** No email/push in this phase — use in-app **popups/toasts** for confirmation feedback (Phase 6 deferred).

## Agents

| Step | Agent | Work | Done |
|------|-------|------|------|
| P3a | BE | Confirm tenant insert RLS; photo bucket; status history table; approve linked tenants; admin-only Accept & schedule | [x] |
| P3b | FE | Tenant shell: submit (category, description, permission_to_enter, photos); list own | [x] |
| P3c | FE | Staff maintenance UI: category, photos, comments, status via mapping layer; status history | [x] |
| P3d | QA | Tenant isolation; staff scope; photo upload/download; typecheck/build | [x] |

**DoD:** Tenant submits with photo; staff status trail; comments visibility respected.

---

## Delivered

### BE (`20261113210000_phase3_tenant_maintenance_status_history.sql`)

- `MaintenanceRequestStatusHistory` + AFTER INSERT/UPDATE trigger (append-only; select via `can_select_maintenance_request`)
- `protect_maintenance_request`: Accept & schedule (`Scheduled` / `scheduled_for`) admin-only
- `set_account_status` / `admin_set_user_role`: approve linked tenants (`tenant` + `tenant_id`)
- Harden `current_tenant_unit_id` / `current_tenant_property_id` (approved + tenant role)
- FORCE RLS on Photos / Comments / StatusHistory
- Tenant insert WITH CHECK tightened (property_id + forbid vendor/cost/notes); photo path/author + comment author bound to caller
- Storage UPDATE/DELETE tightened (tenants only delete own objects); tenant_visible comment replies allowed
- Staff UI collects companion CHECK fields; Accept & schedule primary action; tenant Active/Closed filters + photo retry

### FE

- Auth gate: approved `tenant` + `tenant_id` → tenant shell (My requests only)
- Users: tenant link picker; approve tenant when linked
- Tenant submit dialog: category, description, permission_to_enter, photos (toast on success)
- Staff WO dialog: category, photos, comments (`tenant_visible` \| `internal`), status history; admin-only schedule
- Status mapping aligned to live CHECK: `Open | Scheduled | In Progress | On Hold | Closed`

---

## Manual QA checklist

| # | Check | Expected |
|---|--------|----------|
| 1 | Approve tenant + link Tenant row with `unit_id` | Can open My requests |
| 2 | Tenant submits with photo | Row + `MaintenanceRequestPhotos` + storage object; status history “Created” |
| 3 | Tenant lists only own | RLS isolation |
| 4 | Staff/admin opens request | Sees photos, comments (visibility), status trail |
| 5 | Staff sets Scheduled | Denied (UI + protect trigger) |
| 6 | Admin Accept & schedule | Status Scheduled + date; history row |
| 7 | Internal comment | Tenant cannot see; staff/admin can |
| 8 | Landlord still blocked from portal | Forbidden until landlord shell ships |

---

## Leftovers → `docs/deferred-work.md`

Confirm live apply of this migration if another env; landlord portal; richer Accept & schedule assignment UX; optional vitest for photo/history RLS.
