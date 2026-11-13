# Phase 5 — Property documents (R5)

**Status:** Implemented on branch `cursor/phase5-property-documents-0924` (migration applied live).  
**Goal:** Staff attach documents to property/unit with RLS. Admin sets visibility `tenant` | `staff` | `landlord`.

## Agents

| Step | Agent | Work | Done |
|------|-------|------|------|
| P5a | BE | `PropertyDocuments` table; private `property-documents` bucket; staff/admin/landlord policies; admin-only visibility | [x] |
| P5b | FE | Upload/list/download on property (optional unit); tenant Documents page | [x] |
| P5c | QA | Tenant cannot read staff-only docs; landlord scoped via RLS; typecheck/build | [x] |

**DoD:** Staff attach docs to property/unit with RLS; admin marks visibility; tenants only see `tenant` docs.

---

## Delivered

### BE (`20261113230000_phase5_property_documents.sql`)

- `PropertyDocuments` (property_id, optional unit_id, title, file_name, storage_path, visibility, …)
- Path shape `{propertyId}/{filename}`; unit must belong to property
- Visibility protect trigger: only admin can set/change visibility away from `staff`
- Helpers: `can_select_property_document`, `can_manage_property_documents`
- Hierarchical SELECT: staff/admin all; landlord sees `landlord`+`tenant` on owned properties; tenant sees `tenant` on own property (unit match when set)
- Private bucket `property-documents` (20 MB) + storage ACL

### FE

- Property page Documents panel: upload, list, download, delete; admin visibility control
- Staff upload defaults to staff-only (admin can widen)
- Tenant shell: Documents nav + list/download of tenant-visible docs
- Landlord portal UI still deferred — RLS ready

---

## Manual QA checklist

| # | Check | Expected |
|---|--------|----------|
| 1 | Admin uploads doc with visibility Tenant | Row + storage object; tenant can list/download |
| 2 | Admin/staff uploads with Staff visibility | Tenant cannot see; staff/admin can |
| 3 | Non-admin tries visibility Landlord/Tenant on insert | Denied (UI + trigger/RLS) |
| 4 | Admin changes visibility Staff → Tenant | Tenant sees after refresh |
| 5 | Unit-linked tenant doc | Only tenant of that unit (or property-wide null unit) |
| 6 | Landlord JWT SELECT (SQL/RLS) | Sees landlord+tenant docs on owned properties only |
| 7 | Delete document | Table row + storage object removed |

---

## Leftovers → `docs/deferred-work.md`

Landlord documents UI (portal shell); automated RLS tests; confirm migration on non-primary envs.
