/**
 * The demo world, defined once: one small portfolio and one login per role.
 *
 * `seedWorld` loads the standard world the test suite runs on. With
 * `{ demo: true }` it also loads the demo extras (leases, rent, maintenance
 * requests in every status, documents, office chat) that `pnpm dev:local` and
 * the staging database show.
 *
 * Fixtures are written the way an operator with database access would set a
 * project up (SQL editor / service role), so they do not depend on the portal's
 * own create screens working. Everything goes through two small interfaces, so
 * the same code seeds the emulator and a real Supabase project:
 *   - `SeedDb.admin` runs one SQL statement with `$1`-style parameters and full
 *     privileges;
 *   - `SeedAuth.createUser` creates a login, which fires the project's
 *     `on_auth_user_created` trigger.
 */

export const PASSWORD = "Password123!";

/**
 * Demo logins. The four quick-sign-in roles (admin / landlord / tenant /
 * worker→maintenance) must stay aligned with `src/client/lib/demo-accounts.ts`.
 */
export const PERSONAS = {
  admin: { email: "admin@test.local", label: "Admin" },
  worker: { email: "worker@test.local", label: "Worker (Sam Fixit)" },
  worker2: { email: "worker2@test.local", label: "Worker (Riley Wrench)" },
  tenant: { email: "tenant@test.local", label: "Tenant (Tina, Unit 1A)" },
  tenant2: { email: "tenant2@test.local", label: "Tenant (Tom, Unit 2B)" },
  landlord: { email: "landlord@test.local", label: "Landlord (Lena Owner)" },
  pending: { email: "pending@test.local", label: "Pending worker (Pat New)" },
} as const;

export type PersonaKey = keyof typeof PERSONAS;

/** Runs SQL with full privileges (no RLS). The emulator and the staging script each supply one. */
export interface SeedDb {
  admin<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}

/** Creates a login. The auth.users insert must fire the project's on_auth_user_created trigger. */
export interface SeedAuth {
  createUser(input: { email: string; password: string; confirmed: boolean }): Promise<{ id: string; email: string }>;
}

export interface SeedOptions {
  /** Password for every seeded login. Defaults to PASSWORD. */
  password?: string;
  /** Also load the demo extras (richer data for dev:local and staging). Default false. */
  demo?: boolean;
}

/** The demo maintenance requests, one per situation a screen has to show. */
export type DemoRequestKey =
  /** Open, pushed to the worker pool, unassigned. Plumbing: Sam's services match. Unit 1A. */
  | "pooled"
  /** Open, pushed to the worker pool, unassigned. Electrical: Riley's services match. Unit 2B. */
  | "pooledElectrical"
  /** Scheduled: Sam accepted it from the pool. Unit 2B. */
  | "scheduled"
  /** In Progress: assigned to Riley by the admin. Unit 1A. */
  | "inProgress"
  /** On Hold: assigned to Sam, waiting on a part. Unit 2B. */
  | "onHold"
  /** Closed by Sam; the tenant confirmed the fix. Unit 1A. */
  | "closed"
  /** Open, just reported, not yet looked at by the office. Unit 2B. */
  | "new"
  /** Open, raised by the admin on the other landlord's property. */
  | "otherProperty";

/** What `{ demo: true }` adds, for callers that need the ids (tests, the staging file upload). */
export interface DemoWorld {
  leases: { tenant: { id: number }; tenant2: { id: number }; ended: { id: number } };
  requests: Record<DemoRequestKey, { id: number }>;
  /**
   * PropertyDocuments rows. Only the rows are seeded: nothing is stored at
   * `storage_path` (bucket `property-documents`) until a caller uploads a file
   * there. Lists work without the file; Download does not.
   */
  documents: Array<{
    id: number;
    title: string;
    storage_path: string;
    file_name: string;
    content_type: string;
    visibility: "tenant" | "landlord" | "staff";
  }>;
  /**
   * MaintenanceRequestPhotos rows: what tenants attached when reporting, and the
   * worker's completion photo on the closed job. As with documents, only the
   * rows are seeded; the file at `storage_path` (bucket `maintenance-photos`)
   * is uploaded by the caller (the staging reset does).
   */
  photos: Array<{
    id: number;
    request: DemoRequestKey;
    storage_path: string;
    content_type: "image/png";
    caption: string;
    uploaded_by_role: "tenant" | "maintenance";
  }>;
}

