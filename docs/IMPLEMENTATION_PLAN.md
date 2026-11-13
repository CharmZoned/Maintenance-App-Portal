# Landlord Gopher — Phased Implementation Plan

## Branch / merge status (updated)

| Item | Status |
|------|--------|
| Default branches | `master` and `main` are aligned at the same tip |
| Phase 0–1 | Merged (PR #1) |
| Cursor review skills | Merged (PR #2) under `.cursor/skills/` |
| Phase 2 planning detail | [`docs/phases/phase-2.md`](phases/phase-2.md) — never replace this tracker with a planning stub |
| Phase 2 feature work | Not started — after Nov 9 maintenance port |
| Next engineering | Port `cursor/maintenance-work-orders-33a0` → admin approval UI |

**Verified on tip:** `pnpm typecheck` and `pnpm build` succeed (re-check after each PR).

---

## Product decisions (locked 2026-11-13)

| Topic | Decision |
|-------|----------|
| Document visibility | **Admin only** sets visibility to `tenant`, `staff`, or `landlord`. |
| OK / Accept orders | **Admin only** can OK / Accept & schedule maintenance orders. |
| Account approval | **Admin only** approve / reject / suspend (`account_status`). |
| Sign-up | Email signup → Supabase **email verification** → `account_status = pending` until admin approves. |
| Messaging | Draft **Phase 2.5**: in-portal threads for staff↔tenant and staff↔landlord (not maintenance comments). |
| Mobile / web push | **Defer native push.** Soft browser/in-app permission **popup placeholder** now; replaceable later. Email + in-app alerts are the real channel first. |
| Tracker edits | Additive patches only — do not merge Phase 2 planning stubs over this file. |

---

## Verified facts vs assumptions

**Verified**
- This repo ([maintenance-app-portal](https://github.com/charmzoned/maintenance-app-portal)) is **OpenProperty**: React 19 + Vite + Hono on **Cloudflare Workers + D1**, not Supabase. Nav title is already "LG Maintenance Portal". No `AGENTS.md`. No auth/login/session code. All `/api/*` routes are open. Schema in [`src/server/schema.sql`](src/server/schema.sql); routes in [`src/server/index.ts`](src/server/index.ts).
- README lists public tenant/owner portals and email as **intentionally out of scope** for the Clawnify template — conflicts with your product requirements.
- There is **no** `docs/` tracker in-repo (only `README.md`). Planning docs will be created as [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) after you approve this plan.
- Marketing site [`LandlordGopherWebsite`](https://github.com/CharmZoned/LandlordGopherWebsite) is Next.js; uses Supabase only for `inquiries` (service-role insert; RLS on, no policies). Canonical site URL default `https://landlordgopher.com`.
- Supabase project **Landlord Gopher** (`bgjkjtfgrfiszbzatriq`) already has empty domain tables: `Landlords`, `Properties` (with `landlord_id`), `Units`, `Tenants`, `Staff`, `Leases`, `LeaseTenants`, `RentCharges`, `Payments`, `Vendors`, `Applications`, `Settings`, `MaintenanceRequests` (+ photos/comments), `user_roles`, plus `inquiries`. Roles enum used in RLS: `admin` | `landlord` | `tenant` | `maintenance`. Private helpers exist (`current_role`, `handle_new_user`, etc.). Bucket `maintenance-photos` (private). Advisors: RLS enabled **without policies** on Applications, Leases, LeaseTenants, RentCharges, Payments, Vendors, Settings, inquiries.
- `Landlord-Gopher-Portal` GitHub repo is effectively empty ("read me test"). Mobile repo exists separately and is out of this plan unless you expand scope.

**Decisions (locked — you agreed with the plan)**
- Reuse the **same** Supabase project as the website (`bgjkjtfgrfiszbzatriq`).
- Keep this React portal UI; **replace D1/Hono** with Supabase client (Auth + PostgREST + Storage), adapting field names to the live schema.
- MVP = **Phase 1 + Phase 2** (staff/admin + auth + approval); tenant maintenance = Phase 3; website CTA = Phase 4; documents = Phase 5; notifications = Phase 6.
- Website integration MVP = nav/CTA links + shared Auth project (not SSO iframe in Phase 1).
- "Account approval" is **user account** status (pending/approve/reject/suspend), **not** rental `Applications` records.
- On execute: commit overall tracker to [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) plus per-phase agent briefs under [`docs/phases/`](docs/phases/).

```mermaid
flowchart LR
  Website["landlordgopher.com"] -->|"CTA / login link"| Portal["LG Maintenance Portal"]
  Portal --> Auth["Supabase Auth"]
  Portal --> DB["Postgres + RLS"]
  Portal --> Storage["maintenance-photos"]
  Website -->|"service role"| Inquiries["inquiries"]
  Auth --> Roles["user_roles"]
  Roles --> DB
```

---

## Requirement map (R1–R8)

Do not treat README checklists as done. Status is vs **this app’s code**, with Supabase schema noted separately.

| ID | Description | Status | Evidence | Remaining work / acceptance |
|----|-------------|--------|----------|-----------------------------|
| **R1** Accounts and login | Partial (Phase 1) | Supabase Auth + gates landed; signup/email-verify UX still thin | Complete signup → **email verification** → pending; login/reset; map Auth → `user_roles` + domain row; AC: unverified limited; unauthenticated cannot load portfolio |
| **R2** Account approval | Partial (column + gate; no admin UI) | `account_status` + RLS helpers exist; no Users approval screen | **Admin-only** approve / reject / suspend UI + policies; do **not** overload rental Applications; AC: new accounts blocked until admin approves (bootstrap admin excepted) |
| **R3** Properties and units | Partial | Phase 1 Supabase portfolio + landlords | Keep landlord-required properties; AC: every property has landlord; units CRUD under property |
| **R4** Maintenance requests | Partial | Basic WO UI; Nov 9 branch has photos/comments/Accept & schedule | Port Nov 9 into SPA; tenant submit later (Phase 3); **admin-only** OK / Accept & schedule; AC: photos+comments+trail; only admin OKs orders |
| **R5** Property documents | Missing | No documents beyond maintenance photos | `PropertyDocuments` + bucket; **admin-only** visibility `tenant`\|`staff`\|`landlord`; tenants read `tenant`-visible for their lease/unit; AC: visibility RLS enforced |
| **R6** Notifications | Missing | No email/push/in-app | Email + in-app on create/status change; soft **permission popup placeholder** (swappable); **native/mobile push deferred**; AC: staff alerted on new tenant request |
| **R7** Permissions | Partial | JWT + RLS; mutate UI gaps for non-admin | Fill RLS gaps; gate mutate UI; AC: role A cannot read/write role B’s rows; admin-only for status, order OK, doc visibility |
| **R8** Admin web portal | Partial | Portfolio screens exist; no users/approvals/messages/documents | Auth gate + role-based nav; admin Users/approval; documents; messaging; AC: only approved roles reach their routes |
| **R9** Messaging (draft) | Missing | No threads | Phase **2.5** draft: staff↔tenant and staff↔landlord threads + RLS; not WO comments; AC: parties only see their threads |

**Conflicts / outdated items**
- Your gap table matches the **portal app**, but understates Supabase (landlords, category, photos, roles, RLS helpers already exist).
- README “no public portals / no email” is obsolete for Landlord Gopher product goals.
- Field naming differs (D1 `name` vs Supabase `property_name` / `unit_label`; work_orders vs MaintenanceRequests; status casing).

---

## When multi-agent starts

| Moment | What happens |
|--------|----------------|
| **Now (plan mode)** | Single coordinator iterates the plan. No feature agents. |
| **On execute** | Coordinator commits Phase 0 docs, then **spawns Phase 1 agents** (first real multi-agent run). |
| **Phase 1 complete + reviewed** | Coordinator opens Phase 2 agents (new workers / new stacked PRs). |
| **Each later phase** | Same pattern: freeze inputs from prior phase → spawn role agents → Testing merges last → user review → next phase. |

Multi-agent is **per phase**, not one forever-running swarm. The coordinator owns sequencing, PR stacking, and shared files (`docs/`, `src/client/api.ts`, migrations). Agents never start the next phase without a green Testing handoff and your go-ahead if the phase DoD needs product judgment.

```mermaid
flowchart TB
  Coord[Coordinator]
  P0[Phase0_Docs]
  P1[Phase1_MVP]
  P2[Phase2_Approval]
  P3[Phase3_TenantMaint]
  P4[Phase4_Website]
  P5[Phase5_Documents]
  P6[Phase6_Notify]
  Coord --> P0 --> P1 --> P2 --> P3
  P1 -.->|portal URL ready| P4
  P3 --> P5 --> P6
  P4 -.->|can overlap after P1 auth| P2
```

Phase 4 (website CTA) may start in parallel with Phase 2 once Phase 1 has a stable portal URL and Auth project config — it does not need tenant maintenance.

---

## Standing agent roles

| Role id | Name | Owns | Forbidden without sync |
|---------|------|------|------------------------|
| **BE** | Supabase/Backend | `supabase/migrations/**`, RLS, Storage buckets, Auth triggers/Edge Functions, generated types | `src/client/components/**` UI |
| **FE** | Frontend/Design | Auth screens, shell, CRUD pages, branding, `src/client/**` (except waiting on BE types) | Raw SQL / live DB writes |
| **WEB** | Website integration | `LandlordGopherWebsite` nav/CTA, env, auth deep links | Portal schema or portal routes |
| **QA** | Testing/Review | RLS SQL tests, manual/Playwright scripts, security checklist, “ready for review” note | Shipping feature commits without BE/FE DoD |

**Shared-file rules**
- Only **BE** edits migrations; FE consumes `src/client/types.supabase.ts` (or equivalent) after BE typegen.
- Only **one** agent owns `src/client/api.ts` / data hooks per PR stack step (usually FE after BE contract is merged or stacked underneath).
- Branches: `cursor/phaseN-<topic>-8ed9`; stack child PRs on parent when dependent.
- Each agent writes a short handoff in the phase doc checkboxes when done.

---

## Phase 0 — Planning tracker (coordinator only)

- Write [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) (this overall plan + R1–R8 + decisions).
- Write [`docs/supabase-schema.md`](docs/supabase-schema.md) (tables, RLS summary, helpers, bucket).
- Write stubs [`docs/phases/phase-1.md`](docs/phases/phase-1.md) … `phase-6.md` (copy agent packages below).
- **Agents:** none. **DoD:** docs committed; no feature/DB/deploy changes.

---

## Phase 1 — MVP foundation (R1, R7, R8 core, R3) — agent detail

**Goal:** Staff/admin sign in and run the existing portfolio screens against Supabase with RLS; every property has a landlord; open D1 API is no longer the product path.

### Phase 1 dependency graph

```mermaid
flowchart LR
  BE1[BE_P1a_schema_RLS] --> BE2[BE_P1b_typegen_admin]
  BE1 --> FE1[FE_P1a_auth_shell]
  BE2 --> FE2[FE_P1b_data_layer]
  FE1 --> FE2
  FE2 --> FE3[FE_P1c_landlords_CRUD]
  FE2 --> QA1[QA_P1_verify]
  FE3 --> QA1
```

### Agent packages (spawn these workers)

**1. BE — P1a Schema & RLS freeze** (starts first; blocks FE data work)
- **Branch:** `cursor/phase1-supabase-rls-8ed9`
- **Tasks:**
  - Add `supabase/migrations/` to this repo mirroring live project; migration for `account_status` on `user_roles` (or `profiles`) with values `pending | approved | rejected | suspended` (Phase 2 will enforce UI; Phase 1 may treat missing status as approved for bootstrap admin only — document choice in migration comments).
  - Add RLS policies for `Leases`, `LeaseTenants`, `RentCharges`, `Payments`, `Vendors`, `Settings` (admin/staff/landlord scoped using existing `private.*` helpers).
  - Confirm `handle_new_user` / `assign_admin`; document how to bootstrap first admin.
  - Do **not** change maintenance photo policies except as needed for staff admin path.
- **Files:** `supabase/migrations/*`, `docs/supabase-schema.md` update.
- **Acceptance:** Advisors no longer flag those tables as RLS-with-no-policy; SQL policy tests for admin vs landlord vs anon.
- **Handoff to FE:** published column map D1→Supabase + typegen file.

**2. FE — P1a Auth shell** (parallel with BE P1a after env vars known)
- **Branch:** `cursor/phase1-auth-ui-8ed9` (stack on BE when integrating, or land independently if using mocks)
- **Tasks:**
  - Add `@supabase/supabase-js`; `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`.
  - Screens: login, logout, password reset request/confirm, session restore.
  - App shell: unauthenticated → login; authenticated but no `user_roles` → blocked message; role `admin` or staff-linked → existing nav.
  - Branding pass: LG title already present; pull logo/colors from website assets where practical.
- **Files:** `src/client/lib/supabase.ts`, auth components, `app.tsx` gate, env example.
- **Acceptance:** Manual login/logout; refresh keeps session; anon never hits portfolio queries.
- **Does not:** swap CRUD to Supabase yet (that is FE P1b).

**3. BE — P1b Typegen & admin seed** (after P1a)
- Generate TS types from Supabase; commit types.
- Script or documented SQL to create first admin Auth user + `user_roles` + `Staff` row.
- **Acceptance:** FE can import types; admin seed steps work in a fresh Auth user.

**4. FE — P1b Data-layer cutover** (after BE P1a+P1b + FE P1a)
- **Branch:** `cursor/phase1-supabase-data-8ed9` (stack on auth + RLS)
- **Tasks:**
  - Replace `src/client/api.ts` / `use-app-state` Hono fetches with Supabase queries/mutations matching current screens (properties, units, tenants, leases, rent, work orders→`MaintenanceRequests`, vendors, settings, dashboard).
  - Mapping layer for field names (`name`→`property_name`, work order statuses ↔ `Open`/etc.).
  - Leave Hono/D1 in repo but unused by client **or** remove routes in same PR if safe; prefer “client no longer calls `/api`” as MVP cut.
- **Acceptance:** All existing staff screens read/write Supabase with signed-in admin; empty DB shows empty states (seed optional demo via `is_test_data`).

**5. FE — P1c Landlords** (after or late-parallel with P1b)
- Landlords list/detail/dialog; property create/edit **requires** `landlord_id`.
- **Acceptance:** Cannot save property without landlord; landlord appears on property detail.

**6. QA — P1 verify** (after FE P1b+P1c)
- Checklist: anon 401/empty; admin full CRUD; landlord role only sees own properties (create test landlord user); no secret key in client; typecheck/build green.
- Write results into `docs/phases/phase-1.md`.
- **Phase 1 DoD:** Staff/admin signed-in portal on Supabase with landlord-linked properties; D1 not required for those flows; QA checklist signed off.

**Phase 1 out of scope:** approval queue UI (Phase 2), tenant submit (Phase 3), website repo edits (Phase 4), documents, notifications.

---

## Phase 2 — Account approval + Applications UI (R2, R8)

**Detail plan:** [`docs/phases/phase-2.md`](phases/phase-2.md) (includes Phase 1 leftovers checklist).  
**Prerequisite:** surgical port of Nov 9 maintenance (`cursor/maintenance-work-orders-33a0`) onto `master` first.

**Agents:** BE (status enforcement + admin RPCs/policies) → FE (approval queue + Applications screens) → QA.

| Step | Agent | Work |
|------|-------|------|
| P2a | BE | Enforce `account_status`; **admin-only** update policies / `approve_user` RPC; email-verify + pending path |
| P2b | FE | Admin “Users” page: pending / approve / reject / suspend; signup → verify → pending |
| P2c | FE | Applications list/detail (rental applicants) — clearly labeled; not the approval queue |
| P2d | QA | Unverified/pending cannot load data; admin approve unlocks; reject/suspend stick; non-admin cannot change status |

**Parallel:** P2c Applications UI can run beside P2b once read policies exist.  
**DoD:** Pending users cannot use portal; **only admin** can approve; Applications UI separate from account approval.

---

## Phase 2.5 — Messaging (R9) — draft

**Agents:** BE (threads/messages tables + RLS) → FE (inbox + thread UI) → QA.

| Step | Agent | Work |
|------|-------|------|
| P2.5a | BE | `MessageThreads` / `Messages` (names TBD); participants staff↔tenant and staff↔landlord; RLS |
| P2.5b | FE | Inbox, thread view, compose; deep-link from tenant/landlord/maintenance context where useful |
| P2.5c | QA | No cross-thread leakage; maintenance comments remain separate |

**Start after:** Phase 2 admin approval (D).  
**DoD:** Staff can message tenants and landlords in-app with RLS.

---

## Phase 3 — Tenant maintenance + photos (R4, R7)

**Agents:** BE (status history if missing; storage path rules) ‖ FE (tenant route group + staff photo/category UX) → QA.

| Step | Agent | Work |
|------|-------|------|
| P3a | BE | Confirm tenant insert RLS; photo bucket policies; add `MaintenanceRequestStatusHistory` **or** document comment-based audit |
| P3b | FE | Tenant shell: submit request (category, description, permission_to_enter, photos); list own requests |
| P3c | FE | Staff maintenance UI: category, photos, comments (tenant_visible vs internal), status transitions via mapping layer |
| P3d | QA | Tenant cannot see other units; staff sees assigned/owned; photo upload/download works |

**DoD:** Tenant submits with photo; staff updates status with visible trail; comments respect visibility.

---

## Phase 4 — Website integration

**Agents:** WEB primary; FE only if portal needs return-URL/login branding; QA smoke on both hosts.

| Step | Agent | Work |
|------|-------|------|
| P4a | WEB | CTA in header/footer → `NEXT_PUBLIC_PORTAL_URL`; copy for “Staff / Tenant login” |
| P4b | FE | Login page accepts `?redirect=` / branded shell consistent with site |
| P4c | QA | From landlordgopher.com → portal login → session on shared Auth project |

**Start when:** Phase 1 portal URL + Auth env are stable (can overlap Phase 2).  
**DoD:** Marketing site links to live portal; shared Auth login works.

---

## Phase 5 — Property documents (R5)

**Agents:** BE (table + bucket + RLS) → FE (property/unit documents panel) → QA.

| Step | Agent | Work |
|------|-------|------|
| P5a | BE | `PropertyDocuments` + visibility enum `tenant`\|`staff`\|`landlord`; private bucket; **only admin** may set/change visibility; read policies by role |
| P5b | FE | Upload/list/download; admin visibility control; tenant sees only `tenant`-visible for their lease/unit |
| P5c | QA | Non-admin cannot change visibility; tenant cannot read staff/landlord-only docs; landlord scoped to own properties |

**DoD:** Docs attached with admin-controlled visibility; tenants can access tenant-visible docs.

---

## Phase 6 — Notifications (R6)

**Agents:** BE (trigger/Edge Function + email provider) → FE (in-app bell + soft permission popup) → QA.

| Step | Agent | Work |
|------|-------|------|
| P6a | BE | On MaintenanceRequests insert/status change → email staff where `gets_request_alerts`; secrets in host env |
| P6b | FE | In-app notification list; **soft browser/in-app permission popup** as a replaceable placeholder (no native push yet) |
| P6c | QA | Alert fires once per event; disabled flag respected; popup can be dismissed without breaking email/in-app |

**DoD:** Configurable staff email + in-app alerts; native/mobile push deferred; popup is swappable later.

---

## Coordinator runbook (next)

1. Land docs PR with locked decisions (this change).
2. Port Nov 9 maintenance onto `master` (admin-only Accept & schedule).
3. Phase 2 admin approval + signup/verify; then Applications UI.
4. Phase 2.5 messaging draft implementation.
5. Continue Phase 3 → 4 → 5 → 6 (push remains deferred / popup placeholder).

**Still useful (non-blocking):**
1. Portal host (Cloudflare Pages vs Vercel).
2. Email provider for Phase 6 (Resend vs Supabase) — recommend Resend.
3. Tenant UI in same SPA vs subdomain — recommend same SPA.
