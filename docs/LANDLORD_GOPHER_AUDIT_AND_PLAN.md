# Landlord Gopher — Audit and Implementation Plan

**Date:** 2026-11-14 · **Code audited:** `master` @ `e34e1ec` · **Status:** awaiting approval — no application code has been changed.

This document has two parts that are kept separate on purpose:

- **Part A — Audit findings** (what exists, what works, what does not). Read-only record.
- **Part B — Implementation checklist** (what to do about it). Tick items off during implementation.

---

# Part A — Audit findings

## A1. Executive summary

**Overall health.** The foundation is sound and the product shape is wrong. Authentication, account approval, database access rules, photo and document storage, and the maintenance request lifecycle are implemented carefully and are well tested. But the application is still organized as the property-management template it was adapted from (properties → leases → rent ledger), with maintenance added as one module among many. The two things that make Landlord Gopher a *communication* platform — messaging and notifications — do not exist.

**Answer to "is it organized around actual needs?"** No. The admin sees eleven navigation items, and five of them (Leases, Rent, Rental applications, Settings → Rent policy, and the rent half of the Dashboard) belong to a property-management and accounting product that is explicitly out of scope. On the live database those modules hold zero rows. Meanwhile tenants and landlords have almost nothing: a tenant's sidebar shows a single link ("Documents"), and a landlord can look but cannot say anything.

**Biggest issues**

1. **Password reset is broken for tenants, landlords and maintenance workers.** The reset link signs the person in and sends them to their home screen without ever showing the new-password form (finding F-01).
2. **A suspended maintenance worker can still read tenant records.** Several database access helpers do not check that the account is approved, so a worker who has been suspended keeps read access to the units, properties, landlords and full tenant records (including date of birth and income) of every job they were ever assigned (F-17).
3. **No messaging beyond a comment box on a request.** There is no property- or unit-level conversation, landlords cannot post anything anywhere, and comments show a role ("maintenance") instead of a name (F-02).
4. **No notifications of any kind** — no email, no push, no in-app unread indicator. Nobody learns that a request was submitted, assigned, updated or answered unless they open the portal and look (F-03).
5. **Onboarding a person requires the SQL editor or the lease module.** There is no screen to add a maintenance worker; a tenant can only be attached to a unit by creating a lease; and anyone who signs up with an unknown email is filed as a pending *maintenance worker* (F-06).
6. **The admin experience is a property-management back office, not an operations view.** The dashboard leads with occupancy and rent; it does not show pending approvals, unassigned requests, upcoming visits or recent activity, and its request rows are not clickable (F-08, F-09).

**Top five recommended improvements**

1. Fix password reset, close the suspended-account access gap, and run the browser tests in CI so regressions like these are caught (all small).
2. Build the communication layer: request conversations that include the landlord and show names; one conversation per unit (tenant ↔ Landlord Gopher) and per property (landlord ↔ Landlord Gopher); in-app and email notifications.
3. Hide leasing, rent, rental applications and rent policy; rebuild the admin navigation and dashboard around maintenance, approvals, messages and documents.
4. Make onboarding possible entirely from the portal: staff management, unit picker on the tenant record, and a signup form that says who the person is.
5. Turn the request detail from a 1,580-pixel modal form into a page with a summary, a single timeline, and role-appropriate actions; use one set of status names everywhere.

**Answer to "what is the smallest set of changes?"** Keep the database, security model, storage, approval flow and maintenance lifecycle as they are. Fix two defects, add two tables' worth of messaging and one of notifications, hide four screens, and reshape three (navigation, dashboard, request detail). Nothing needs to be rebuilt, and no existing data needs to be deleted. Part B sequences this.

## A2. How this was verified

| Method | What was done | Result |
|---|---|---|
| Code reading | `src/client/**`, all 38 files in `supabase/migrations/`, `docs/**`, `tests/**` | — |
| Automated tests | `pnpm typecheck`, `pnpm test` | Typecheck clean; 339 passed, 10 planned-only (all notifications) |
| Browser tests | `pnpm test:browser` (Chromium, local emulator) | 23 passed, 3 failed (see F-15) |
| Manual browser run | Every route as admin, worker, tenant, landlord, pending user at 1280 px; key routes at 390 px; a full request lifecycle; signup; password reset | Findings below cite this as "browser run" |
| Access-rule probes | Signed in as each role against the local emulator and attempted reads and writes directly, including after suspension | Cited as "probe" |
| Live Supabase (read-only) | Tables, row counts, policies, functions, triggers, storage buckets, edge functions, migrations, security advisors on project `bgjkjtfgrfiszbzatriq` | No data was modified |

**Not verified:** live Auth dashboard settings (email confirmation requirement, SMTP sender, redirect URLs) cannot be read with the available tools; real email delivery; the admin password-reset path (expected to work from the code, not run); behaviour on a deployed URL (the portal is not hosted yet).

**Live data today** (exact counts): 31 properties, 80 units, 66 tenants (all with a unit and an email), 14 landlords, 14 staff, 24 maintenance requests (23 flagged as test data), 3 vendors, 4 settings rows, 4 login accounts (one per role). Zero leases, rent charges, payments, rental applications, property documents and request comments. The application is pre-launch, so restructuring now is cheap.

## A3. Findings

Each finding is **Confirmed** (reproduced or read directly from code/database), or marked otherwise.

### Broken

