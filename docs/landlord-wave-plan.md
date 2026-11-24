# Landlord wave plan: the four landlord jobs

**Written:** 2026-11-24 · **Base:** `staging` · **Target:** Milestone 3 beta (SOW due 2026-11-28); realistically lands 2026-11-28 to 2026-12-01
**Source:** landlord UX review of the local build (2026-11-24), SOW §1–§3, Figma file `mx94NqyGDpnrTbilEWx3cr`

The landlord has four jobs: **see their units, see their requests, put a request in, and talk to the office.** Today the first two work with gaps. The last two are impossible. This plan splits the fixes into eight streams that separate agents can run in parallel without editing the same files.

---

## 1. What the code already gives us (verified)

| Need | Already there | Missing |
|---|---|---|
| Landlord ↔ office chat | `OfficeMessages` + `OfficeThreadReads` tables (`20261118190000_worker_job_pool.sql`). RLS: a landlord reads and writes only their own thread; admins read all threads and reply. Realtime is on. `tests/workflows/wf3-worker-job-pool.test.ts` already proves "Landlord · has their own thread with the office; threads never cross". `listOfficeThreads()` in `src/client/lib/data.ts`. | No screen on either side. No helpers to load one thread, send, or mark read. No "regarding request" link. |
| Landlord submits a request | `MaintenanceRequests.unit_id` is nullable, with `CHECK (unit_id IS NOT NULL OR property_id IS NOT NULL)`, so common-area requests already fit. `submitted_by_tenant_id` is nullable. `private.landlord_owns_unit()` is hardened. The 5-photo DB cap exists. Figma landlord form: page `U10 — Submit request form · Landlord` (`28:49969`), all states. | No INSERT policy for landlords (only `maintenance_requests_insert_tenant`). No column saying which landlord reported it. The photo-upload helper `private.can_upload_maintenance_photo` may not allow landlords. No UI: `canCreateWorkOrders: isAdmin` (`src/client/hooks/use-app-state.ts:349`). |
| Consistent labels | The display map in `src/client/lib/request-status.ts` (New / Assigned / In progress / On hold / Completed). | `src/client/components/properties/property-page.tsx` shows raw DB statuses and says "Work orders". `priorityLevel()` (`request-status.ts:78`) maps `urgent` → "Emergency" while the detail page prints "Urgent". |
| Units | `property-page.tsx` renders unit cards. | Cards are not links. There is no unit route. `properties-list.tsx` is one card on an empty page. |
| Admin landlord management | `src/client/components/people/people-page.tsx` Landlords tab (name, email, status). | No properties or unit counts, and no way to message the landlord. |

---

## 2. Decisions needed before kickoff (lead gets answers, ~30 min)

