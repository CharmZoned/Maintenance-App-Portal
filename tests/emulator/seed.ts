/**
 * The standard test world: one small portfolio and one login per role.
 *
 * Fixtures are written the way an operator with database access would set a
 * project up (SQL editor / service role), so they do not depend on the portal's
 * own create screens working. Auth users are created through the emulator's
 * auth layer, which fires the project's `on_auth_user_created` trigger.
 */
import type { AuthApi } from "./auth";
import type { EmulatorDb } from "./db";

export const PASSWORD = "Password123!";

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
}

async function one<T>(db: EmulatorDb, sql: string, params: unknown[] = []): Promise<T> {
  const rows = await db.admin<T>(sql, params);
  return rows[0];
}

export async function seedWorld(db: EmulatorDb, auth: AuthApi): Promise<World> {
  const id = (r: { id: string | number }) => Number(r.id);

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
    const u = await auth.createUser({ email: PERSONAS[key].email, password: PASSWORD, confirmed: true });
    users[key] = { id: u.id, email: u.email };
  }

  // Bootstrap exactly as docs/supabase-schema.md describes, then approve everyone
  // except the "pending" persona (left in the approval queue on purpose).
  await db.admin(`select private.assign_admin($1)`, [PERSONAS.admin.email]);
  await db.admin(
    `update public.user_roles set account_status = 'approved' where user_id = any($1::uuid[])`,
    [`{${[users.worker.id, users.worker2.id, users.tenant.id, users.tenant2.id, users.landlord.id].join(",")}}`],
  );

  return {
    password: PASSWORD,
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
}