export interface World {
  password: string;
  users: Record<PersonaKey, { id: string; email: string }>;
  landlord: { id: number };
  otherLandlord: { id: number };
  property: { id: number; name: string };
  otherProperty: { id: number; name: string };
  units: { a: { id: number; label: string }; b: { id: number; label: string }; other: { id: number; label: string } };
  staff: { worker: { id: number }; worker2: { id: number }; pending: { id: number } };
  tenants: { tenant: { id: number }; tenant2: { id: number } };
  vendor: { id: number };
  /** Present only when seeded with `{ demo: true }`. */
  demo?: DemoWorld;
}

async function one<T>(db: SeedDb, sql: string, params: unknown[] = []): Promise<T> {
  const rows = await db.admin<T>(sql, params);
  return rows[0];
}

const id = (r: { id: string | number }) => Number(r.id);

export async function seedWorld(db: SeedDb, auth: SeedAuth, options: SeedOptions = {}): Promise<World> {
  const password = options.password ?? PASSWORD;

  const landlord = id(
    await one(
      db,
      `insert into public."Landlords" (first_name, last_name, email, company_name)
       values ('Lena', 'Owner', $1, 'Owner Holdings LLC') returning id`,
      [PERSONAS.landlord.email],
    ),
  );
  const otherLandlord = id(
    await one(
      db,
      `insert into public."Landlords" (first_name, last_name, email)
       values ('Oscar', 'Elsewhere', 'oscar@elsewhere.test') returning id`,
    ),
  );

  const property = id(
    await one(
      db,
      `insert into public."Properties" (property_name, street_address, city, state, zip, property_type, landlord_id)
       values ('Maple Court', '12 Maple St', 'Baltimore', 'MD', '21201', 'Multi-family', $1) returning id`,
      [landlord],
    ),
  );
  const otherProperty = id(
    await one(
      db,
      `insert into public."Properties" (property_name, street_address, city, state, zip, property_type, landlord_id)
       values ('Birch House', '9 Birch Ave', 'Towson', 'MD', '21204', 'Single-family', $1) returning id`,
      [otherLandlord],
    ),
  );

  const unit = async (propertyId: number, label: string) =>
    id(
      await one(
        db,
        `insert into public."Units" (property_id, unit_label, bedrooms, bathrooms, status, market_rent)
         values ($1, $2, 2, 1, 'Occupied', 1450) returning id`,
        [propertyId, label],
      ),
    );
  const unitA = await unit(property, "1A");
  const unitB = await unit(property, "2B");
  const unitOther = await unit(otherProperty, "Main");

  const staff = async (first: string, last: string, email: string, title: string) =>
    id(
      await one(
        db,
        `insert into public."Staff" (first_name, last_name, email, job_title, gets_request_alerts)
         values ($1, $2, $3, $4, true) returning id`,
        [first, last, email, title],
      ),
    );
  const worker = await staff("Sam", "Fixit", PERSONAS.worker.email, "Maintenance technician");
  const worker2 = await staff("Riley", "Wrench", PERSONAS.worker2.email, "Maintenance technician");
  const pendingStaff = await staff("Pat", "New", PERSONAS.pending.email, "Maintenance technician");
  // docs/supabase-schema.md, "Bootstrap first admin", step 2: a Staff row with the admin's email.
  await staff("Ada", "Admin", PERSONAS.admin.email, "Operations manager");

  const tenant = async (first: string, last: string, email: string, unitId: number) =>
    id(
      await one(
        db,
        `insert into public."Tenants" (first_name, last_name, email, unit_id, primary_on_lease, invite_to_app)
         values ($1, $2, $3, $4, true, true) returning id`,
        [first, last, email, unitId],
      ),
    );
  const tenant1 = await tenant("Tina", "Renter", PERSONAS.tenant.email, unitA);
  const tenant2 = await tenant("Tom", "Lodger", PERSONAS.tenant2.email, unitB);

  const vendor = id(
    await one(
      db,
      `insert into public."Vendors" (name, category, phone) values ('Rapid Rooter', 'plumber', '555-0100') returning id`,
    ),
  );

  // One login per persona. The auth.users trigger links each by email (pending).
  const users = {} as World["users"];
  for (const key of Object.keys(PERSONAS) as PersonaKey[]) {
    const u = await auth.createUser({ email: PERSONAS[key].email, password, confirmed: true });
    users[key] = { id: u.id, email: u.email };
  }

  // Bootstrap exactly as docs/supabase-schema.md describes, then approve everyone
  // except the "pending" persona (left in the approval queue on purpose).
  await db.admin(`select private.assign_admin($1)`, [PERSONAS.admin.email]);
  await db.admin(
    `update public.user_roles set account_status = 'approved' where user_id = any($1::uuid[])`,
    [`{${[users.worker.id, users.worker2.id, users.tenant.id, users.tenant2.id, users.landlord.id].join(",")}}`],
  );

  const world: World = {
    password,
    users,
    landlord: { id: landlord },
    otherLandlord: { id: otherLandlord },
    property: { id: property, name: "Maple Court" },
    otherProperty: { id: otherProperty, name: "Birch House" },
    units: {
      a: { id: unitA, label: "1A" },
      b: { id: unitB, label: "2B" },
      other: { id: unitOther, label: "Main" },
    },
    staff: { worker: { id: worker }, worker2: { id: worker2 }, pending: { id: pendingStaff } },
    tenants: { tenant: { id: tenant1 }, tenant2: { id: tenant2 } },
    vendor: { id: vendor },
  };

  if (options.demo) world.demo = await seedDemoExtras(db, world);
  return world;
}

