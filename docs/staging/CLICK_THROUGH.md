# Staging click-through

**For:** the owner and testers, before the first staging → main release.
**Time:** about 45 minutes per pass (10 minutes per role, then 10 for the shared flow).
**Covers:** the screens merged in PRs #91–#103.
**Plan:** [`BUILD_PLAN.md`](BUILD_PLAN.md), Phase 3

Everything on staging is made-up demo data. Nothing you do here reaches real tenants,
owners or money.

---

## Before you start

1. **Open the staging address** the owner sent you. You first see a **Vercel login**, not
   the app. Sign in with the Vercel account the owner invited (you need to be a Viewer on
   the team). If Vercel says you have no access, ask the owner to invite you.
2. **The pink ribbon.** Every screen has a pink bar at the top that reads
   `STAGING · test data only · build <id>`. A pull request preview reads
   `PREVIEW · <branch> · build <id>` instead. The browser tab title starts with `[STAGING]`.
   If you do not see the ribbon, you are not on staging. Stop and check the address.
3. **Sign in.** On the login page, below the normal form, is a **Staging quick sign-in**
   card with four buttons. You never type a password. The demo password is stored in the
   GitHub and Vercel settings; you do not need it.

   | Button | Who you are | Lands on |
   |---|---|---|
   | Admin | Ada Admin, operations manager | `/dashboard` |
   | Landlord | Lena Owner, owns Maple Court | `/home` |
   | Tenant | Tina Renter, Maple Court Unit 1A | `/home` |
   | Maintenance | Sam Fixit, technician (Fixit Home Repair) | `/maintenance` |

   Shortcut: `/login?as=admin`, `?as=landlord`, `?as=tenant` or `?as=maintenance` signs
   you straight in.
4. **Switch roles** with the button on the right of the ribbon (`Viewing as Admin ▾`).
   Pick another role and you land on that role's home. You do not need to sign out.
