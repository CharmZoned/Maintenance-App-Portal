# Live maintenance ACL baseline

**Project:** `bgjkjtfgrfiszbzatriq`  
**Why:** Core `MaintenanceRequests` / photos / comments policies and helpers come from **pre-portal** remote migrations (Oct 2026) that are **not** files under this repo’s `supabase/migrations/`. AuthZ PRs must review against this live baseline, not assume the helpers are absent.

Verified via Supabase MCP (2026-11-13). Later phase migrations may `CREATE OR REPLACE` helpers or `DROP`/`CREATE` policies — those land as normal repo files.

## Helpers (`private`)

### `can_select_maintenance_request(target_request bigint)`

`SECURITY DEFINER` SQL. True if the request exists and caller is **admin**, **submitting tenant**, **assigned staff**, or **landlord who owns the unit**.

### `can_update_maintenance_request(target_request bigint)`

`SECURITY DEFINER` SQL. True if **admin**, or **maintenance** with `assigned_staff_id = current_staff_id()`. (Landlords are **not** updaters via this helper.)

### `can_upload_maintenance_photo(target_request bigint)`

`SECURITY DEFINER` SQL. True if `can_update_maintenance_request(...)`, or **tenant** who submitted the request.

## Policies (live names)

### `MaintenanceRequests`

| Policy | Cmd | Predicate (summary) |
|--------|-----|---------------------|
| `maintenance_requests_select` | SELECT | admin OR submitting tenant OR assigned staff OR `landlord_owns_unit(unit_id)` |
| `maintenance_requests_insert_admin` | INSERT | `current_role() = admin` |
| `maintenance_requests_insert_tenant` | INSERT | tenant; own unit/property; status `Open`; staff/schedule/cost fields null; `is_test_data = false` (Phase 3 tighten) |
| `maintenance_requests_update` | UPDATE | `can_update_maintenance_request(id)` (USING + WITH CHECK) |
| `maintenance_requests_admin_delete` | DELETE | `is_admin()` |

### `MaintenanceRequestComments`

| Policy | Cmd | Predicate (summary) |
|--------|-----|---------------------|
| `maintenance_comments_select` | SELECT | `can_select_maintenance_request` AND (`tenant_visible` OR role in admin/landlord/maintenance) |
| `maintenance_comments_insert` | INSERT | author ids match caller; visibility enum; update ACL **or** tenant + `tenant_visible` + select ACL |
| `maintenance_comments_delete` | DELETE | admin |

### `MaintenanceRequestPhotos`

| Policy | Cmd | Predicate (summary) |
|--------|-----|---------------------|
| `maintenance_photos_select` | SELECT | `can_select_maintenance_request` |
| `maintenance_photos_insert` | INSERT | `can_upload_maintenance_photo`; uploader = caller; path `{requestId}/…` |
| `maintenance_photos_delete` | DELETE | admin OR (tenant uploader + `can_upload_maintenance_photo`) |

Storage policies for `maintenance-photos` mirror these helpers (see Phase 3 migration `20261113220000_phase3_storage_acl_tenant_comments.sql`).