| # | Question | Recommendation | Blocks |
|---|---|---|---|
| D1 | Can landlords submit requests? (SOW §1 says yes, §2 only names tenants) | **Yes.** Build it and note it in the beta release notes. | LG-A1, LG-C |
| D2 | Can landlords file **common-area** requests (no unit)? | **Yes:** the schema already allows it. | LG-A1, LG-C |
| D3 | Does the tenant of that unit see a landlord-filed request? | **No for beta.** RLS keeps tenants to requests they submitted. The admin coordinates entry. The form must not ask the landlord for "permission to enter" (see the Figma handoff note on Q5). | LG-A1, LG-C |
| D4 | Status names | **Display** New / Assigned / In progress / On hold / Completed everywhere. Keep the five DB values (Wave 3 decision #11). Tell the client in writing that "On hold" is an added status. | LG-F |
| D5 | Priority names | One set, everywhere: **Normal / High / Emergency** (DB `urgent` → "Emergency"). Never print the raw DB value. | LG-F |
| D6 | "Regarding request #…" in chat | **A nullable `request_id` column on `OfficeMessages`.** The check ensures the author can see that request. The fallback is plain text, with no migration. | LG-A2, LG-B |
| D7 | Rent / lease cards on landlord Home | **Hide them for landlords** behind a role check. Do not delete the code (out of scope per SOW §3; the client may buy it later). | LG-D |

---

## 3. Streams

Each stream owns its files. A file listed under one stream is edited **only** by that stream. If an agent needs a change in a file it doesn't own, it asks the owner, or the lead sequences the change.

### LG-0 · Lead / integrator (1 agent, runs throughout)
- Gets answers to D1–D7. Writes them into §2 of this file.
- Publishes the **interface contracts** in §4 before Wave 1 starts.
- Creates the integration branch `landlord-wave` from `staging`. Each stream branches from it and PRs back into it. One release PR goes `landlord-wave` → `staging`.
- Reserves the migration slots (§5) and merges in the order in §6.
- Owns `src/client/app.tsx` and `src/client/hooks/use-app-state.ts`. Streams send small patches for these two files; the lead applies them so there are no merge fights.

### LG-A · Database (1 agent; the only stream that writes migrations)
**A1 — landlord can file a request** (slot `20261124100000_landlord_request_insert.sql`)
- Add `MaintenanceRequests.submitted_by_landlord_id bigint REFERENCES "Landlords"(id)`, nullable, indexed. Add a CHECK that at most one of `submitted_by_tenant_id` / `submitted_by_landlord_id` is set.
- Add policy `maintenance_requests_insert_landlord`:
  - role = landlord;
  - `submitted_by_landlord_id = private.current_landlord_id()`;
  - `submitted_by_tenant_id IS NULL`;
  - either `landlord_owns_unit(unit_id)`, or (`unit_id IS NULL` and the landlord owns `property_id`);
  - the same "fresh request" column guards as the tenant policy (`status = 'Open'`, every assignment, schedule, offer and vendor column null).
- Extend `private.can_upload_maintenance_photo` so a landlord can add photos to requests on their own properties, within the existing 5-photo cap.
- Confirm the status-history trigger records a landlord-created row with the right actor.

**A2 — "regarding request" on chat** (slot `20261124110000_office_message_request_link.sql`; only if D6 = column)
- Add `OfficeMessages.request_id bigint REFERENCES "MaintenanceRequests"(id) ON DELETE SET NULL`, nullable.
- Tighten the INSERT check: when `request_id` is set, the author must be an admin or able to see that request (reuse the landlord visibility helper).

**Tests (in the same PR):**
- `tests/requirements/r4-maintenance-requests.test.ts`:
  - a landlord files a request on their own unit, and on a common area;
  - a landlord is refused on another landlord's unit;
  - a landlord is refused if they pre-set status or assignee;
  - a landlord can add photos, at most 5.
- `tests/requirements/r7-permissions.test.ts`:
  - a tenant does not see a landlord-filed request on their unit (D3);
  - a landlord cannot link a chat message to a request they can't see.

**Also:** regenerate `src/client/types.supabase.ts`.

**Owns:** `supabase/migrations/2026112410*`, `src/client/types.supabase.ts`, the two test files above.

### LG-B · Landlord ↔ office chat (1 agent) — priority 1
- New `src/client/lib/office-messages.ts`, kept out of `data.ts` to avoid conflicts:
  - `listOfficeMessages(threadUserId)`
  - `sendOfficeMessage({ threadUserId, body, requestId? })`
  - `markOfficeThreadRead(threadUserId)`
  - `subscribeOfficeThread(threadUserId, cb)` (realtime)
  - Re-export `listOfficeThreads`.
- New `src/client/components/messages/office-thread.tsx`: one shared conversation view (bubbles, composer, "Regarding #MR-…" chip, loading / empty / error / failed-send states). Reuse `message-bubble.tsx` and `message-composer.tsx`.
- **Landlord Messages:**
  - Pin a "Landlord Gopher office" conversation at the top of `messages-page.tsx`.
  - Move the request comment threads under a secondary "Request activity" heading, or hide them for landlords. Request messaging is out of scope per SOW §3, so the lead decides with the owner.
  - The composer has an optional "About a request" picker listing the landlord's requests.
- **Admin Messages:**
  - Add a **Landlords** filter or section listing every landlord thread, with an unread dot from `OfficeThreadReads`, plus a **Workers** section, since the same table carries worker threads.
  - Replace the "Direct messages are stubbed" text.
  - The "New message" button opens a picker of landlords and workers.
- **Route contract (§4):** `/messages?thread=office` (landlord's own thread) and `/messages?thread=office:<user_id>` (admin viewing one thread).
- **Hook for the home page:** export `useOfficeThreadPreview()` → `{ lastMessage, unread, loading, error }`.

**Owns:** `src/client/components/messages/*` (except `notifications-*`), `src/client/lib/office-messages.ts`, `src/client/lib/messages.ts`.

**Figma:** `UPGRADED — Messages` page `20:78`.

### LG-C · Landlord "New request" (1 agent) — priority 2; UI can start once A1 exists on the integration branch
- New `src/client/components/maintenance/landlord-submit-dialog.tsx`, built from Figma `U10 · Submit request form · Landlord`. The dialog's states and their node IDs:

  | State | Desktop | Phone |
  |---|---|---|
  | Default | `28:50199` | `28:50291` |
  | Emergency selected | `35:25999` | `35:26740` |
  | Validation error | `35:26145` | `35:26818` |
  | Submitting | `35:26290` | `35:26895` |
  | Failed submit | `35:26437` | `35:26974` |
  | Success | `35:26589` | `35:27058` |

- Fields: property, unit (or "Common area"), title, category, description, up to 5 photos, priority (Normal / High / Emergency per D5), and an emergency banner. No "permission to enter" field (D3).
- Prop `presetUnitId?` / `presetPropertyId?`, so the unit page and property page open it pre-filled.
- Data function `createLandlordRequest()` in a new `src/client/lib/landlord-requests.ts`. Upload photos after the row exists, as the tenant flow does.
- Patch to the lead for `use-app-state.ts`: add `canSubmitRequest: isAdmin || isTenant || isLandlord`, leaving `canCreateWorkOrders` unchanged.
- Entry point it owns: a "New request" button in the landlord branch of `maintenance-page.tsx`.

**Owns:** the two new files, the landlord branch of `maintenance-page.tsx` header.

**Exports:** `LandlordSubmitDialog` for LG-D and LG-E.

### LG-D · Landlord Home rework (1 agent) — priority 3
In `src/client/components/home/landlord-home-page.tsx` and its test:
- **Top:** "New request" (opens `LandlordSubmitDialog`) and "Message Landlord Gopher" (→ `/messages?thread=office`) side by side. Both are full-width and stacked on phone.
- **Hide for landlords (D7):** the rent card, the rent and lease rows in "Needs your attention", and lease-end reminders.
- **"Needs your input":** requests where the landlord is waiting on something, from LG-F's `landlordNextStep()`, plus unread office messages.
- **Open requests grouped by unit**, replacing the flat maintenance card.
- **Messages card → office card:** shows the last message from the office and the unread count, using `useOfficeThreadPreview()`. Never list tenant names or request comment text here.
- **Property card:** remove the empty "Property photo" placeholder. Use an icon tile until real photos exist.

**Figma:** `UPGRADED — Home` page `20:77`, landlord rows.

**Owns:** `landlord-home-page.tsx`, `landlord-home-page.test.ts`.

### LG-E · Units and properties (1 agent) — priority 4
- New route `/properties/:id/units/:unitId`. Router change in `src/client/hooks/use-router.ts` (owned here) and a patch to the lead for the landlord branch of `app.tsx` and `isLandlordAllowedRoute` (`src/client/lib/safe-redirect.ts`).
- New `src/client/components/units/unit-page.tsx` showing:
  - the unit facts (bed/bath, occupied or vacant);
  - the current tenant's name only, never contact details, matching what landlords see today;
  - open and past requests for the unit, using LG-F labels;
  - the unit's documents (reuse `landlord/document-row.tsx`);
  - a "New request for this unit" button (`LandlordSubmitDialog presetUnitId`).
- `property-page.tsx`:
  - unit cards become links;
  - rename "Work orders" → "Requests";
  - rows use LG-F's labels and open `/maintenance/:id`;
  - add a "New request" button (landlord and admin).
- `properties-list.tsx`: a landlord with exactly one property goes straight to that property's page (`replace`, so Back doesn't loop). With several, show cards with a unit list and open-request counts.
- Admin and staff keep the same pages. Check the admin view still renders.

**Owns:** `src/client/components/properties/*`, `src/client/components/units/*`, `use-router.ts` (+ `use-router.test.ts`).

### LG-F · Labels and "what happens next" (1 agent) — Wave 1, small, lands first
- In `src/client/lib/request-status.ts`, export one source of truth:
  - `statusLabel(status, audience)`
  - `priorityLabel(priority)` (D5)
  - `landlordNextStep(order)` → `{ who: "office" | "worker" | "landlord" | "none", text }`. For example, "On hold – waiting on a part" → "Landlord Gopher is waiting on a part. Nothing needed from you." Use `hold_reason` and `next_follow_up_date` when present.
- Fix the Emergency / Urgent mismatch in the landlord branch of `request-detail-page.tsx`: replace the raw priority print. That branch is the only part of the file F touches.
- Show `landlordNextStep` as a one-line hint under the status on landlord list rows (`maintenance-page.tsx` landlord row only, coordinated with LG-C, which owns that file's header) and on the landlord request page.
- Unit tests in `tests/unit/lib-request-status.test.ts`.

**Owns:** `src/client/lib/request-status.ts`, `src/client/components/maintenance/request-status.ts`, the landlord branch of `request-detail-page.tsx`, the unit test.

### LG-G · Admin Landlords tab (1 agent) — priority 6
- `src/client/components/people/people-page.tsx` Landlords tab: each row shows properties (names), unit count, open requests, portal status, and a **Message** button → `/messages?thread=office:<user_id>`. Hide the button when the landlord has no portal login yet ("Not invited").
- A read helper `listLandlordsWithPortfolio()` in a new `src/client/lib/landlord-portfolio.ts`, joining `Landlords` → `Properties` → `Units` and `user_roles.landlord_id` for the user ID.

**Owns:** `people/*` landlord row/tab, `landlord-portfolio.ts`.

### LG-Q · Seeds, tests and visual QA (1 agent; starts Wave 1, finishes last)
- Demo world: give the landlord a real office thread (3–4 messages, one with `request_id`), one landlord-filed common-area request, and one on-hold request with a `hold_reason`. Update both `tests/emulator/seed.ts` and `scripts/staging/seed.ts`.
- Add workflow `WF4 · Landlord journey` to `tests/requirements.json` and `tests/workflows/wf4-landlord-journey.test.ts`:
  1. Landlord · sees their units.
  2. Landlord · opens a unit and sees its requests.
  3. Landlord · files a request with photos.
  4. Admin · sees it in the queue.
  5. Landlord · messages the office about it.
  6. Admin · replies from Messages → Landlords.
  7. Landlord · sees the reply and the unread clears.
- Playwright e2e for the same flow (`tests/e2e/`).
- Screenshot every landlord screen at 1440 and 390 and compare with the Figma frames. File gaps back to the owning stream.
- Run `pnpm typecheck`, `pnpm test`, `pnpm test:browser` on the integration branch before the release PR.

**Owns:** `tests/emulator/seed.ts`, `scripts/staging/seed.ts`, `tests/requirements.json`, `tests/workflows/wf4-*`, `tests/e2e/landlord-*`.

---

## 4. Interface contracts (lead publishes these before Wave 1)

```ts
// src/client/lib/office-messages.ts           (LG-B)
listOfficeMessages(threadUserId: string): Promise<OfficeMessage[]>
sendOfficeMessage(i: { threadUserId: string; body: string; requestId?: number }): Promise<OfficeMessage>
markOfficeThreadRead(threadUserId: string): Promise<void>
useOfficeThreadPreview(): { lastMessage: OfficeMessage | null; unread: number; loading: boolean; error: string | null }

// Routes                                      (LG-B, LG-E)
/messages?thread=office                 // landlord/worker: own office thread
/messages?thread=office:<user_id>       // admin: one person's thread
/properties/:id/units/:unitId           // unit page

// src/client/components/maintenance/landlord-submit-dialog.tsx   (LG-C)
<LandlordSubmitDialog open onOpenChange presetPropertyId? presetUnitId? onCreated?(id: number) />

// src/client/lib/request-status.ts            (LG-F)
statusLabel(status: WorkOrderStatus, audience: "tenant" | "landlord" | "staff"): string
priorityLabel(p: WorkOrderPriority): "Normal" | "High" | "Emergency"
landlordNextStep(o: WorkOrder): { who: "office" | "worker" | "landlord" | "none"; text: string }

// use-app-state                               (lead applies)
canSubmitRequest: boolean
```

Until a provider merges, consumers stub against these signatures.

---

## 5. Migration slots

| Slot | Stream | Content |
|---|---|---|
| `20261124100000_landlord_request_insert.sql` | LG-A1 | column, policy, photo helper |
| `20261124110000_office_message_request_link.sql` | LG-A2 | `OfficeMessages.request_id` (only if D6 = column) |

No other stream writes migrations. Never apply DDL live first; follow `docs/ops/schema-migrations.md`.

---

## 6. Waves and merge order

```
Wave 0  (lead, ~1h)     D1–D7 answered · contracts in §4 · branch landlord-wave · slots reserved
Wave 1  (parallel)      LG-F ─┐   LG-A ─┐   LG-B   LG-E   LG-G   LG-Q (seeds + test skeletons)
                              │         │
Wave 2  (after deps)          └─► LG-E/LG-D use labels
                                        └─► LG-C (needs A1)  ─► LG-D, LG-E wire the dialog
Wave 3                  LG-Q: WF4 + e2e + visual pass · lead: release PR landlord-wave → staging
```

**Merge order into `landlord-wave`:**
1. **F** (labels): small, and everyone uses it.
2. **A1, A2**: database.
3. **B**: chat.
4. **C**: new request.
5. **E**: units.
6. **G**: admin Landlords tab.
7. **D**: Home, last, because it consumes B, C and F.
8. **Q**: final tests and seeds.

The lead rebases open stream branches after each merge.

**Conflict hot spots:**
- `maintenance-page.tsx`: C owns the header, F owns the landlord row hint. F merges first; C rebases.
- `property-page.tsx`: E only. F provides helpers and doesn't touch it.
- `request-detail-page.tsx`: F only (landlord branch). Nobody else in this wave.
- `app.tsx` / `use-app-state.ts`: lead applies patches from B, C and E.

---

## 7. Acceptance (the beta demo script)

Logged in as `landlord@test.local`:
1. Home shows two buttons at the top, open requests grouped by unit, "Needs your input", and the office's last message. No rent and no lease rows.
2. Properties goes straight to Maple Court (one property). Unit 1A opens a unit page with its requests, documents and "New request for this unit".
3. Every request label reads New / Assigned / In progress / On hold / Completed. Priority reads Normal / High / Emergency, the same in list, tag and details. The on-hold request says who is waiting and that nothing is needed from the landlord.
4. "New request" files a common-area request with 2 photos. It appears in the landlord's list and in the admin queue as New.
5. "Message Landlord Gopher" opens the office conversation. A message about #MR-… shows the request chip.

Then as `admin@test.local`:

6. Messages → Landlords shows that thread unread. The admin replies, and the landlord sees it live, with the unread cleared.
7. People → Landlords shows Owner Holdings LLC with Maple Court, 2 units, open count, and a Message button that opens the same thread.

CI must stay green: `typecheck`, `test` (R4/R7/WF4 included), `test:browser`.

---

## 8. Out of this wave (tracked elsewhere)
- **Email and push notifications for new office messages** (SOW §2 "Notifications"): R6 / WS-L stream. This wave adds the unread state those notifications will key on.
- **Request comment threads for landlords**: out of scope per SOW §3.
- **The Expo mobile app**: these screens become the spec for its landlord tabs.

---

## 9. Kickoff prompts (paste one per agent)

Each agent gets this preamble first:

> Read `docs/landlord-wave-plan.md` (this plan), especially §2 decisions, §3 your stream, §4 contracts and §6 merge order. Branch from `landlord-wave` as `landlord/<stream-id>-<slug>` and PR back into `landlord-wave`. Edit only the files your stream owns; send patches for `app.tsx` and `use-app-state.ts` to the lead. Run the portal locally with `pnpm dev:local` (demo logins in the console; password `Password123!`). Before opening the PR, run `pnpm typecheck && pnpm test`, plus `pnpm test:browser` if you touched UI. For Figma work, load the `figma-design-to-code` skill and use file `mx94NqyGDpnrTbilEWx3cr`. Never apply database changes live.

| Agent | Prompt (after the preamble) |
|---|---|
| LG-A | "You are LG-A. Write migrations A1 and A2 exactly as §3 describes, in the reserved slots. Add the R4/R7 tests listed. Regenerate `types.supabase.ts`. Prove a landlord can file on their own unit and a common area and is refused everywhere else." |
| LG-B | "You are LG-B. Build landlord ↔ office chat on the existing `OfficeMessages` tables: `lib/office-messages.ts`, the shared `office-thread.tsx`, the pinned office conversation for landlords, and Messages → Landlords / Workers for admin, with unread and realtime. Implement the route and hook contracts in §4. Remove the 'Direct messages are stubbed' paths." |
| LG-C | "You are LG-C. Build `LandlordSubmitDialog` from the Figma U10 landlord frames (node IDs in §3), with `createLandlordRequest()` and the 'New request' button on the landlord Maintenance list. No permission-to-enter field. Export the dialog with the §4 props." |
| LG-D | "You are LG-D. Rework landlord Home per §3: two top buttons, hide rent and lease for landlords, 'Needs your input', open requests by unit, office message card via `useOfficeThreadPreview()`, no photo placeholder. Stub B/C/F contracts until they merge. Update `landlord-home-page.test.ts`." |
| LG-E | "You are LG-E. Add the unit page route and screen, make unit cards clickable, rename Work orders → Requests on the property page with LG-F labels, add 'New request' there, and send a one-property landlord straight to their property." |
| LG-F | "You are LG-F. Make `lib/request-status.ts` the single source for status and priority labels and add `landlordNextStep()`. Fix the Emergency / Urgent mismatch on the landlord request page. Add the next-step hint to landlord list rows and the request page. Unit-test every status × hold case. Merge first." |
| LG-G | "You are LG-G. Upgrade People → Landlords: properties, unit count, open requests and a Message button to `/messages?thread=office:<user_id>`, via `lib/landlord-portfolio.ts`." |
| LG-Q | "You are LG-Q. Extend both seeds (office thread, landlord-filed request, on-hold request with reason), add WF4 to `requirements.json` with its workflow test and e2e, then screenshot every landlord screen at 1440 and 390 against Figma and file gaps to the owning stream." |