5. **Start from fresh data, one writer at a time.** Steps marked ✎ change data for
   everyone. Before a pass, ask the owner to run "Reset staging data" (see [Reset](#reset)),
   or check that the requests match the table below. Only one tester runs the ✎ steps and
   the shared flow at a time; others do the read-only steps.
6. **Admins assign work.** Technician self-claim is switched off on staging, so there are
   no Job offers or Accept buttons. If you see them, stop and tell the owner: Maintenance
   step 1 and the shared flow assume it is off.

### The demo world

| | |
|---|---|
| **Properties** | **Maple Court**, 12 Maple St, Baltimore MD 21201, owner Lena Owner (Owner Holdings LLC), units **1A** and **2B**. **Birch House**, 9 Birch Ave, Towson MD 21204, owner Oscar Elsewhere, unit **Main**. |
| **Tenants** | **Tina Renter**, Unit 1A (lease renewed, rent part-paid this month). **Tom Lodger**, Unit 2B (lease ends in about 3 weeks; last month overdue, this month unpaid). |
| **Technicians** | **Sam Fixit**, plumbing, appliance, general repair. **Riley Wrench**, electrical, heating/AC. |
| **Waiting for approval** | **Pat New**, `pending@test.local`, a technician sign-up. |
| **Vendor** | Rapid Rooter, plumber. |

The eight maintenance requests. Request numbers (`#MR-…`) can change after a reset, so go
by title.

| Request | Unit | Status | Who has it |
|---|---|---|---|
| Garbage disposal jammed | Maple Court 1A (Tina) | Completed; Tina confirmed the fix | Sam |
| Bedroom window won't latch | Maple Court 2B (Tom) | On hold, waiting on a latch | Sam |
| Annual furnace service | Birch House Main | New, Low priority, raised by the office | Nobody |
| Dishwasher not draining | Maple Court 2B (Tom) | Assigned, visit tomorrow 8–12 | Sam |
| Bedroom radiator stays cold | Maple Court 1A (Tina) | In progress, Emergency | Riley |
| Kitchen faucet dripping | Maple Court 1A (Tina) | New, visit window offered but nobody assigned | Nobody |
| Bathroom outlet sparks when used | Maple Court 2B (Tom) | New, High priority, 2 photos | Nobody |
| Front door lock sticking | Maple Court 2B (Tom) | New, reported an hour before the reset | Nobody |

Steps marked **✎ changes data** alter the demo world for everyone. Do the read-only
steps first and the shared flow last.

---

## Admin (Ada Admin)

Ribbon → **Admin**.

1. **Dashboard** (`/dashboard`, #102). It fits one screen on a laptop. You see KPI tiles,
   a week calendar with Previous / Next / Today, a Snapshot card with Rent, Maintenance,
   Messages and Activity tabs, and attention items. Tomorrow's dishwasher visit at Maple
   Court 2B shows as **8–12** (#103).
2. **Rail badges** (#102, #103). **Maintenance** shows a count equal to the "Needs action"
   tab on the queue. **People** shows **1** awaiting approval (Pat New).
3. **Maintenance queue** (`/maintenance`, #102, #103). Tabs: Needs action, Active,
   Completed. Needs action lists the unassigned requests, including Front door lock
   sticking, Bathroom outlet sparks when used, Kitchen faucet dripping and Annual furnace
   service. Each row shows title, priority, status, place and tenant, assignee and age.
   Filter by property **Birch House**: only Annual furnace service is left. Clear the
   filter, then search "radiator". The tab, filter and search appear in the address bar.
4. **Request page** (#100). From the search results, open **Bedroom radiator stays cold**. You see the title with
   `#MR-…`, an **In progress** status and an **Emergency** chip, two photos ("N of 5"), and
   a timeline that names Riley Wrench and Tina Renter. Tap a photo to enlarge it. Then
   press **Back**: you return to the queue with your search still set (#103).
5. **Internal notes** (#100). Open **Bedroom window won't latch**. The timeline shows two
   tinted "Internal" lines ("The part is on back-order…", "Thanks. Keep the tenant
   posted…"). Prices read Worker $90 · Landlord $135.
6. **People → Approvals** (`/people`, #103). **Pat New** is listed with role, sign-up date
   and email status. Check the Landlords, Tenants and Vendors tabs each load (Lena Owner,
   Oscar Elsewhere; Tina, Tom; Rapid Rooter).
7. **✎ Approve Pat New** (#103). Press **Approve…**. The dialog shows Pat's name and
   chosen role and offers **Someone already on file** (the Pat New staff record). Approve
   as Maintenance. Pat leaves the Approvals list and the People badge disappears.
8. **Messages** (`/messages`, #98, #102). Threads lead with the person. Open the **Sam
   Fixit** office thread: "…is there a lockbox, or will someone be home?" and the reply.
   Open **Lena Owner**: "What did the garbage disposal repair in 1A come to?" / "It was
   $120…". The **New message** button shows a "coming soon" note (stub).
9. **✎ Reply** to Lena's thread with "Staging test reply". It appears at once.
10. **Rent** (`/rent`). Tom Lodger, Unit 2B, shows an overdue charge from last month.
    Tina Renter, Unit 1A, shows this month part-paid ($700 of $1,450).
11. **Documents** (`/documents`, #102). Files grouped under Maple Court: Lease agreement,
    Unit 1A; Lease agreement, Unit 2B; Building rules and trash schedule; Property
    insurance certificate; Roof inspection report. Each says who can see it. **Download**
    one; a PDF opens.
12. **Website listings** (`/listings`, #102). A "Publishing listings from the portal is
    coming soon" panel above a read-only list. This is expected.

## Landlord (Lena Owner)

Ribbon → **Landlord**.

1. **Home** (`/home`, #91, #103). Greets Lena by name. Portfolio shows Maple Court only
   (never Birch House). **Needs your attention** includes **Bedroom radiator stays cold**
   (Emergency). One **Billed** figure covers the $120 garbage disposal repair.
2. **Properties** (`/properties`, #94). One card: Maple Court, 12 Maple St, 2 units. Open
   it. Tabs **Overview, Units, Requests, Documents, Messages** switch with the keyboard
   arrows too. Units shows 1A (Tina) and 2B (Tom).
3. **Maintenance** (`/maintenance`, #96). Read-only queue with a summary, status tabs and
   Maple Court as a group. Seven requests; **Annual furnace service** (Birch House) must
   not appear.
4. **Request page** (#92, #100, #103). Open **Garbage disposal jammed**. Status
   Completed, "Tenant confirmed it's fixed", a before and after photo, and the resolution
   ("Cleared a bottle cap…"). There are no internal notes, no Change status and no
   tenant phone, date of birth or emergency contact. The landlord price ($120) is shown;
   the worker price is not.
5. **Message the office** (#103). On the request page press **Message the office about
   this request**. Messages opens with a draft starting "About: …" naming the request. **✎** Send it, or
   press Back without sending.
6. **Messages** (`/messages`, #98). The office thread shows the $120 exchange. There are
   no tenant or request threads to reply in.
7. **Documents** (`/documents`, #95). Filters **All / Shared with me** and a property
   filter. Lena sees both leases, the building rules and the insurance
   certificate. She must **not** see the Roof inspection report (office only).
8. **Bell** (#97, #103). Open the bell. Rows are about her properties, written as "you".
   **Mark all read** clears the count. The panel says email and push alerts are coming
   soon (stub).

## Tenant (Tina Renter, Unit 1A)

Ribbon → **Tenant**.

1. **Home** (`/home`). Rent, open requests and messages summaries, plus the urgent-help
   contact box. Its numbers read "To be confirmed" until the office sets them (expected,
   #103). "Illustrative photo · actual photo needed" and "Pay rent · preview" are
   placeholder copy (known).
2. **Requests** (`/maintenance`, #100). Open: **Bedroom radiator stays cold** (In
   progress, Emergency) and **Kitchen faucet dripping** (New). Completed: **Garbage
   disposal jammed**. None of Tom's 2B requests appear.
3. **Request page** (#100, #103). Open **Garbage disposal jammed**: "You confirmed it's
   fixed". Open **Bedroom radiator stays cold**: Riley Wrench's update ("Bleeding the
   radiator now…") and no internal notes or prices.
4. **✎ Reply on a request** (#100). On Bedroom radiator stays cold, write "Staging test,
   still cold" and send. It appears in the timeline as "You".
5. **Messages** (`/messages`, #98). An office thread is always there, plus her request
   threads.
6. **Documents** (`/documents`). Lease agreement, Unit 1A and Building rules and trash
   schedule. Download works; in-browser preview is not built (expected). She must **not**
   see the Unit 2B lease, the insurance certificate or the roof report.
7. **✎ Report a problem** (#103). Press **Report a problem**. Unit 1A is filled in. Title
   "Staging test: bathroom fan rattles", category General repair, priority Normal, add a
   photo, Submit. One new request appears under Open. Press Submit only once, then check
   it did not create two.

## Maintenance (Sam Fixit)

Ribbon → **Maintenance**.

1. **My jobs** (`/maintenance`, #100, #103). **Dishwasher not draining** (Maple Court 2B,
   tomorrow · 8–12) and **Bedroom window won't latch** (On hold). Under Recently completed:
   **Garbage disposal jammed**. Sam must **not** see Bedroom radiator stays cold
   (Riley's). There is no **Job offers** section: admins assign work for now (#103).
2. **Calendar** (`/calendar`, #103). In the nav. Tomorrow shows the dishwasher visit with
   the 8–12 window.
3. **Request page** (#100). Open **Dishwasher not draining**. Actions show **Start
   work**, **Put on hold** and the worker price ($120) only. Do not press anything yet.
4. **Messages** (#98). The office thread about the lockbox at Maple Court 2B.

---

## Shared flow: schedule → complete → reopen → confirm (all ✎)

One request travels through every role. Use **Kitchen faucet dripping** (Tina, Unit 1A),
which is in the seed already. About 10 minutes.

| # | Role | Do this | You should see |
|---|---|---|---|
| F1 | Admin | Open Kitchen faucet dripping. Press **Assign and schedule**. Pick **Sam Fixit**, tomorrow's date, arrival window **Afternoon**. Press **Assign**. (#103) | Status Assigned. Visit reads e.g. "Wed 25 Nov · 12–5". Picking a window that is already over warns you. |
| F2 | Maintenance | My jobs. (#103) | Kitchen faucet dripping is listed, tomorrow 12–5. Also in Calendar. |
| F3 | Maintenance | Open it, press **Start work**. | Status In progress. |
| F4 | Maintenance | Press **Mark completed**. In the dialog press **Add photo**, choose any image, write "Replaced the washer" under **What fixed it?**, then **Mark completed**. (#103) | Status Completed. The photo shows on the request. Without a photo the dialog explains why one is needed and does not close. |
| F5 | Tenant | Open the bell, then Kitchen faucet dripping. (#103) | Bell row: Your request “Kitchen faucet dripping” was completed. The page asks **Is it fixed?** "Sam Fixit marked this completed today…" |
| F6 | Tenant | Press **Still a problem**, write "Still drips at night", send. (#103) | "You said it's still a problem". The request goes back to Assigned, still with Sam, and the note shows as "Still a problem: …". |
| F7 | Admin | Open Kitchen faucet dripping. | The timeline shows "Tenant says it is not fixed" and Tina's note. Sam is still assigned; nothing to do. |
| F8 | Maintenance | Repeat F3–F4 with a **new** photo. (#103) | It completes again. The earlier photo does not count; the dialog asks for a fresh one. |
| F9 | Tenant | Press **Yes, it's fixed**. | "You confirmed it's fixed". |
| F10 | Landlord | Maintenance → Kitchen faucet dripping. Then Home. (#92, #96, #103) | Completed, "Tenant confirmed it's fixed", Sam's photo, landlord price $190. Home's Billed figure goes up by $190. |

---

## Reset

Steps marked ✎ change the demo world for every tester. When you are done, or when the data
no longer matches this script, the owner (or anyone with repo access) runs:

**GitHub → Actions → "Reset staging data" → Run workflow** on branch `staging`, typing the
staging project ref to confirm. It takes a few minutes and puts every user, request,
photo, document and message back as described above. Tell other testers before you run it.

## Known stubs: do not file these as bugs

- **Rent payments:** on the tenant's Pay rent screen you can select Zelle, card (Stripe)
  or bank (ACH), but each says "Not connected — no debit will be sent." and **Authorize &
  pay · unavailable** stays disabled. No money moves.
- **Zelle verification** on the admin Rent page is real, but tenants cannot report a Zelle
  payment yet, so "Awaiting verification" is normally empty.
- **Email and push notifications.** Alerts show only in the bell. The panel says so.
- **Account → Notifications:** preferences are saved on this device only.
- **Account → password change** is a simple version pending a security setting decision.
- **"Coming soon" panels:** Website listings publishing; admin Messages **New message**.
- **Tenant documents:** no in-browser preview or e-signing; Download works.
- **Landlord property page:** "Direct tenant conversations are not connected yet"; the
  rent roll "isn't in this portal yet".
- **Tenant Home placeholders:** "Illustrative photo · actual photo needed", "Pay rent ·
  preview".
- **Urgent-help contact box** reads "To be confirmed" until the office numbers are set.
- **Job offers / Accept job / Release** for technicians are switched off on purpose.
- Known follow-ups from #103, not bugs: missed visits and tenant reopens are not in "Needs
  action"; there is no one-click Reassign; some date formats differ; technician and tenant
  account chips show the role instead of the name.

## How to report a problem

One message per problem, with:

1. **Role** you were signed in as (Admin, Landlord, Tenant, Maintenance).
2. **URL** from the address bar, including anything after `?`.
3. **Step number** from this script (e.g. "Tenant 7" or "F4").
4. **Screenshot**, with the pink ribbon visible (it shows the build).
5. **What you expected** and **what happened**, in a sentence each.

Phone or laptop, and the browser, help too.

---

## Results

Tester: ____________  Date: ____________  Build (from ribbon): ____________

Put an ✗ in Pass or Fail for each step. In Notes, add the problem report's step number or a short note.

### Admin

| Step | Pass | Fail | Notes |
|---|---|---|---|
| 1 Dashboard | | | |
| 2 Rail badges | | | |
| 3 Maintenance queue | | | |
| 4 Request page, Back | | | |
| 5 Internal notes | | | |
| 6 People tabs | | | |
| 7 ✎ Approve Pat New | | | |
| 8 Messages | | | |
| 9 ✎ Reply | | | |
| 10 Rent | | | |
| 11 Documents | | | |
| 12 Website listings | | | |

### Landlord

| Step | Pass | Fail | Notes |
|---|---|---|---|
| 1 Home | | | |
| 2 Properties | | | |
| 3 Maintenance | | | |
| 4 Request page | | | |
| 5 Message the office | | | |
| 6 Messages | | | |
| 7 Documents | | | |
| 8 Bell | | | |

### Tenant

| Step | Pass | Fail | Notes |
|---|---|---|---|
| 1 Home | | | |
| 2 Requests | | | |
| 3 Request page | | | |
| 4 ✎ Reply on a request | | | |
| 5 Messages | | | |
| 6 Documents | | | |
| 7 ✎ Report a problem | | | |

### Maintenance

| Step | Pass | Fail | Notes |
|---|---|---|---|
| 1 My jobs | | | |
| 2 Calendar | | | |
| 3 Request page | | | |
| 4 Messages | | | |

### Shared flow

| Step | Pass | Fail | Notes |
|---|---|---|---|
| F1 Assign and schedule | | | |
| F2 In My jobs | | | |
| F3 Start work | | | |
| F4 Complete with photo | | | |
| F5 Is it fixed? | | | |
| F6 Still a problem | | | |
| F7 Admin sees reopen | | | |
| F8 Complete again | | | |
| F9 Yes, it's fixed | | | |
| F10 Landlord sees result | | | |