// ── Demo extras ───────────────────────────────────────────────────────
// Everything below runs only with `{ demo: true }`, after the standard world.
//
// Rules this section keeps, so it runs unchanged on real Supabase Postgres as
// the `postgres` role:
//   - one statement per `db.admin` call, `$n` parameters, no session state
//     carried from one call to the next;
//   - every date and time is an offset from the database's own clock, so the
//     data never goes stale;
//   - rows are flagged `is_test_data` wherever the table has that column;
//   - where the project guards a change behind one of its own functions
//     (payments, pushing and accepting a job, the tenant's confirmation), that
//     function is called as the persona who would do it in the portal.

type Role = "admin" | "tenant" | "maintenance" | "landlord";

interface Person {
  userId: string;
  role: Role;
  staffId?: number;
  tenantId?: number;
}

/** A point in time as a signed Postgres interval from now, e.g. "-3 days -2 hours" or "+2 days". */
type Offset = string;

/** A Postgres array literal, for drivers that do not convert JS arrays. */
const pgArray = (values: Array<string | number>) =>
  `{${values.map((v) => `"${String(v).replace(/(["\\])/g, "\\$1")}"`).join(",")}}`;

/**
 * Call one of the project's own functions as a signed-in portal user.
 *
 * Those functions check `auth.uid()`, which reads the `request.jwt.claims`
 * setting that the API normally fills in. The setting is made inside the same
 * statement as the call (CASE evaluates its condition first), local to the
 * transaction, so nothing leaks between calls when each statement
 * auto-commits. The second statement clears it for callers that wrap the whole
 * seed in one transaction.
 */
async function callAs<T = unknown>(db: SeedDb, userId: string, call: string, params: unknown[]): Promise<T> {
  const claims = JSON.stringify({ sub: userId, role: "authenticated" });
  const row = await one<{ result: T }>(
    db,
    `select case when set_config('request.jwt.claims', $${params.length + 1}, true) is not null
                 then ${call} end as result`,
    [...params, claims],
  );
  await db.admin(`select set_config('request.jwt.claims', '', true)`);
  return row.result;
}