**F-01 — Password reset fails for three of four roles.** Confirmed (browser run as a tenant; the repository's own browser test fails the same way as a worker; landlord by code reading).
The emailed link opens `/reset-password` with a signed-in recovery session. The post-login landing step (`src/client/app.tsx`, the `resolveReadyLanding` effect) treats `/reset-password` as a route the role is not allowed to see and replaces it with the role's home (`clampPathForAudience`, `src/client/lib/safe-redirect.ts:67-79`). The new-password form (`ResetConfirmPage`) is only rendered while the path is still `/reset-password`, so it never appears. The person is signed in with their old password unchanged and no explanation. Admins are not clamped, so they are unaffected. The regression was not caught because CI runs `pnpm test` only, not the browser suite.

**F-17 — Suspended accounts keep some read access.** Confirmed (probe on the local emulator, which runs the same migrations; the same function definitions are present on the live database).
Six helper functions — `private.staff_assigned_to_unit`, `staff_assigned_to_property`, `staff_can_see_tenant`, `staff_can_see_landlord`, `tenant_can_see_landlord`, `tenant_can_see_staff` — read the caller's link straight from `user_roles` without checking `account_status` or role. The landlord equivalents were hardened in `20261114030000_harden_landlord_helpers_and_mr_notes.sql`; these were not. Result of the probe after an admin suspended each account:

| Account | Still readable after suspension |
|---|---|
| Maintenance worker with one assigned request | The unit, the property, the landlord record and the **full tenant record** for that request |
| Tenant | Their landlord's record and staff records of workers on their requests |

Requests, photos, comments, documents and leases were correctly refused. Pending and rejected accounts that are already linked to a record go through the same functions, so the same applies to them — for example a tenant who has signed up but not yet been approved, since signup links by email automatically (same code path; not run separately). The exposure is read-only and limited to records tied to past assignments, but the tenant record includes email, phone, date of birth, emergency contact, employer and monthly income.

Related, and by design today rather than a bug: an *approved* worker or landlord also receives that full tenant record, because access rules work on whole rows. Neither needs more than a name and a phone number (see F-13).

### Missing

**F-02 — Messaging.** Confirmed.
- Request-level: `MaintenanceRequestComments` exists with two visibilities, `tenant_visible` and `internal`. Tenant ↔ staff works end to end (browser run). Landlords can read tenant-visible comments but the database refuses a landlord post (probe: "violates row-level security policy"), and the UI hides the box for them.
- Property/unit-level: nothing. No table, no screen. Tenants cannot contact Landlord Gopher about their unit outside a request; landlords cannot contact Landlord Gopher at all.
- Comments display the author's role, not a name (browser run: "maintenance", "tenant").
- A worker's comment defaults to "Internal" (browser run), so an update meant for the tenant is easy to post where the tenant never sees it.
- No live update: a reply appears only after closing and reopening the request.
- This was deferred by a recorded product decision on 2026-11-13 (`docs/phases/phase-6.md`). The requirements given for this audit reopen it.

**F-03 — Notifications.** Confirmed. The live project has no edge functions, no `pg_net`/`pg_cron` extension, and no trigger that sends anything. `Staff.gets_request_alerts` exists as a column and nothing reads it. All ten notification tests are placeholders (`tests/requirements/r6-notifications.test.ts`). The only emails the system sends are Supabase Auth's own signup-confirmation and reset links. There is no approval email, so an approved user is never told they can now sign in. There is no unread badge or notification list in the app.

**F-04 — Account management.** Confirmed. No profile or account screen exists for any role: no way to change a password while signed in, edit a name or phone number, or set notification preferences. The header shows the email address and a sign-out button only.

### Gaps in existing features

**F-05 — Who can see and create requests.** Confirmed by probe and policy text (`maintenance_requests_select`, `maintenance_requests_insert_*`).
- A tenant sees only requests they personally submitted. A request an admin logs for that tenant's unit (a phone call, say) is invisible to the tenant, because the admin "New work order" form has no tenant field and leaves `submitted_by_tenant_id` empty.
- A landlord sees requests through the unit. A property-level request with no unit (allowed by the table) is invisible to the property's landlord.
- A landlord cannot submit a request (database refuses; no button).
- Live data has no affected rows yet (every request has both a unit and a submitting tenant).

**F-06 — Onboarding depends on SQL and on the lease module.** Confirmed.
- **No staff screen.** `src/client/lib/data.ts` has `listStaff` only. Approving a maintenance account requires a Staff link, and a Staff row can only be created in the SQL editor.
- **Tenant → unit only through a lease.** The tenant form (`components/tenants/tenant-dialog.tsx`) has no unit field; `Tenants.unit_id` is set as a side effect of saving a lease. The 66 live tenants got their units from the original data import, not from this screen. Already listed in `docs/deferred-work.md`.
- **Unknown signups become "maintenance".** `private.handle_new_user` assigns role `maintenance` (pending, unlinked) to any email that matches no Landlord, Tenant or Staff row (browser run: a brand-new signup appears in Users as "role: maintenance"). They cannot get in — approval needs a Staff link — but the admin must notice and correct the role.
- **The signup form collects email and password only.** The admin sees an email address in the approval queue and nothing else: no name, no stated role, no address.

**F-07 — Status names differ from the requirement, and from each other.** Confirmed. The database and staff screens use Open / Scheduled / In Progress / On Hold / Closed. The requirement is New / Assigned / In Progress / Completed. The mapping is one-to-one apart from On Hold (Scheduled already requires an assignee and a date). An owner decision on 2026-11-14 kept the five names. Within the app the tenant's list says "Submitted", the tenant's detail view says "Open" (`work-order-tenant-detail.tsx:37`), and the status history prints raw database values ("Open → Scheduled").

**F-08 — Navigation does not match the product.** Confirmed (browser run; `src/client/app.tsx:36-74`).
- Admin: Properties, Landlords, Tenants, Leases · Rent, Maintenance, Calendar · Users, Rental applications, Settings. Maintenance is sixth; messages and documents are absent.
- The navigation component (`AppNav` from the `@clawnify/app` template package) hides each role's home item and attaches it to the product title instead. So a tenant's sidebar is one link, "Documents"; a worker's is "Calendar"; a landlord's is "Maintenance, Documents". The only way back to the home screen is to click the title text.
- On a phone the sidebar becomes a horizontally scrolling strip; for the admin most items are off-screen.
- `/documents` is a blank page for admins — the route is recognised but nothing renders for the staff shell.

**F-09 — The admin dashboard is a leasing dashboard.** Confirmed (`components/dashboard/dashboard-page.tsx`). Four headline numbers: occupancy, active leases, outstanding rent, open work orders. Then portfolio counts, this month's rent, open work orders, lease expirations. Missing: accounts awaiting approval, new/unassigned requests, urgent requests, on-hold follow-ups due, upcoming visits, recent activity, unread messages. The open-work-order rows do nothing when clicked (browser run).

**F-10 — Request detail is a long modal form.** Confirmed (browser run).
- Admin: 1,580 px of scrolling content and 16 inputs. Order: accept-and-schedule panel, then title, property, unit, description, category, priority, status, vendor, permission, cost, notes — and only then photos, status history and comments.
- Tenant/landlord: their own request shown as greyed-out form inputs. Neither the assigned person nor the scheduled date appears in the detail view.
- No shareable address for a request for tenants and landlords (staff have `?wo=`), which notification links will need.

**F-11 — Calendar.** Confirmed (`components/calendar/calendar-page.tsx`, `lib/calendar-events.ts`). A read-only month grid built from six date sources: request scheduled date, request follow-up date, lease start, lease end, rent due, application move-in. Only the first two relate to maintenance, and the scheduled value is a date without a time. There is no scheduling workflow behind it beyond "accept and schedule" on a request. As a full page it is mostly empty; the useful content is a short "what is coming up" list.

**F-12 — Settings and "Rent policy".** Confirmed (`components/settings/settings-page.tsx`). Settings has exactly two tabs:
- **Vendors** — a directory of outside trades (name, category, phone, email, colour) used by the "Vendor" field on a request. Three live rows; three live requests reference a vendor. Useful, misplaced.
- **Rent policy** — default rent due day, late fee, grace days and currency. These are defaults applied when a *lease* is created, plus the currency symbol. This is what the "Rental Policy" screen is. It has no connection to maintenance. Four live rows (the four defaults).

Nothing in Settings concerns how Landlord Gopher actually operates (who is alerted about new requests, categories, account preferences).

**F-13 — Maintenance workers can read more than their jobs.** Confirmed from policy text.
- `private.can_manage_property_documents()` is "staff or admin", and `can_select_property_document` returns true for any staff member. Any approved maintenance worker can read, upload and delete documents for every property, including leases shared with tenants.
- `leases_select`, `rent_charges_select` and `payments_select` include `staff_assigned_to_unit`, which is true for any unit the worker was ever assigned a request on, with no end date. A worker can read lease and rent data for those units.
- Not exploitable by outsiders, and currently harmless (zero rows in all four tables), but wider than the requirement ("Admins can upload documents") and wider than a worker needs.

**F-14 — Accessibility and small-screen basics.** Confirmed by code search and browser run. Clickable cards (requests, properties) are plain containers with a click handler — no keyboard focus, no button or link role anywhere in `components/`. Dropdowns have no accessible name (the test helpers work around this). Read-only information is shown as disabled inputs, which screen readers skip and which have low contrast. None of the pages checked at 390 px had horizontal overflow.

### Tests and tooling

**F-15 — Browser test failures.** Confirmed.
1. `forgot password…` — real defect (F-01).
2. `an admin sees the dashboard and every section` — stale expectation; the list predates the Calendar link.
3. `an admin adds a property` — the property *is* created; the assertion matches two elements. Test defect.

CI (`.github/workflows/ci.yml`) runs typecheck, build and `pnpm test` only.

**F-16 — Code organisation.** Confirmed; these are maintainability notes, not defects.
- `src/client/lib/data.ts` is one 2,423-line file covering every domain.
- Roughly 2,200 of about 14,400 client lines implement leases, the rent ledger and rental applications.
- Status and priority badge styling is defined separately in the dashboard, maintenance and property pages.
- Declared but never imported: `hono`, `zod`, `@phosphor-icons/react`, `@radix-ui/react-popover`. `@clawnify/app` is used only for the navigation component that causes F-08.
- `README.md` still presents the "OpenProperty" template and lists rent features first.
- No placeholder or mock data was found; every screen reads from Supabase.

### What is in good shape

- Row-level security is enabled on all 21 public tables; live policies match the repository apart from three documented website-related migrations (`docs/ops/schema-migrations.md` §D).
- The core access helpers (`current_role`, `current_*_id`, `is_admin`, `is_staff_or_admin`) require `account_status = 'approved'`, so suspension immediately removes access to requests, photos, comments, documents and all writes. Six secondary helpers do not (F-17).
- Maintenance photos and property documents are in private buckets; storage paths are bound to database rows; a trigger enforces the five-photo limit; documents have a file-type allow-list and download as attachments.
- Status history is written by a trigger and cannot be edited.
- Admin-only functions check `is_admin()` internally (confirmed for all five); the Supabase advisor warning about them is expected.
- Approval requires a confirmed email; the last approved admin cannot be demoted or suspended.
- Supabase advisor: one actionable warning — leaked-password protection is off (owner toggle, already documented in `docs/ops/auth-password-policy.md`).

## A4. Screen inventory

"Works" means exercised in the browser run or covered by a passing browser test. All screens use live Supabase data; none use mock data.

| # | Screen (route) | Role(s) | Purpose | Works? | In scope? | Disposition |
|---|---|---|---|---|---|---|
| 1 | Sign in / sign up (`/`) | All | Email + password login and registration | Yes | Yes | **Improve** — collect name and tenant/landlord on signup (F-06) |
| 2 | Forgot password / new password (`/reset-password`) | All | Reset by email link | **Broken** for tenant, landlord, worker (F-01) | Yes | **Improve** (fix) |
| 3 | Blocked pages (pending, rejected, suspended, no role, no link) | All | Explain why access is denied | Yes | Yes | **Keep**; reword "run private.assign_admin" text shown to end users |
| 4 | Dashboard (`/dashboard`) | Admin | Portfolio, rent and work-order snapshot | Loads; rows not clickable | Partly | **Improve** — rebuild as operations view (F-09) |
| 5 | Properties list (`/properties`) | Admin, landlord | Property cards with occupancy | Yes | Yes | **Keep** |
| 6 | Property page (`/properties/:id`) | Admin, landlord | Units, requests, documents for one property | Yes | Yes | **Improve** — show tenant per unit, open-request count per unit, messages |
| 7 | Property and unit dialogs | Admin | Create/edit property and unit | Yes | Yes | **Keep** |
| 8 | Landlords (`/landlords`) | Admin | Landlord records | Yes | Yes | **Consolidate** into People |
| 9 | Tenants list and page (`/tenants`, `/tenants/:id`) | Admin | Tenant records, lease history | Yes | Yes (minus lease, income, employer) | **Consolidate** into People; add unit picker |
| 10 | Leases (`/leases`) | Admin | Lease records and terms | Yes | **No** | **Remove from navigation** (hide; keep data) |
| 11 | Rent ledger (`/rent`) and payment dialog | Admin | Monthly charges, payments | Yes | **No** | **Remove from navigation** (hide; keep data) |
| 12 | Maintenance (`/maintenance`) — staff view | Admin, worker | Request queue with status tabs | Yes | Yes | **Improve** — filters by property/assignee, list density |
| 13 | Maintenance — tenant view ("My requests") | Tenant | Own requests, submit new | Yes | Yes | **Improve** — becomes part of tenant Home |
| 14 | Maintenance — landlord view | Landlord | Read-only requests on own units | Yes | Yes | **Improve** — include property-level requests; allow submit if approved (F-05) |
| 15 | Tenant submit dialog | Tenant | Title, category, description, emergency, permission, ≤5 photos | Yes | Yes | **Keep**; full-screen on phones |
| 16 | Work order dialog (staff) | Admin, worker | Edit, assign and schedule, status, cost, notes, photos, history, comments | Yes | Yes | **Improve** — becomes request detail page (F-10) |
| 17 | Request details dialog (viewer) | Tenant, landlord | Read-only request, photos, history, comments | Yes; landlord cannot post | Yes | **Improve** — same page, role-specific |
| 18 | Calendar (`/calendar`) | Admin, worker | Read-only month of dated items | Yes | Partly | **Consolidate** into dashboard "Upcoming" (F-11) |
| 19 | Documents (`/documents`) — tenant | Tenant | List and download shared documents | Yes | Yes | **Keep** |
| 20 | Documents (`/documents`) — landlord | Landlord | List and download shared documents | Yes | Yes | **Keep** |
| 21 | Documents (`/documents`) — admin | Admin | — | **Blank page** | Yes | **Build** admin documents page |
| 22 | Property documents panel (on property page) | Admin | Upload, set visibility, delete | Yes | Yes | **Keep** |
| 23 | Users (`/users`) | Admin | Approval queue, role and record linking, suspend | Yes | Yes | **Improve** and move into People; show who the person is |
| 24 | Rental applications (`/applications`) | Admin | Applicant records with income | Yes | **No** | **Remove from navigation** (hide; keep data) |
| 25 | Settings → Vendors | Admin | Outside trades directory | Yes | Yes (supporting) | **Consolidate** under Maintenance or People |
| 26 | Settings → Rent policy | Admin | Lease defaults, currency | Yes | **No** | **Remove from navigation** (hide; keep data) |
| 27 | Messages | All | — | Does not exist | Yes | **Build** |
| 28 | Notifications (list, badges) | All | — | Does not exist | Yes | **Build** |
| 29 | Account / profile | All | — | Does not exist | Yes | **Build** |
| 30 | Team (staff records) | Admin | — | Does not exist | Yes | **Build** |

## A5. Requirements traceability

Status key: **Complete** (implemented and verified), **Partial**, **Missing**, **Broken**, **Unverified**.

| Requirement | Status | Evidence |
|---|---|---|
| **Authentication and accounts** | | |
| Email/password registration and login | Complete | `use-auth.ts`; R1 tests (19 pass); browser run |
| Email verification | Partial | Approval refuses unconfirmed email (`set_account_status`; R2 tests). Whether live Auth *requires* confirmation before sign-in is Unverified (dashboard setting) |
| Password reset | **Broken** | F-01 |
| Logout | Complete | Browser run |
| Three roles: tenant, landlord, admin | Complete | `app_role` enum also has a fourth value, `maintenance` |
| Account management (tenant item 1) | Missing | F-04 |
| **Account approval** | | |
| New accounts start pending | Complete | `handle_new_user`; browser run. Unknown emails default to the wrong role (F-06) |
| Admin approve / reject / suspend | Complete | `set_account_status`, `users-page.tsx`; R2 tests (27 pass); browser tests pass |
| Unapproved users have no access | Partial | The app gate blocks every unapproved account, and RLS blocks requests, photos, comments, documents and all writes (R2 and R7 tests; browser run). A non-approved account that is linked to a staff or tenant record keeps limited read access to related records (F-17) |
| **Properties and units** | | |
| Admin creates properties and units | Complete | R3 tests (41 pass); browser run |
| Admin associates tenants and landlords | Partial | Landlord → property works. Tenant → unit only via lease; staff records only via SQL (F-06) |
| Users see only authorised properties/units | Complete | R3 and R7 tests; probe. See F-13 for worker breadth |
| **Maintenance requests** | | |
| Tenant creates with description, category, ≤5 photos | Complete | Browser run; R4 tests (52 pass); DB trigger caps photos |
| New → Assigned → In Progress → Completed | Partial | Lifecycle works under different names plus On Hold (F-07) |
| Visible status history | Complete | Trigger-written, append-only, shown to all roles; shows raw values |
| Authorised users can track requests | Partial | F-05 (admin-logged requests hidden from tenant; property-level hidden from landlord) |
| Conversations stay with the request | Partial | Tenant ↔ staff works; landlord cannot post; no names (F-02) |
| Landlord submits requests | Missing | F-05 |
| **Property documents** | | |
| Admin uploads for property or unit | Complete | R5 tests (28 pass); browser tests pass |
| Tenants and landlords view relevant documents | Complete | R5 tests; browser tests pass |
| **Notifications** | | |
| Email — approvals, new requests, status changes, messages | Missing | F-03 |
| Push — same events | Missing | F-03; no mobile app in this repository |
| **Messaging** | | |
| Tenant ↔ Landlord Gopher about their unit | Missing | F-02 |
| Landlord ↔ Landlord Gopher about property/unit/request | Missing | F-02 |
| Maintenance person in request conversation | Partial | Can post; defaults to internal; shown as "maintenance" |
| **Permissions and security** | | |
| Database-level access controls | Complete | RLS on all tables; R7 tests (44 pass); live policies inspected |
| Tenant / landlord / admin scoping | Complete | R7 tests; probe. Tenant personal details are over-shared with workers and landlords (F-17, F-13) |
| Documents, messages, photos follow restrictions | Complete for what exists | Storage policies bound to rows; R4/R5 tests. Messaging not built. Worker breadth: F-13 |
| **Admin web portal** | | |
| Manage users and approvals | Complete | Users page |
| Manage properties and units | Complete | Properties pages |
| Manage maintenance requests | Complete | Maintenance page and dialog |
| Manage messages | Missing | F-02 |
| Manage documents | Partial | Per property only; `/documents` blank for admin (F-08) |
| Monitor operational activity | Partial | F-09 |
| Operational calendar on the dashboard | Partial | Separate page (F-11) |

## A6. UX and information architecture

### Current state by role

| Role | Lands on | Sidebar shows | Main problem |
|---|---|---|---|
| Tenant | My requests | Documents | No visible "home" link; no messages; no account; detail view is a disabled form |
| Landlord | Properties | Maintenance, Documents | Entirely read-only; no way to contact Landlord Gopher; "Read-only" badge is the only explanation |
| Worker | Assigned jobs | Calendar | Comment default hides updates from tenants; staff tabs designed for an admin queue |
| Admin | Dashboard | 10 links in 3 groups | Half are out of scope; maintenance is buried; no approvals or messages signal |

### Proposed navigation

Every role gets a visible Home link, the same shell, and an account menu (profile, notification preferences, sign out) in the header. On phones, tenants, landlords and workers get a bottom tab bar instead of the scrolling strip.

| Role | Navigation | Lands on |
|---|---|---|
| **Tenant** | Home · Requests · Messages · Documents | Home |
| **Landlord** | Home · Properties · Maintenance · Messages · Documents | Home |
| **Worker** | My jobs · Messages | My jobs |
| **Admin** | Dashboard · Maintenance · Properties · People · Messages · Documents | Dashboard |

Admin **People** has tabs: Approvals (with a count badge that is also shown on the nav item) · Tenants · Landlords · Team · Vendors. This replaces Landlords, Tenants, Users and Settings → Vendors as four separate destinations.

Labels differ from the starting list in two places, both for the same reason: "Submit Request" is an action, not a place, so it is the primary button on the tenant's Home and Requests screens rather than a nav item; and "Users & Approvals" becomes "People" because approving a person and maintaining their tenant, landlord or staff record are one job that currently spans four screens.

### Screen descriptions

**Admin — Dashboard**
- Row 1, "Needs attention" — four counters that each open a filtered list: accounts awaiting approval · new requests not yet assigned · urgent open requests · unread messages.
- Row 2, two columns. Left, "Open requests" — the ten most pressing (urgent first, then oldest), each row showing title, unit, status, assignee and age; clicking opens the request. Right, "Upcoming" — the next 14 days of scheduled visits and on-hold follow-ups grouped by day; this replaces the calendar page.
- Row 3, "Recent activity" — a single feed of status changes, new requests, messages, approvals and document uploads, newest first.
- Footer strip: properties, units, occupied, vacant.
- No rent or lease content.

**Request detail** (`/maintenance/:id`, same page for every role)
- Header: request number, title, status, priority; unit and property; submitted by and when.
- Summary block (plain text, not inputs): category, description, permission to enter, assigned to, scheduled for.
- Photos.
- One **timeline**, oldest to newest, interleaving status changes and messages, each with the person's name. Message box at the bottom.
- Actions panel, by role:
  - Admin: assign and schedule; change status (with the required companion field for on hold and completed); vendor; cost; internal note; edit request; delete.
  - Worker: start work, put on hold, complete; cost; internal note. Messages go to the tenant by default; an "internal only" switch is the exception.
  - Tenant: add photos; send a message.
  - Landlord: send a message to Landlord Gopher.

**Tenant — Home**
- Unit card: unit, property, address.
- Primary button: "Report a problem".
- "Your open requests" — up to three, each with status and next step ("Scheduled for Tuesday with Sam").
- "Messages" — latest message from Landlord Gopher with an unread marker.
- "Documents" — the two most recent, with a link to all.

**Landlord — Home**
- One card per property: units, occupied/vacant, open requests, last activity.
- "Maintenance activity" — recent requests across all properties with status.
- "Messages" — latest per property.

**Messages** (all roles)
- Left: conversation list. Tenant sees one ("Landlord Gopher — Unit 1A") plus any request conversations with activity. Landlord sees one per property. Admin sees all, filterable by property and by unread.
- Right: the conversation, with the property/unit shown in its header and, for request conversations, a link to the request.

### Property-level versus request-level messaging

| | Request conversation | Unit / property conversation |
|---|---|---|
| Purpose | Getting one specific job done | Everything else: access, questions, follow-ups |
| Lives | On the request timeline | Under Messages |
| Tenant side | Tenant, Landlord Gopher, the assigned worker | Tenant and Landlord Gopher only |
| Landlord side | Landlord and Landlord Gopher only (see decision Q4) | Landlord and Landlord Gopher only |
| Ends | When the request is completed (read-only afterwards) | Never |
| Admin view | In the request, and listed under Messages | Under Messages |

## A7. Maintenance personnel

**How it works today.** A fourth role, `maintenance`, already exists in the database enum, the access rules and the app. A worker is a login linked to a `Staff` row. They see only requests assigned to them, can change status (but not to Scheduled), record cost, resolution and internal notes, add photos, and post comments. They cannot reassign, reschedule, create or delete. They have their own short navigation. This is tested (`tests/workflows/wf1-maintenance-lifecycle.test.ts`, browser lifecycle test).

**Recommendation: keep it; do not add anything new.** A restricted login is the only way a worker can take part in a request conversation securely, and it is already built. What is needed is to finish it:

- A Team screen so staff can be added without SQL (F-06).
- Messages default to the tenant, with names shown (F-02).
- Narrow what a worker can read to their jobs (F-13).

**Product and security implications**

- A worker needs the tenant's name, phone number and unit address for assigned jobs. Today they receive the tenant's whole record (F-17); that should be narrowed.
- A worker keeps read access to jobs after completion. Acceptable (they may be called back); can be time-limited later.
- Outside vendors (the Vendors directory) have no login. An admin relays for them. Giving one-off contractors a login is a product decision (Q3), not a technical limitation.

## A8. Technical assessment

| Area | Assessment | Type |
|---|---|---|
| Architecture | Single-page React app talking directly to Supabase; all rules in Postgres. Appropriate for this product; no backend service needed except for sending email | Sound |
| Route protection | Role decided from `user_roles` at sign-in; per-role route allow-lists; RLS is the real control | Sound; causes F-01 at one edge |
| Account approval | `set_account_status`, `admin_set_user_role` with link, email and last-admin checks | Sound |
| RLS | Complete coverage; helpers are `SECURITY DEFINER` with empty `search_path` | Sound design; **defect F-17** (six helpers skip the approval check); F-13 is over-broad for workers |
| Property/unit relationships | Property → landlord direct; tenant → unit via `Tenants.unit_id` kept in step with leases by client code | Works; F-06 |
| Request lifecycle | CHECK constraints enforce companion fields per status; protect trigger limits what non-admins change | Sound |
| Message threading | Comments keyed to request with visibility; no participant model beyond role | Partial (F-02) |
| Documents and photos | Private buckets, row-bound paths, signed URLs, type allow-list, size limits | Sound |
| Notifications | None | Missing (F-03) |
| Error handling | Errors surface as a banner; partial failures (photo upload after create) are reported honestly | Adequate |
| Validation | Mostly in the database; forms validate required fields only; `zod` installed but unused | Adequate |
| Data access pattern | One large module; lists re-fetched after writes | Preference at this scale, not a defect |
| Dead or unused | Four unused packages; template navigation package; `archive/` (already quarantined); template README | Cleanup (F-16) |
| Tests | Strong data-layer and access-rule coverage; browser suite exists but is not in CI and has three failures | Gap (F-15) |
| Environments | One Supabase project for everything; staging branch proposed and paused (`docs/ops/schema-migrations.md`) | Risk for the migrations in Part B |

## A9. Feature disposition matrix

| Feature | Decision | Reason | Dependencies and data implications |
|---|---|---|---|
| Login, signup, approval gate | Keep | Required and working | — |
| Password reset | Improve | Broken (F-01) | None |
| Signup form | Improve | Admin cannot tell who signed up (F-06) | Extra fields are display-only; never used for authorisation |
| Users / approvals | Improve + Consolidate | Core, but split from the records it links | Becomes the Approvals tab of People |
| Properties and units | Keep | Required and working | — |
| Landlord records | Consolidate | Required; does not need its own nav item | 14 live rows unaffected |
| Tenant records | Consolidate + Improve | Required; needs unit picker | 66 live rows unaffected. Income, employer and date-of-birth fields are not needed for maintenance — hide, do not drop |
| Staff records (Team) | Build | Cannot onboard a worker without SQL | 14 live rows exist already |
| Maintenance queue | Improve | Core; needs filters and a real detail page | — |
| Tenant request submission | Keep | Works well | — |
| Request detail | Improve | F-10 | Reuses existing panels |
| Status history | Keep | Works | Display names only (F-07) |
| Request comments | Improve | Becomes the request conversation | 0 live rows. Visibility values extended, not replaced |
| Unit / property conversations | Build | Required, absent | New tables |
| Notifications (in-app, email) | Build | Required, absent | New table, one edge function, an email provider |
| Push notifications | Clarify | No mobile app exists (Q7) | — |
| Account / profile | Build | Required, absent | — |
| Property documents (per property) | Keep | Works | — |
| Admin documents page | Build | `/documents` is blank for admins | Reuses existing list and upload code |
| Calendar page | Consolidate | Only two of six sources are in scope; little content | No data. Worker loses the page but gains dates on the job list |
| Dashboard | Improve | F-09 | Rent queries removed from the page |
| Vendors | Consolidate | Supporting directory, wrong home | 3 live rows; 3 requests reference them. Keep table and field |
| **Rent policy** | Remove (hide) | Lease defaults and currency only; unrelated to maintenance | 4 live rows. Keep the `Settings` table; the app already falls back to USD when it cannot read it |
| **Leases** | Remove (hide) | Out of scope | 0 live rows. Keep tables: tenant → unit sync code references them, and RLS policies on other tables join through `Leases`. Do **not** drop |
| **Rent ledger and payments** | Remove (hide) | Accounting; out of scope | 0 live rows. Keep tables and RPCs |
| **Rental applications** | Remove (hide) | Applicant screening; out of scope; holds income data | 0 live rows. Keep table (admin-only RLS) |
| Settings page | Remove | Nothing left in it after the two moves above | — |
| Landlord request submission | Clarify | Listed as "if appropriate" (Q5) | New insert policy |
| Co-tenant visibility | Clarify | Affects access rules (Q6) | — |
| Unit listings and `inquiries` | Keep (not portal) | Website features sharing the database | Leave untouched |

"Remove (hide)" means: take the screen out of navigation and routing behind a single configuration switch, leave the code and all database objects in place, and delete the code only after a release cycle confirms nobody needs it.

## A10. Future state — the ten questions

1. **What does each user see after login?** Tenant: Home with their unit, a "Report a problem" button, open requests and latest message. Landlord: Home with a card per property and recent maintenance activity. Worker: My jobs, ordered by scheduled date. Admin: the operations dashboard.
2. **Their most important actions?**
   - Tenant: report a problem · check a request · message Landlord Gopher · open a document.
   - Landlord: check a property · follow a request · message Landlord Gopher · open a document.
   - Worker: see today's jobs · start/complete a job · message the tenant.
   - Admin: approve accounts · assign and schedule new requests · reply to messages · upload a document · add a property, unit or person.
3. **Navigation per role?** See A6.
4. **Screens removed?** Leases, Rent, Rental applications, Settings (rent policy) — hidden, not deleted.
5. **Screens combined?** Landlords + Tenants + Users + Vendors → People. Calendar → dashboard "Upcoming". Tenant "My requests" list → also summarised on Home. Work order dialog + request details dialog → one request page.
6. **Home dashboard content?** See A6, Admin — Dashboard.
7. **Request detail content?** See A6, Request detail.
8. **Property-level versus request-level messaging?** See the comparison table in A6.
9. **Maintenance personnel?** Keep the existing restricted `maintenance` login; finish it (A7).
10. **What prevents the core experience working end to end today?** Password reset (F-01); no messaging outside a request and none for landlords (F-02); no notifications (F-03); onboarding needs SQL or a lease (F-06); requests logged by an admin are invisible to the tenant (F-05).

## A11. Product decision questions

Only decisions that change what gets built. Each has a recommendation so work can proceed on the default if there is no objection.

| # | Question | Recommendation | Affects |
|---|---|---|---|
| Q1 | Hide leasing, rent, rental applications and rent policy from the portal? | **Yes.** All four are out of scope and empty on live. Code and tables stay. | 2.2 |
| Q2 | Show statuses as New / Assigned / In progress / On hold / Completed? This changes labels only and revisits the 2026-11-14 decision to keep Open / Scheduled / Closed. | **Yes**, for all roles. No database change. | 2.5 |
| Q3 | Are maintenance personnel regular Landlord Gopher staff or contractors (who should have a restricted login), or ad-hoc outside trades (who should not)? | Regular people get the existing restricted login; ad-hoc vendors stay as directory entries with no login. | 1.9, 1.11 |
| Q4 | Should a landlord read the tenant ↔ Landlord Gopher conversation on a request? Today they can read it but not reply. | **No.** Landlords see status, history and their own thread with Landlord Gopher. Tenants and landlords do not see each other's messages. | 1.3 |
| Q5 | May landlords submit maintenance requests (vacant units, common areas)? | **Yes**, arriving as New for an admin to triage. | 1.8 |
| Q6 | Do all tenants of one unit share requests and the unit conversation? | **Yes** for tenants currently linked to the unit. | 1.4, 1.6 |
| Q7 | What does "push" mean for launch? There is no mobile app in this repository. | Launch with email plus in-app notifications; add browser push as a follow-up; native push only if a mobile app is built. | 1.5 |
| Q8 | Which email service and sender address? And what is the portal's public address? Notification links need it, and hosting is currently deferred. | Decide both before 1.5b starts. | 1.5 |
| Q9 | Should maintenance workers see any property documents? | **No** by default; admin-only management. | 1.11 |

---

# Part B — Implementation checklist

**Nothing below starts until this plan is approved.**

Conventions: Priority P0 (blocks a core workflow or is a security/reliability defect), P1 (needed for a complete experience), P2 (improvement). Complexity S (up to half a day), M (one to two days), L (three to five days). Every database change is a new file in `supabase/migrations/` on a pull request before it is applied anywhere (`docs/ops/schema-migrations.md`). No task deletes data or drops a table.

## Phase 0 — Prerequisite

- [ ] **0.1 Decide where migrations are rehearsed** · P0 · S · Decision: owner
  - Issue: Phase 1 adds tables and changes access rules on the only Supabase project, which holds the real portfolio.
  - Change: either approve the staging branch already proposed in `docs/ops/schema-migrations.md`, or explicitly accept applying to live after emulator tests pass.
  - Acceptance: decision recorded in that document.

## Phase 1 — Core functionality

- [ ] **1.0 Close the suspended-account access gap** · P0 · Worker, tenant · S · No decision
  - Issue: F-17 (security).
  - Change: make the six helpers resolve the caller through the hardened `current_staff_id()` / `current_tenant_id()` / `current_tenant_unit_id()` functions, exactly as was done for the landlord helpers.
  - Files: new migration; `tests/requirements/r2-account-approval.test.ts`, `r7-permissions.test.ts`.
  - Depends on: 0.1.
  - Acceptance: a pending, rejected or suspended worker or tenant reads zero rows from every table (test per status per table); approved behaviour unchanged; all existing tests pass.

- [ ] **1.1 Fix password reset for all roles** · P0 · Tenant, landlord, worker · S · No decision
  - Issue: F-01.
  - Change: do not run the role landing redirect while the path is `/reset-password`; show the new-password form first, then go to the role home.
  - Files: `src/client/app.tsx`, `src/client/lib/safe-redirect.ts`.
  - Acceptance: reset completes for tenant, landlord, worker and admin in the browser suite; old password stops working; unit test covers the exemption.

- [ ] **1.2 Browser tests green and in CI** · P0 · All · S · No decision
  - Issue: F-15.
  - Change: update the admin navigation expectation; make the "Cedar Row" assertion specific; add the browser suite to `.github/workflows/ci.yml`.
  - Files: `tests/e2e/portal-screens.spec.ts`, `.github/workflows/ci.yml`.
  - Depends on: 1.1.
  - Acceptance: 26 of 26 pass locally and on a pull request.

- [ ] **1.3 Request conversation for everyone on the request** · P0 · All · M · Decision Q4
  - Issue: F-02.
  - Change:
    - Add a third visibility for the landlord ↔ Landlord Gopher thread; allow a landlord to post it on requests for their own properties.
    - If Q4 is "no", stop landlords reading tenant-visible comments.
    - Show author names (resolved from the linked staff, tenant or landlord record).
    - Worker default becomes "visible to tenant".
    - Refresh the thread when a new message arrives.
  - Files: new migration (policies on `MaintenanceRequestComments`); `src/client/lib/data.ts` (`listMaintenanceComments`, `addMaintenanceComment`); `components/maintenance/work-order-media-panel.tsx`, `work-order-dialog.tsx`; `tests/requirements/r4-maintenance-requests.test.ts`.
  - Acceptance: tenant, worker, admin and landlord can each post where allowed and are refused elsewhere (tests for every role pair); names shown; a tenant never sees internal or landlord messages.

- [ ] **1.4 Unit and property conversations** · P0 · Tenant, landlord, admin · L · Decision Q6
  - Issue: F-02.
  - Change: new tables for a conversation (one per unit for tenants; one per property per landlord), its messages, and per-user read markers; access rules so tenants see only their unit's, landlords only their properties', admins all, workers none; a Messages screen for each role.
  - Files: new migration; new `src/client/lib/` module; new `components/messages/`; routes in `src/client/hooks/use-router.ts` and `app.tsx`; new requirement tests.
  - Depends on: 0.1.
  - Acceptance: a tenant and an admin exchange messages about a unit; a landlord and an admin about a property; cross-tenant and cross-landlord reads are refused; unread counts are correct after reading.

- [ ] **1.5 Notifications** · P0 · All · L (three parts) · Decisions Q7, Q8
  - Issue: F-03.
  - [ ] **1.5a In-app** (M): a notifications table written by database triggers on account approval, new request, status change and new message; bell with unread count; list that links to the request or conversation.
  - [ ] **1.5b Email** (M): one edge function that sends the same events by email, honouring `Staff.gets_request_alerts` for new-request alerts and each user's preferences; exactly one email per event.
  - [ ] **1.5c Push** (scope per Q7).
  - Files: new migrations; `supabase/functions/` (new); `components/notifications/` (new); `tests/requirements/r6-notifications.test.ts` (replace the ten placeholders).
  - Depends on: 1.3, 1.4 (message events); Q8 for 1.5b; request page address from 2.4 for links.
  - Acceptance: each of the four events produces one in-app item and one email for the right people and nobody else; turning an alert off stops it.

- [ ] **1.6 Tenant sees requests logged for them** · P1 · Tenant, admin · S · Decision Q6
  - Issue: F-05.
  - Change: admin "New request" form gains a tenant field, pre-filled with the unit's tenant, so the request is attributed. If Q6 is "yes", also let current tenants of the unit see each other's requests.
  - Files: `components/maintenance/work-order-staff-fields.tsx`, `work-order-dialog.tsx`; migration only if Q6 is "yes".
  - Acceptance: an admin-logged request for unit 1A appears in that tenant's list; other tenants cannot see it.

- [ ] **1.7 Landlord sees property-level requests** · P1 · Landlord · S · No decision
  - Issue: F-05.
  - Change: the request read rule also matches requests with no unit on a property the landlord owns.
  - Files: new migration (`can_select_maintenance_request`, `maintenance_requests_select`); R7 test.
  - Acceptance: probe from A2 returns the property-level request for its landlord and not for another landlord.

- [ ] **1.8 Landlord submits a request** · P1 · Landlord · M · Decision Q5
  - Issue: F-05.
  - Change: insert rule for landlords limited to their own properties and units, always New and unassigned; reuse the tenant submit form with a property/unit picker.
  - Files: new migration; `components/maintenance/tenant-submit-dialog.tsx`, `maintenance-page.tsx`; R4/R7 tests.
  - Acceptance: landlord can submit for an owned unit, is refused for any other; request arrives New.

- [ ] **1.9 Onboarding without SQL or leases** · P1 · Admin · M · Decision Q3
  - Issue: F-06.
  - [ ] Team: create and edit staff records.
  - [ ] Tenant form: unit picker that sets the tenant's unit directly.
  - [ ] Signup form: name and "I am a tenant / landlord"; stored for display in the approval queue only.
  - [ ] Unknown signups get no role until an admin picks one (stop defaulting to maintenance).
  - Files: `src/client/lib/data.ts`; `components/tenants/tenant-dialog.tsx`; `components/auth/login-page.tsx`; `components/users/users-page.tsx`; new `components/team/`; new migration (`handle_new_user`); R2/R3 tests.
  - Acceptance: an admin can take a new worker and a new tenant from nothing to signed-in using only the portal; `tests/workflows/wf2-account-onboarding.test.ts` extended to prove it.

- [ ] **1.10 Account screen** · P1 · All · S–M · No decision
  - Issue: F-04.
  - Change: view name and contact details, change password, set notification preferences.
  - Files: new `components/account/`; `use-auth.ts`.
  - Depends on: 1.5a for preferences.
  - Acceptance: every role can change their password while signed in.

- [ ] **1.11 Narrow maintenance-worker access** · P1 · Worker · S–M · Decision Q9
  - Issue: F-13.
  - Change: document management becomes admin-only; workers lose blanket document read; remove the worker branch from lease, rent-charge and payment read rules; workers and landlords get a tenant's name and phone only, not date of birth, income, employer or emergency contact (move those columns behind an admin-only table or view).
  - Files: new migration; `tests/requirements/r5-property-documents.test.ts`, `r7-permissions.test.ts`.
  - Acceptance: a worker reads zero leases, charges, payments and (per Q9) documents; neither a worker nor a landlord can read a tenant's date of birth, income, employer or emergency contact; admin behaviour unchanged.

- [ ] **1.12 Turn on leaked-password protection** · P2 · All · S · Owner action
  - Issue: Supabase advisor warning.
  - Change: enable in the Supabase Auth settings per `docs/ops/auth-password-policy.md`.
  - Acceptance: advisor warning gone.

## Phase 2 — UX/UI simplification

- [ ] **2.1 Navigation per role** · P0 · All · M · No decision
  - Issue: F-08.
  - Change: replace the template navigation component with a local one that shows the home item, supports a count badge, and renders as a bottom tab bar on phones for tenant, landlord and worker; apply the structure in A6.
  - Files: `src/client/app.tsx`; new `components/app-nav.tsx`; `use-router.ts`; `safe-redirect.ts` (allowed routes).
  - Acceptance: every role has a visible way home from every screen; no admin item is off-screen at 390 px.

- [ ] **2.2 Hide out-of-scope modules** · P0 · Admin · S–M · Decision Q1
  - Issue: F-08, F-12.
  - Change: one configuration switch, off by default, that removes Leases, Rent, Rental applications and Rent policy from navigation and routing. No code or table is deleted.
  - Files: `app.tsx`, `use-router.ts`, `use-app-state.ts`, `components/settings/settings-page.tsx`.
  - Depends on: 1.9 (tenant unit picker), otherwise no way to attach a tenant to a unit.
  - Acceptance: with the switch off the four screens are unreachable by link or address; with it on they behave as today; existing tests for them still pass with it on.

- [ ] **2.3 Operations dashboard** · P0 · Admin · M · No decision
  - Issue: F-09, F-11.
  - Change: as described in A6 — needs-attention counters, open requests, upcoming 14 days, recent activity. Every row opens its record.
  - Files: `components/dashboard/dashboard-page.tsx`; `getDashboardSummary` in `data.ts`; reuse `lib/calendar-events.ts` for "Upcoming".
  - Depends on: 1.5a (unread and activity), 2.2.
  - Acceptance: an admin can reach a pending approval, a new request and an unread message in one click each from the dashboard.

- [ ] **2.4 Request detail page** · P0 · All · M–L · No decision
  - Issue: F-10.
  - Change: `/maintenance/:id` with the layout in A6; summary as text; one timeline; role-specific actions panel. Existing panels are rearranged, not rewritten.
  - Files: `components/maintenance/*`; `use-router.ts`; `safe-redirect.ts`.
  - Depends on: 1.3.
  - Acceptance: tenant sees who is assigned and when; admin can assign and schedule without scrolling; the address can be opened directly by anyone allowed to see the request and by nobody else.

- [ ] **2.5 One set of status names** · P1 · All · S · Decision Q2
  - Issue: F-07.
  - Change: one shared label map used by lists, detail, history, dashboard and filters.
  - Files: `components/maintenance/work-order-status.ts` and its callers.
  - Acceptance: the same request shows the same status word on every screen for every role.

- [ ] **2.6 Tenant home** · P1 · Tenant · M · No decision
  - Change: Home as described in A6; submit form full-screen on phones.
  - Files: new `components/home/tenant-home.tsx`; `tenant-submit-dialog.tsx`.
  - Depends on: 1.4, 2.1.
  - Acceptance: from Home a tenant can report a problem, open a request, read a message and open a document, each in one tap.

- [ ] **2.7 Landlord home and property page** · P1 · Landlord · S–M · No decision
  - Change: Home as described in A6; property page shows tenant name and open-request count per unit and the property conversation.
  - Files: new `components/home/landlord-home.tsx`; `components/properties/property-page.tsx`.
  - Depends on: 1.4, 1.7.
  - Acceptance: a landlord can see the state of every unit and the latest activity without opening each property.

- [ ] **2.8 People and admin Documents** · P1 · Admin · M · No decision
  - Issue: F-08 (blank `/documents`), F-06.
  - Change: People with Approvals, Tenants, Landlords, Team, Vendors tabs; an admin Documents page listing all documents with property filter and upload.
  - Files: `components/users/`, `tenants/`, `landlords/`, `settings/` (vendors); new `components/documents/admin-documents-page.tsx`.
  - Depends on: 1.9, 2.1.
  - Acceptance: `/documents` works for admins; approving a person and editing their record happen in one place.

- [ ] **2.9 Maintenance queue filters** · P2 · Admin, worker · S · No decision
  - Change: filter by property and assignee; search by title or request number; worker list ordered by scheduled date.
  - Files: `components/maintenance/maintenance-page.tsx`.
  - Acceptance: an admin can list all open requests for one property or one worker.

- [ ] **2.10 Accessibility and state consistency** · P2 · All · S–M · No decision
  - Issue: F-14.
  - Change: clickable cards become links or buttons; dropdowns get accessible names; one loading, empty and error pattern on every list.
  - Files: `components/**`.
  - Acceptance: every primary flow can be completed by keyboard alone; an automated accessibility scan of each role's home reports no critical issues.

## Phase 3 — Technical cleanup

- [ ] **3.1 Split the data module by domain** · P1 · — · M · No decision
  - Issue: F-16.
  - Change: mechanical split of `src/client/lib/data.ts` (maintenance, properties, people, documents, messaging, leasing); no behaviour change.
  - Depends on: Phase 1 complete, to avoid conflicts.
  - Acceptance: all tests pass unchanged.

- [ ] **3.2 Remove unused packages** · P2 · — · S
  - Change: remove `hono`, `zod`, `@phosphor-icons/react`, `@radix-ui/react-popover`; remove `@clawnify/app` once 2.1 lands.
  - Acceptance: build and tests pass.

- [ ] **3.3 Shared status and priority badges** · P2 · — · S
  - Change: one component used by dashboard, queue, property page and request page.
  - Depends on: 2.5.

- [ ] **3.4 Documentation refresh** · P2 · — · S
  - Change: rewrite `README.md` for Landlord Gopher; move `docs/parallel-work-plan.md` and `docs/wave3-plan.md` to `docs/archive/`; make this document the tracker in `docs/IMPLEMENTATION_PLAN.md`; update `docs/phases/phase-6.md` to "reopened".

- [ ] **3.5 Regenerate database types** · P2 · — · S
  - Change: regenerate `src/client/types.supabase.ts` after Phase 1 migrations.

- [ ] **3.6 Decide the fate of hidden modules** · P2 · — · S · Decision: owner
  - Change: one release after 2.2, either delete the hidden leasing/rent/application code or keep it switched off. Tables stay regardless.

## Phase 4 — Validation

- [ ] **4.1 Role walkthroughs in the browser suite** · P0
  - Tenant: sign up → approved → report with photos → message → sees completion.
  - Landlord: sign in → property → request → message Landlord Gopher.
  - Worker: assigned job → start → message tenant → complete.
  - Admin: approve → assign and schedule → reply → upload document.
  - Password reset for all four roles.

- [ ] **4.2 Access-rule matrix for everything new** · P0
  - For conversations, messages, notifications, landlord comments and landlord requests: one test per role per operation, including the refusals.
  - Re-run the A2 probes, including the suspended-account probe from F-17; expected results recorded here.

- [ ] **4.3 Notification delivery checks** · P0
  - Each event sends once, to the right people, with a working link; preferences respected.

- [ ] **4.4 Phone-width pass** · P1
  - Tenant, landlord and worker flows at 390 px; no clipped dialogs, no horizontal scrolling.

- [ ] **4.5 Live verification after migrations** · P0 · Owner sign-off
  - Supabase security advisors show no new warnings.
  - Smoke test with one account per role.
  - Review the 23 test-flagged maintenance requests with the owner before launch; nothing is deleted without explicit approval.

- [ ] **4.6 Regression gate** · P0
  - `pnpm typecheck`, `pnpm test` and `pnpm test:browser` all pass in CI and the check is marked required (`docs/ops/ci-required-checks.md`).

## Suggested order

1. 0.1, then 1.0, 1.1 and 1.2 immediately (independent, small).
2. 2.1 and 2.2 together with 1.9 — the navigation the rest hangs on.
3. 1.3 → 2.4 → 1.4 → 1.5a → 2.3 — the communication spine and the screens that surface it.
4. 1.5b, 1.6, 1.7, 1.8, 1.10, 1.11, then the remaining Phase 2 items.
5. Phase 3, then Phase 4 sign-off (4.1 and 4.2 are written alongside each feature, not left to the end).