async function seedDemoExtras(db: SeedDb, world: World): Promise<DemoWorld> {
  const { users, units, staff, tenants } = world;
  const admin: Person = { userId: users.admin.id, role: "admin" };
  const sam: Person = { userId: users.worker.id, role: "maintenance", staffId: staff.worker.id };
  const riley: Person = { userId: users.worker2.id, role: "maintenance", staffId: staff.worker2.id };
  const tina: Person = { userId: users.tenant.id, role: "tenant", tenantId: tenants.tenant.id };
  const tom: Person = { userId: users.tenant2.id, role: "tenant", tenantId: tenants.tenant2.id };
  const lena: Person = { userId: users.landlord.id, role: "landlord" };

  // ── Profiles ────────────────────────────────────────────────────────
  // A worker with no services listed sees no pooled jobs, so both get a trade.
  const workerProfile = (staffId: number, company: string, phone: string, services: string[]) =>
    db.admin(`update public."Staff" set company_name = $2, phone = $3, services = $4::text[] where id = $1`, [
      staffId,
      company,
      phone,
      pgArray(services),
    ]);
  await workerProfile(staff.worker.id, "Fixit Home Repair", "(410) 555-0171", ["Plumbing", "Appliance", "General repair"]);
  await workerProfile(staff.worker2.id, "Wrench Electric & HVAC", "(410) 555-0188", ["Electrical", "Heating / AC"]);

  const tenantContact = (tenantId: number, phone: string, emergency: string) =>
    db.admin(
      `update public."Tenants" set mobile_phone = $2, emergency_contact = $3, is_test_data = true where id = $1`,
      [tenantId, phone, emergency],
    );
  await tenantContact(tenants.tenant.id, "(410) 555-0142", "Rae Renter (410) 555-0143");
  await tenantContact(tenants.tenant2.id, "(410) 555-0156", "Lou Lodger (410) 555-0157");

  await db.admin(`update public."Landlords" set mobile_phone = '(410) 555-0120', preferred_contact = 'Email' where id = $1`, [
    world.landlord.id,
  ]);

  // The standard world is test data too once it is on show.
  const flag = (table: string, ids: number[]) =>
    db.admin(`update public."${table}" set is_test_data = true where id = any($1::bigint[])`, [pgArray(ids)]);
  await flag("Landlords", [world.landlord.id, world.otherLandlord.id]);
  await flag("Properties", [world.property.id, world.otherProperty.id]);
  await flag("Units", [units.a.id, units.b.id, units.other.id]);
  await flag("Vendors", [world.vendor.id]);
  await db.admin(`update public."Staff" set is_test_data = true where email = any($1::text[])`, [
    pgArray(Object.values(PERSONAS).map((p) => p.email)),
  ]);

  // ── Leases ──────────────────────────────────────────────────────────
  // Tina renewed: her first year has ended and the second is running.
  // Tom's lease runs out in three weeks (it shows as an upcoming move-out).
  const MONTH_START = `date_trunc('month', current_date::timestamp)`;
  const lease = async (l: {
    unit: number;
    tenant: number;
    /** Months from the first day of this month to the start date. */
    startMonths: number;
    /** SQL expression for the end date. */
    end: string;
    rent: number;
    status: "active" | "ended";
    notes: string;
  }) => {
    const leaseId = id(
      await one(
        db,
        `insert into public."Leases"
           (unit_id, primary_tenant_id, start_date, end_date, monthly_rent, deposit, rent_due_day, late_fee, status, notes, is_test_data)
         values ($1, $2, (${MONTH_START} + make_interval(months => $3::int))::date, (${l.end})::date,
                 $4, $4, 1, 50, $5, $6, true)
         returning id`,
        [l.unit, l.tenant, l.startMonths, l.rent, l.status, l.notes],
      ),
    );
    await db.admin(`insert into public."LeaseTenants" (lease_id, tenant_id) values ($1, $2)`, [leaseId, l.tenant]);
    return leaseId;
  };
  const endedLease = await lease({
    unit: units.a.id,
    tenant: tenants.tenant.id,
    startMonths: -20,
    end: `${MONTH_START} - interval '8 months' - interval '1 day'`,
    rent: 1375,
    status: "ended",
    notes: "First-year lease. Renewed.",
  });
  const tinaLease = await lease({
    unit: units.a.id,
    tenant: tenants.tenant.id,
    startMonths: -8,
    end: `${MONTH_START} + interval '4 months' - interval '1 day'`,
    rent: 1450,
    status: "active",
    notes: "Renewal, 12 months.",
  });
  const tomLease = await lease({
    unit: units.b.id,
    tenant: tenants.tenant2.id,
    startMonths: -11,
    end: `current_date + 21`,
    rent: 1400,
    status: "active",
    notes: "Ends soon. Renewal offer sent.",
  });

  // ── Rent charges and payments ───────────────────────────────────────
  // One charge per month, due on the 1st, oldest first. A new charge takes the
  // status the project's own rule gives an unpaid charge (open, or overdue once
  // the due date has passed); after that only record_payment changes it.
  const charges = async (leaseId: number, rent: number, monthsBack: number) => {
    const rows = await db.admin<{ id: string | number; period: string }>(
      `insert into public."RentCharges" (lease_id, period, due_date, amount, amount_paid, status, is_test_data)
       select $1::bigint, to_char(m.first_day, 'YYYY-MM'), m.first_day::date, $2::numeric, 0,
              private.rent_charge_status_for_paid($2::numeric, 0::numeric, m.first_day::date), true
         from generate_series(${MONTH_START} - make_interval(months => $3::int), ${MONTH_START}, interval '1 month')
              as m(first_day)
        order by m.first_day
       returning id, period`,
      [leaseId, rent, monthsBack],
    );
    return rows.sort((a, b) => a.period.localeCompare(b.period)).map(id);
  };
  /** Record a payment as the admin. `monthsAgo`/`day` place it in the month the charge was due. */
  const pay = (chargeId: number, amount: number, method: string, reference: string, monthsAgo: number, day: number) =>
    callAs(
      db,
      admin.userId,
      `(public.record_payment($1, $2, $3, $4, null,
          least(now(), date_trunc('month', now()) + $5::interval))).id`,
      [chargeId, amount, method, reference, `-${monthsAgo} months +${day - 1} days +10 hours`],
    );

  // Tina: five months paid (one in two parts), this month part-paid.
  const tinaCharges = await charges(tinaLease, 1450, 5);
  await pay(tinaCharges[0], 1450, "ach", "ACH-20481", 5, 1);
  await pay(tinaCharges[1], 1450, "ach", "ACH-20977", 4, 2);
  await pay(tinaCharges[2], 1000, "check", "Check #1042", 3, 3);
  await pay(tinaCharges[2], 450, "zelle", "Zelle from T. Renter", 3, 9);
  await pay(tinaCharges[3], 1450, "ach", "ACH-21960", 2, 1);
  await pay(tinaCharges[4], 1450, "ach", "ACH-22415", 1, 1);
  await pay(tinaCharges[5], 700, "zelle", "Zelle from T. Renter", 0, 1);

  // Tom: two months paid, then nothing: last month is overdue and this month is unpaid.
  const tomCharges = await charges(tomLease, 1400, 3);
  await pay(tomCharges[0], 1400, "check", "Check #311", 3, 4);
  await pay(tomCharges[1], 1400, "cash", "Receipt 0092", 2, 2);

  await db.admin(`update public."Payments" set is_test_data = true where charge_id = any($1::bigint[])`, [
    pgArray([...tinaCharges, ...tomCharges]),
  ]);

  // ── Maintenance requests ────────────────────────────────────────────
  // The status trigger writes each history row at the current time with no
  // author (there is no signed-in user here), so every step is followed by
  // `stamp`, which gives the newest row its place in the timeline and its
  // author. Rows written by the project's functions already have the author.
  const stamp = (requestId: number, at: Offset, by?: Person) =>
    db.admin(
      `update public."MaintenanceRequestStatusHistory" as h
          set created_at = now() + $2::interval,
              changed_by_user_id = coalesce($3::uuid, h.changed_by_user_id),
              changed_by_role = coalesce($4::text::public.app_role, h.changed_by_role)
        where h.id = (select max(latest.id) from public."MaintenanceRequestStatusHistory" as latest
                       where latest.maintenance_request_id = $1)`,
      [requestId, at, by?.userId ?? null, by?.role ?? null],
    );

  const report = async (r: {
    unit: number;
    by: Person;
    title: string;
    description: string;
    category: string;
    priority?: "Low" | "Normal" | "High" | "Urgent";
    location?: string;
    at: Offset;
  }) => {
    const requestId = id(
      await one(
        db,
        `insert into public."MaintenanceRequests"
           (unit_id, submitted_by_tenant_id, title, description, category, priority, location,
            permission_to_enter, created_at, is_test_data)
         values ($1, $2, $3, $4, $5, $6, $7, true, now() + $8::interval, true)
         returning id`,
        [r.unit, r.by.tenantId ?? null, r.title, r.description, r.category, r.priority ?? "Normal", r.location ?? null, r.at],
      ),
    );
    await stamp(requestId, r.at, r.by);
    return requestId;
  };

  const prices = async (requestId: number, workerPrice: number, landlordPrice: number) => {
    await db.admin(`insert into public."MaintenanceRequestWorkerPrices" (maintenance_request_id, amount) values ($1, $2)`, [
      requestId,
      workerPrice,
    ]);
    await db.admin(`insert into public."MaintenanceRequestLandlordPrices" (maintenance_request_id, amount) values ($1, $2)`, [
      requestId,
      landlordPrice,
    ]);
  };

  /** The admin sets the date, time and both prices and pushes the job to the worker pool. */
  const offer = async (requestId: number, at: Offset, scheduledFor: Offset, workerPrice: number, landlordPrice: number) => {
    await callAs(
      db,
      admin.userId,
      `(public.offer_maintenance_request($1, date_trunc('hour', now() + $2::interval), $3, $4)).id`,
      [requestId, scheduledFor, workerPrice, landlordPrice],
    );
    await db.admin(`update public."MaintenanceRequests" set offered_at = now() + $2::interval where id = $1`, [requestId, at]);
    await stamp(requestId, at);
  };

  /** A worker takes a pooled job. */
  const accept = async (requestId: number, worker: Person, at: Offset) => {
    await callAs(db, worker.userId, `(public.accept_maintenance_request($1)).id`, [requestId]);
    await db.admin(`update public."MaintenanceRequests" set accepted_at = now() + $2::interval where id = $1`, [requestId, at]);
    await stamp(requestId, at);
  };

  /** The admin assigns a worker directly, with a date and time. */
  const schedule = async (requestId: number, worker: Person, at: Offset, scheduledFor: Offset) => {
    await db.admin(
      `update public."MaintenanceRequests"
          set status = 'Scheduled', assigned_staff_id = $2, scheduled_for = date_trunc('hour', now() + $3::interval)
        where id = $1`,
      [requestId, worker.staffId ?? null, scheduledFor],
    );
    await stamp(requestId, at, admin);
  };

  const start = async (requestId: number, worker: Person, at: Offset) => {
    await db.admin(
      `update public."MaintenanceRequests" set status = 'In Progress', started_at = now() + $2::interval where id = $1`,
      [requestId, at],
    );
    await stamp(requestId, at, worker);
  };

  const hold = async (requestId: number, worker: Person, at: Offset, reason: string, followUpInDays: number) => {
    await db.admin(
      `update public."MaintenanceRequests"
          set status = 'On Hold', hold_reason = $2, next_follow_up_date = current_date + $3::int
        where id = $1`,
      [requestId, reason, followUpInDays],
    );
    await stamp(requestId, at, worker);
  };

  const close = async (requestId: number, worker: Person, at: Offset, resolution: string) => {
    await db.admin(
      `update public."MaintenanceRequests"
          set status = 'Closed', closed_at = now() + $2::interval, resolution_notes = $3
        where id = $1`,
      [requestId, at, resolution],
    );
    await stamp(requestId, at, worker);
  };

  /** The tenant who reported it says the problem is fixed. */
  const confirmFixed = async (requestId: number, tenant: Person, at: Offset, note: string) => {
    await callAs(db, tenant.userId, `(public.confirm_maintenance_request_fixed($1, true, $2)).id`, [requestId, note]);
    await db.admin(
      `update public."MaintenanceRequests" set tenant_fix_responded_at = now() + $2::interval where id = $1`,
      [requestId, at],
    );
    await stamp(requestId, at);
  };

  /** A line in the job chat. `internal` is office + worker only; the tenant never sees it. */
  const say = (requestId: number, by: Person, at: Offset, body: string, visibility: "tenant_visible" | "internal" = "tenant_visible") =>
    db.admin(
      `insert into public."MaintenanceRequestComments"
         (maintenance_request_id, author_user_id, author_role, author_staff_id, author_tenant_id, body, visibility, created_at)
       values ($1, $2, $3::text::public.app_role, $4, $5, $6, $7, now() + $8::interval)`,
      [requestId, by.userId, by.role, by.staffId ?? null, by.tenantId ?? null, body, visibility, at],
    );

  // Reported oldest first, so request numbers follow the calendar.
  const closed = await report({
    unit: units.a.id,
    by: tina,
    title: "Garbage disposal jammed",
    description: "It hums when I switch it on but nothing turns.",
    category: "Appliance",
    location: "Kitchen",
    at: "-24 days",
  });
  const onHold = await report({
    unit: units.b.id,
    by: tom,
    title: "Bedroom window won't latch",
    description: "The latch on the left bedroom window is cracked, so the window does not lock.",
    category: "Windows",
    location: "Bedroom",
    at: "-9 days",
  });
  const otherProperty = await report({
    unit: units.other.id,
    by: admin,
    title: "Annual furnace service",
    description: "Yearly service and filter change before the heating season.",
    category: "Heating / AC",
    priority: "Low",
    location: "Basement",
    at: "-3 days",
  });
  const scheduled = await report({
    unit: units.b.id,
    by: tom,
    title: "Dishwasher not draining",
    description: "Standing water in the bottom after every cycle.",
    category: "Appliance",
    location: "Kitchen",
    at: "-2 days",
  });
  const inProgress = await report({
    unit: units.a.id,
    by: tina,
    title: "Bedroom radiator stays cold",
    description: "The radiator in the bedroom is cold while the rest of the flat heats up.",
    category: "Heating / AC",
    priority: "Urgent",
    location: "Bedroom",
    at: "-1 days -4 hours",
  });
  const pooled = await report({
    unit: units.a.id,
    by: tina,
    title: "Kitchen faucet dripping",
    description: "Drips about once a second, even when fully closed.",
    category: "Plumbing",
    location: "Kitchen",
    at: "-20 hours",
  });
  const pooledElectrical = await report({
    unit: units.b.id,
    by: tom,
    title: "Bathroom outlet sparks when used",
    description: "The outlet next to the sink sparked when I plugged in a hair dryer. I have stopped using it.",
    category: "Electrical",
    priority: "High",
    location: "Bathroom",
    at: "-6 hours",
  });
  const fresh = await report({
    unit: units.b.id,
    by: tom,
    title: "Front door lock sticking",
    description: "The key needs a lot of jiggling before the deadbolt turns.",
    category: "Locks / keys / doors",
    location: "Front door",
    at: "-1 hours",
  });

  // Closed: assigned by the admin, done by Sam, confirmed by Tina.
  await schedule(closed, sam, "-23 days -20 hours", "-21 days");
  await prices(closed, 85, 120);
  await say(closed, admin, "-23 days -20 hours", "Sam from Fixit Home Repair will come by on the scheduled day.");
  await start(closed, sam, "-21 days");
  await close(closed, sam, "-20 days -22 hours", "Cleared a bottle cap from the grinding chamber and reset the unit. Runs freely.");
  await say(closed, sam, "-20 days -22 hours", "All done. A bottle cap was stuck in it. It runs fine now.");
  await confirmFixed(closed, tina, "-20 days", "Works again, thank you!");

  // On hold: Sam started, then had to wait for a part.
  await schedule(onHold, sam, "-8 days -20 hours", "-6 days");
  await prices(onHold, 90, 135);
  await start(onHold, sam, "-6 days");
  await hold(onHold, sam, "-5 days -22 hours", "Waiting on a replacement latch from the supplier.", 4);
  await say(onHold, sam, "-5 days -22 hours", "The latch is cracked. I have ordered a replacement and will be back as soon as it arrives.");
  await say(onHold, sam, "-5 days -21 hours", "The part is on back-order. The supplier says Thursday.", "internal");
  await say(onHold, admin, "-5 days -20 hours", "Thanks. Keep the tenant posted, please.", "internal");
  await db.admin(`insert into public."MaintenanceRequestStaffNotes" (maintenance_request_id, notes) values ($1, $2)`, [
    onHold,
    "Latch: sash lock, white, 2-1/8 in. screw spacing.",
  ]);

  // Scheduled: pushed to the pool, accepted by Sam. Created -> Offered -> Accepted.
  await offer(scheduled, "-1 days -20 hours", "+1 days", 120, 175);
  await accept(scheduled, sam, "-1 days -18 hours");
  await say(scheduled, sam, "-1 days -17 hours", "I'll be there tomorrow. Please leave the dishwasher empty.");
  await say(scheduled, tom, "-1 days -16 hours", "Will do, thanks.");

  // In progress: urgent, so the admin assigned Riley directly.
  await schedule(inProgress, riley, "-1 days", "-3 hours");
  await prices(inProgress, 220, 310);
  await say(inProgress, admin, "-1 days", "Riley from Wrench Electric & HVAC is coming this morning.");
  await start(inProgress, riley, "-2 hours");
  await say(inProgress, riley, "-1 hours", "Bleeding the radiator now. The valve may need replacing.");

  // In the pool, waiting for a worker.
  await say(pooled, tina, "-19 hours", "It is getting a little worse each day.");
  await offer(pooled, "-3 hours", "+2 days", 140, 190);
  await offer(pooledElectrical, "-2 hours", "+1 days", 160, 230);

  // ── Job photos ──────────────────────────────────────────────────────
  // Rows only (see DemoWorld.photos). Paths follow `{request_id}/{file}`, the
  // shape the maintenance-photos storage policies require.
  const photos: DemoWorld["photos"] = [];
  const photo = async (request: DemoRequestKey, requestId: number, by: Person, at: Offset, file: string, caption: string) => {
    const storagePath = `${requestId}/${file}`;
    const role = by.role === "maintenance" ? "maintenance" : "tenant";
    const row = await one<{ id: string | number }>(
      db,
      `insert into public."MaintenanceRequestPhotos"
         (maintenance_request_id, storage_path, uploaded_by_role, uploaded_by_user_id, caption, created_at)
       values ($1, $2, $3::text::public.app_role, $4, $5, now() + $6::interval)
       returning id`,
      [requestId, storagePath, role, by.userId, caption, at],
    );
    photos.push({ id: id(row), request, storage_path: storagePath, content_type: "image/png", caption, uploaded_by_role: role });
  };
  await photo("closed", closed, tina, "-24 days", "demo-disposal-reported.png", "It hums but the blades do not turn.");
  // The completion photo the worker must add before closing a job (worker job pool rules).
  await photo("closed", closed, sam, "-20 days -23 hours", "demo-disposal-fixed.png", "Running again after the fix.");
  await photo("onHold", onHold, tom, "-9 days", "demo-window-latch.png", "The cracked latch on the left window.");
  await photo("pooled", pooled, tina, "-20 hours", "demo-faucet-drip.png", "Drips even when fully closed.");

  // ── Property documents ──────────────────────────────────────────────
  // Rows only (see DemoWorld.documents). Paths follow `{property_id}/{file}`.
  const documents: DemoWorld["documents"] = [];
  const document = async (d: {
    unit?: number;
    title: string;
    file: string;
    visibility: "tenant" | "landlord" | "staff";
    category: "lease" | "addendum" | "notice" | "other";
    at: Offset;
  }) => {
    const storagePath = `${world.property.id}/${d.file}`;
    const row = await one<{ id: string | number }>(
      db,
      `insert into public."PropertyDocuments"
         (property_id, unit_id, title, file_name, content_type, storage_path, visibility, category,
          uploaded_by_user_id, uploaded_by_role, created_at, is_test_data)
       values ($1, $2, $3, $4, 'application/pdf', $5, $6, $7, $8, 'admin', now() + $9::interval, true)
       returning id`,
      [world.property.id, d.unit ?? null, d.title, d.file, storagePath, d.visibility, d.category, admin.userId, d.at],
    );
    documents.push({
      id: id(row),
      title: d.title,
      storage_path: storagePath,
      file_name: d.file,
      content_type: "application/pdf",
      visibility: d.visibility,
    });
  };
  await document({
    unit: units.a.id,
    title: "Lease agreement, Unit 1A",
    file: "demo-lease-unit-1a.pdf",
    visibility: "tenant",
    category: "lease",
    at: "-240 days",
  });
  await document({
    unit: units.b.id,
    title: "Lease agreement, Unit 2B",
    file: "demo-lease-unit-2b.pdf",
    visibility: "tenant",
    category: "lease",
    at: "-330 days",
  });
  await document({
    title: "Building rules and trash schedule",
    file: "demo-building-rules.pdf",
    visibility: "tenant",
    category: "notice",
    at: "-60 days",
  });
  await document({
    title: "Property insurance certificate",
    file: "demo-insurance-certificate.pdf",
    visibility: "landlord",
    category: "other",
    at: "-45 days",
  });
  await document({
    title: "Roof inspection report",
    file: "demo-roof-inspection.pdf",
    visibility: "staff",
    category: "other",
    at: "-14 days",
  });

  // ── Direct chat with the office ─────────────────────────────────────
  // One thread per non-admin user; `thread` is whose thread it is.
  const officeMessage = (thread: Person, by: Person, at: Offset, body: string) =>
    db.admin(
      `insert into public."OfficeMessages" (thread_user_id, author_user_id, author_role, body, created_at)
       values ($1, $2, $3::text::public.app_role, $4, now() + $5::interval)`,
      [thread.userId, by.userId, by.role, body, at],
    );
  await officeMessage(sam, sam, "-20 hours", "For the dishwasher at Maple Court 2B tomorrow: is there a lockbox, or will someone be home?");
  await officeMessage(sam, admin, "-19 hours", "Tom will be home to let you in. No lockbox needed.");
  await officeMessage(lena, lena, "-2 days", "What did the garbage disposal repair in 1A come to?");
  await officeMessage(lena, admin, "-1 days -22 hours", "It was $120. It will be on this month's statement.");
  await officeMessage(lena, lena, "-5 hours", "Thanks. Could someone also look at the hallway light by the front door at Maple Court?");
  // Last word is the office's, so Lena opens the portal to one unread message.
  await officeMessage(lena, admin, "-3 hours", "Yes. We'll add it to Sam's next visit and confirm the time here.");

  return {
    leases: { tenant: { id: tinaLease }, tenant2: { id: tomLease }, ended: { id: endedLease } },
    requests: {
      pooled: { id: pooled },
      pooledElectrical: { id: pooledElectrical },
      scheduled: { id: scheduled },
      inProgress: { id: inProgress },
      onHold: { id: onHold },
      closed: { id: closed },
      new: { id: fresh },
      otherProperty: { id: otherProperty },
    },
    documents,
    photos,
  };
}
