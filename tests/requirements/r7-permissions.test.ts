/**
 * R7 — Permissions
 * Nothing is readable without logging in, and each role sees only its own slice.
 */
import { beforeAll, describe, expect, test } from "vitest";
import * as data from "@/lib/data";
import { listRequestReporterNames } from "@/lib/request-reporters";
import legacyWorker from "../../archive/legacy-d1-hono/index";
import {
  anonClient,
  clientFor,
  expectDenied,
  expectOk,
  pngFile,
  resetWorld,
  serviceClient,
  signInApp,
  sql,
  type World,
} from "../support/harness";

let world: World;
let tables: string[];
let requestId: number;

beforeAll(async () => {
  world = await resetWorld();
  tables = (
    await sql<{ tablename: string }>(`select tablename from pg_tables where schemaname = 'public' order by 1`)
  ).map((r) => r.tablename);

  // One request per tenant; Tina's is assigned to Sam.
  const mk = async (tenantId: number, unitId: number, staffId: number | null) =>
    Number(
      (
        await sql<{ id: number }>(
          `insert into public."MaintenanceRequests"
             (title, description, category, unit_id, property_id, submitted_by_tenant_id,
              assigned_staff_id, scheduled_for, status)
           values ('Fixture', 'Fixture', 'Other', $1, $2, $3, $4,
                   case when $4::bigint is null then null else now() + interval '1 day' end,
                   case when $4::bigint is null then 'Open' else 'Scheduled' end)
           returning id`,
          [unitId, world.property.id, tenantId, staffId],
        )
      )[0].id,
    );
  requestId = await mk(world.tenants.tenant.id, world.units.a.id, world.staff.worker.id);
  await mk(world.tenants.tenant2.id, world.units.b.id, null);
  await sql(`insert into public.inquiries (first_name, email, message) values ('Web', 'lead@site.test', 'Call me')`);
  await sql(`insert into public."Settings" (key, value) values ('currency', 'USD')`);
});

describe("[R7] Permissions", () => {
  describe("without logging in", () => {
    test("no table can be read", async () => {
      const anon = anonClient();
      const leaked: string[] = [];
      for (const table of tables) {
        const { data: rows } = await anon.from(table).select("*");
        if (rows && rows.length > 0) leaked.push(table);
      }
      expect(leaked, "tables readable without a login").toEqual([]);
    });

    test("no table can be written", async () => {
      const anon = anonClient();
      expectDenied(await anon.from("Vendors").insert({ name: "Anon Plumbing" }).select());
      expectDenied(await anon.from("Settings").update({ value: "EUR" }).eq("key", "currency").select());
      expectDenied(await anon.from("Vendors").delete().eq("id", world.vendor.id).select());
      expect((await sql<{ value: string }>(`select value from public."Settings" where key = 'currency'`))[0].value).toBe("USD");
      expect(await sql(`select 1 from public."Vendors" where name = 'Anon Plumbing'`)).toHaveLength(0);
    });

    test("no file can be uploaded or fetched", async () => {
      const anon = anonClient();
      const up = await anon.storage
        .from("maintenance-photos")
        .upload(`${requestId}/anon.png`, new Blob([new Uint8Array([1])], { type: "image/png" }));
      expect(up.error).not.toBeNull();
      const signed = await anon.storage.from("maintenance-photos").createSignedUrl(`${requestId}/x.png`, 60);
      expect(signed.error).not.toBeNull();
    });

    test("requests without any API key are rejected", async () => {
      const res = await fetch(`${process.env.VITE_SUPABASE_URL}/rest/v1/Properties?select=*`);
      expect(res.status).toBe(401);
    });

    test("a forged token is rejected", async () => {
      const forged =
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
        Buffer.from(JSON.stringify({ role: "service_role", sub: world.users.admin.id })).toString("base64url") +
        ".not-a-real-signature";
      const res = await fetch(`${process.env.VITE_SUPABASE_URL}/rest/v1/Properties?select=*`, {
        headers: { apikey: forged, authorization: `Bearer ${forged}` },
      });
      expect(res.status).toBe(401);
    });

    test("the retired open /api endpoints stay shut (410 Gone)", async () => {
      for (const path of ["/api", "/api/properties", "/api/work-orders/1"]) {
        for (const method of ["GET", "POST", "DELETE"]) {
          const res = await legacyWorker.request(path, { method });
          expect(res.status, `${method} ${path}`).toBe(410);
        }
      }
    });
  });

  describe("database safety net", () => {
    test("row-level security is switched on for every table", async () => {
      const unprotected = await sql<{ relname: string }>(
        `select c.relname from pg_class c
          where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and not c.relrowsecurity`,
      );
      expect(unprotected.map((r) => r.relname), "tables without RLS — anyone logged in could read them").toEqual([]);
    });

    test("website inquiries are invisible to every portal user, including admins", async () => {
      for (const persona of ["admin", "worker", "tenant", "landlord"] as const) {
        const client = await clientFor(persona);
        expectDenied(await client.from("inquiries").select("*"), `${persona} must not read inquiries`);
      }
    });

    test("the website backend (service role) can still record an inquiry", async () => {
      const result = await serviceClient()
        .from("inquiries")
        .insert({ first_name: "Wendy", email: "wendy@site.test", message: "Interested in management" })
        .select("id")
        .single();
      expect(result.error).toBeNull();
    });
  });

  describe("accounts that are not approved", () => {
    test.each(["pending", "rejected", "suspended"] as const)("a %s account reads nothing", async (status) => {
      await sql(`update public.user_roles set account_status = $2 where user_id = $1`, [world.users.worker2.id, status]);
      const client = await clientFor("worker2");
      const leaked: string[] = [];
      for (const table of tables.filter((t) => t !== "user_roles")) {
        const { data: rows } = await client.from(table).select("*");
        if (rows && rows.length > 0) leaked.push(table);
      }
      expect(leaked, `tables a ${status} account can read`).toEqual([]);
    });

    test.each(["pending", "rejected", "suspended"] as const)(
      "a %s account cannot write portfolio, photos, storage, comments, or staff notes",
      async (status) => {
        await sql(`update public.user_roles set account_status = $2 where user_id = $1`, [
          world.users.worker2.id,
          status,
        ]);
        const client = await clientFor("worker2");

        expectDenied(await client.from("Vendors").insert({ name: `${status}-vendor` }).select());
        expectDenied(
          await client.from("Properties").update({ property_name: "Hacked" }).eq("id", world.property.id).select(),
        );
        expectDenied(await client.from("Units").delete().eq("id", world.units.b.id).select());
        expectDenied(
          await client
            .from("MaintenanceRequestPhotos")
            .insert({
              maintenance_request_id: requestId,
              storage_path: `${requestId}/unapproved.png`,
              uploaded_by_user_id: world.users.worker2.id,
            })
            .select(),
        );
        expectDenied(
          await client
            .from("MaintenanceRequestComments")
            .insert({
              maintenance_request_id: requestId,
              body: "should fail",
              visibility: "internal",
              author_user_id: world.users.worker2.id,
              author_role: "maintenance",
            })
            .select(),
        );
        expectDenied(
          await client
            .from("MaintenanceRequestStaffNotes")
            .upsert({ maintenance_request_id: requestId, notes: "nope" })
            .select(),
        );

        const photoUp = await client.storage
          .from("maintenance-photos")
          .upload(`${requestId}/unapproved-${status}.png`, new Blob([new Uint8Array([1])], { type: "image/png" }));
        expect(photoUp.error).not.toBeNull();
        const docUp = await client.storage
          .from("property-documents")
          .upload(`${world.property.id}/unapproved-${status}.pdf`, new Blob(["x"], { type: "application/pdf" }));
        expect(docUp.error).not.toBeNull();

        expect(await sql(`select 1 from public."Vendors" where name = $1`, [`${status}-vendor`])).toHaveLength(0);
        expect(
          (
            await sql<{ property_name: string }>(`select property_name from public."Properties" where id = $1`, [
              world.property.id,
            ])
          )[0].property_name,
        ).not.toBe("Hacked");
        expect(await sql(`select 1 from public."Units" where id = $1`, [world.units.b.id])).toHaveLength(1);
      },
    );
  });

  describe("a tenant", () => {
    test("sees only their own requests, unit, and tenant record", async () => {
      const client = await clientFor("tenant");
      expect((await client.from("MaintenanceRequests").select("id")).data).toEqual([{ id: requestId }]);
      expect((await client.from("Tenants").select("id")).data).toEqual([{ id: world.tenants.tenant.id }]);
      expect((await client.from("Units").select("id")).data).toEqual([{ id: world.units.a.id }]);
    });

    test("sees the worker assigned to their request, but no other staff", async () => {
      const client = await clientFor("tenant");
      expect((await client.from("Staff").select("id")).data).toEqual([{ id: world.staff.worker.id }]);
    });

    test("a suspended tenant loses staff and landlord visibility even with a leftover tenant_id", async () => {
      // Regression: tenant_can_see_* used to resolve tenant_id from user_roles without
      // account_status = 'approved'.
      const approved = await clientFor("tenant");
      expect((await approved.from("Staff").select("id")).data).toEqual([{ id: world.staff.worker.id }]);
      // Tenants never read the landlord's contact record (since 20261124120000); a
      // landlord-filed request shows the landlord's name through an RPC instead.
      expect((await approved.from("Landlords").select("id")).data).toEqual([]);

      await sql(`update public.user_roles set account_status = 'suspended' where user_id = $1`, [
        world.users.tenant.id,
      ]);
      try {
        const [link] = await sql<{ tenant_id: number; account_status: string }>(
          `select tenant_id, account_status from public.user_roles where user_id = $1`,
          [world.users.tenant.id],
        );
        expect(link.tenant_id).toBe(world.tenants.tenant.id);
        expect(link.account_status).toBe("suspended");

        const suspended = await clientFor("tenant");
        for (const table of ["Staff", "Landlords"] as const) {
          const result = await suspended.from(table).select("id");
          expect(result.error, `${table} select must succeed`).toBeNull();
          expect(result.data).toEqual([]);
        }
      } finally {
        await sql(`update public.user_roles set account_status = 'approved' where user_id = $1`, [
          world.users.tenant.id,
        ]);
      }
    });

    test("cannot see vendors, rental applications, settings, or other users", async () => {
      const client = await clientFor("tenant");
      for (const table of ["Vendors", "Applications", "Settings"]) {
        expectDenied(await client.from(table).select("*"), `tenant must not read ${table}`);
      }
      expect((await client.from("user_roles").select("user_id")).data).toHaveLength(1);
    });
  });

  describe("a worker", () => {
    test("sees only requests assigned to them", async () => {
      const client = await clientFor("worker");
      expect((await client.from("MaintenanceRequests").select("id")).data).toEqual([{ id: requestId }]);
      const other = await clientFor("worker2");
      await sql(`update public.user_roles set account_status = 'approved' where user_id = $1`, [world.users.worker2.id]);
      expect((await other.from("MaintenanceRequests").select("id")).data).toEqual([]);
    });

    test("sees the unit, property, and tenant for their assigned jobs only", async () => {
      const client = await clientFor("worker");
      expect((await client.from("Units").select("id")).data).toEqual([{ id: world.units.a.id }]);
      expect((await client.from("Properties").select("id")).data).toEqual([{ id: world.property.id }]);
      expect((await client.from("Tenants").select("id")).data).toEqual([{ id: world.tenants.tenant.id }]);
    });

    test("a suspended assigned worker loses portfolio visibility even with a leftover staff_id", async () => {
      // Regression: staff_* helpers used to resolve staff_id from user_roles without
      // account_status = 'approved', so a suspended worker with an assignment still
      // passed staff_can_see_tenant / staff_assigned_to_*.
      const approved = await clientFor("worker");
      expect((await approved.from("Tenants").select("id")).data).toEqual([{ id: world.tenants.tenant.id }]);
      // Workers never read the landlord's contact record, assigned or not.
      expect((await approved.from("Landlords").select("id")).data).toEqual([]);

      await sql(`update public.user_roles set account_status = 'suspended' where user_id = $1`, [
        world.users.worker.id,
      ]);
      try {
        const [link] = await sql<{ staff_id: number; account_status: string }>(
          `select staff_id, account_status from public.user_roles where user_id = $1`,
          [world.users.worker.id],
        );
        expect(link.staff_id).toBe(world.staff.worker.id);
        expect(link.account_status).toBe("suspended");

        const suspended = await clientFor("worker");
        for (const table of ["Tenants", "Units", "Properties", "Landlords", "MaintenanceRequests"] as const) {
          const result = await suspended.from(table).select("id");
          expect(result.error, `${table} select must succeed`).toBeNull();
          expect(result.data).toEqual([]);
        }
      } finally {
        await sql(`update public.user_roles set account_status = 'approved' where user_id = $1`, [
          world.users.worker.id,
        ]);
      }
    });

    test("cannot read or mutate Settings (admin-only)", async () => {
      const client = await clientFor("worker");
      expectDenied(await client.from("Settings").select("*"), "worker must not SELECT Settings");
      expectDenied(await client.from("Settings").update({ value: "EUR" }).eq("key", "currency").select());
      expectDenied(await client.from("Settings").insert({ key: "worker_r7", value: "x" }).select());
      expectDenied(await client.from("Settings").delete().eq("key", "currency").select());
      expect((await sql<{ value: string }>(`select value from public."Settings" where key = 'currency'`))[0].value).toBe("USD");
      expect(await sql(`select 1 from public."Settings" where key = 'worker_r7'`)).toHaveLength(0);
      expect(await sql(`select 1 from public."Settings" where key = 'currency'`)).toHaveLength(1);
    });

    test("cannot update a request that is not assigned to them", async () => {
      const client = await clientFor("worker2");
      expectDenied(await client.from("MaintenanceRequests").update({ hold_reason: "mine now" }).eq("id", requestId).select());
      expectDenied(
        await client
          .from("MaintenanceRequestStaffNotes")
          .upsert({ maintenance_request_id: requestId, notes: "mine now" })
          .select(),
      );
    });

    test("cannot reassign a request, change its schedule, or rewrite what the tenant reported", async () => {
      const client = await clientFor("worker");
      const mr = () => client.from("MaintenanceRequests");
      expectDenied(await mr().update({ assigned_staff_id: world.staff.worker2.id }).eq("id", requestId).select());
      expectDenied(await mr().update({ scheduled_for: new Date().toISOString() }).eq("id", requestId).select());
      expectDenied(await mr().update({ title: "Rewritten" }).eq("id", requestId).select());
      expectDenied(await mr().update({ description: "Rewritten" }).eq("id", requestId).select());
      const [row] = await sql<{ title: string; assigned_staff_id: number }>(
        `select title, assigned_staff_id from public."MaintenanceRequests" where id = $1`,
        [requestId],
      );
      expect(row).toMatchObject({ title: "Fixture", assigned_staff_id: world.staff.worker.id });
    });

    test("cannot create or delete requests", async () => {
      const client = await clientFor("worker");
      expectDenied(
        await client
          .from("MaintenanceRequests")
          .insert({ title: "Worker-made", description: "x", category: "Other", property_id: world.property.id })
          .select(),
      );
      expectDenied(await client.from("MaintenanceRequests").delete().eq("id", requestId).select());
    });
  });

  describe("a landlord", () => {
    test("can read requests on their own properties only", async () => {
      const client = await clientFor("landlord");
      const { data: rows } = await client.from("MaintenanceRequests").select("property_id");
      expect(rows?.length).toBe(2);
      expect(rows?.every((r) => r.property_id === world.property.id)).toBe(true);
      expect((await client.from("Properties").select("id")).data).toEqual([{ id: world.property.id }]);
    });

    test("cannot see vendors or rental applications", async () => {
      const client = await clientFor("landlord");
      expectDenied(await client.from("Vendors").select("*"));
      expectDenied(await client.from("Applications").select("*"));
    });

    test("is read-only: cannot edit their properties or the requests on them", async () => {
      const client = await clientFor("landlord");
      expectDenied(await client.from("Properties").update({ property_name: "Mine now" }).eq("id", world.property.id).select());
      expectDenied(
        await client
          .from("Properties")
          .insert({ property_name: "New build", street_address: "1 X", city: "Y", state: "MD", zip: "21201", property_type: "Other", landlord_id: world.landlord.id })
          .select(),
      );
      expectDenied(
        await client.from("MaintenanceRequests").update({ hold_reason: "landlord edit" }).eq("id", requestId).select(),
      );
      const [row] = await sql<{ property_name: string }>(`select property_name from public."Properties" where id = $1`, [world.property.id]);
      expect(row.property_name).toBe("Maple Court");
    });

    test("cannot read internal staff notes on work orders via PostgREST", async () => {
      await sql(
        `insert into public."MaintenanceRequestStaffNotes" (maintenance_request_id, notes)
         values ($1, 'Owner dispute — do not share')
         on conflict (maintenance_request_id) do update set notes = excluded.notes`,
        [requestId],
      );
      const client = await clientFor("landlord");
      const mr = await client.from("MaintenanceRequests").select("*").eq("id", requestId).single();
      expect(mr.error).toBeNull();
      expect(mr.data).not.toHaveProperty("notes");
      const { data: notes } = await client
        .from("MaintenanceRequestStaffNotes")
        .select("notes")
        .eq("maintenance_request_id", requestId);
      expect(notes ?? []).toEqual([]);
      const admin = await clientFor("admin");
      expect(
        (await admin.from("MaintenanceRequestStaffNotes").select("notes").eq("maintenance_request_id", requestId)).data,
      ).toEqual([{ notes: "Owner dispute — do not share" }]);
    });

    test("pending landlord cannot use a stale landlord_id through ownership helpers", async () => {
      await sql(`update public.user_roles set account_status = 'pending' where user_id = $1`, [
        world.users.landlord.id,
      ]);
      const client = await clientFor("landlord");
      expect((await client.from("Properties").select("id")).data ?? []).toEqual([]);
      expect((await client.from("MaintenanceRequests").select("id")).data ?? []).toEqual([]);
      expect((await client.from("Units").select("id")).data ?? []).toEqual([]);
      await sql(`update public.user_roles set account_status = 'approved' where user_id = $1`, [
        world.users.landlord.id,
      ]);
    });

    test("sees updates meant for the tenant but not internal staff notes", async () => {
      await sql(
        `insert into public."MaintenanceRequestComments" (maintenance_request_id, body, visibility, author_role)
         values ($1, 'Internal: owner is slow to pay', 'internal', 'maintenance'),
                ($1, 'Technician booked for Thursday', 'tenant_visible', 'maintenance')`,
        [requestId],
      );
      const client = await clientFor("landlord");
      const { data: rows } = await client.from("MaintenanceRequestComments").select("body").eq("maintenance_request_id", requestId);
      expect(rows?.map((r) => r.body)).toEqual(["Technician booked for Thursday"]);
    });
  });

  describe("money", () => {
    let chargeId: number;
    let leaseId: number;

    async function freshCharge(period: string, amount = 1450): Promise<number> {
      const [charge] = await sql<{ id: number }>(
        `insert into public."RentCharges" (lease_id, period, due_date, amount)
         values ($1, $2, ($2 || '-01')::date, $3) returning id`,
        [leaseId, period, amount],
      );
      return Number(charge.id);
    }

    beforeAll(async () => {
      const [lease] = await sql<{ id: number }>(
        `insert into public."Leases" (unit_id, primary_tenant_id, start_date, end_date, monthly_rent)
         values ($1, $2, '2026-01-01', '2026-12-31', 1450) returning id`,
        [world.units.a.id, world.tenants.tenant.id],
      );
      leaseId = Number(lease.id);
      chargeId = await freshCharge("2099-01");
    });

    test("an admin records a payment and the balance updates", async () => {
      await signInApp("admin");
      const partial = await data.recordPayment({ charge_id: chargeId, amount: 450, method: "check" });
      expect(partial).toMatchObject({ amount_paid: 450, status: "partial" });
      const paid = await data.recordPayment({ charge_id: chargeId, amount: 1000, method: "ach" });
      expect(paid).toMatchObject({ amount_paid: 1450, status: "paid" });
    });

    test("only an admin can record a payment", async () => {
      for (const persona of ["worker", "tenant", "landlord"] as const) {
        const client = await clientFor(persona);
        const { error } = await client.rpc("record_payment", { p_charge_id: chargeId, p_amount: 5 });
        expect(error?.message, persona).toMatch(/only admins/i);
      }
    });

    test("payments cannot be inserted or edited directly, even by an admin", async () => {
      const client = await clientFor("admin");
      expectDenied(await client.from("Payments").insert({ charge_id: chargeId, amount: 9999 }).select());
      expectDenied(await client.from("Payments").update({ amount: 1 }).eq("charge_id", chargeId).select());
      const [sum] = await sql<{ total: string }>(`select sum(amount)::text as total from public."Payments" where charge_id = $1`, [chargeId]);
      expect(Number(sum.total)).toBe(1450);
    });

    test("a tenant sees their own rent charges but not other tenants'", async () => {
      const mine = await clientFor("tenant");
      expect((await mine.from("RentCharges").select("id").eq("id", chargeId)).data).toEqual([{ id: chargeId }]);
      const other = await clientFor("tenant2");
      expect((await other.from("RentCharges").select("id").eq("id", chargeId)).data).toEqual([]);
    });

    test("a worker with a job in the unit cannot read its rent receipts or payment attempts", async () => {
      const [pay] = await sql<{ id: number }>(`select id from public."Payments" where charge_id = $1 limit 1`, [
        chargeId,
      ]);
      const payId = Number(pay.id);
      await sql(
        `insert into public."PaymentReceipts" (payment_id, storage_path, file_name, content_type)
         values ($1, $2, 'receipt.pdf', 'application/pdf')`,
        [payId, `receipts/${payId}/receipt.pdf`],
      );
      await sql(
        `insert into public."PaymentIntents" (charge_id, tenant_id, amount, method, status)
         values ($1, $2, 10, 'zelle', 'pending')`,
        [chargeId, world.tenants.tenant.id],
      );
      await sql(
        `insert into public."MaintenanceRequests"
           (title, description, category, unit_id, property_id, submitted_by_tenant_id, assigned_staff_id, scheduled_for, status)
         values ('Job in 1A', 'Puts the worker in the unit', 'General repair', $1, $2, $3, $4, now(), 'Scheduled')`,
        [world.units.a.id, world.property.id, world.tenants.tenant.id, world.staff.worker.id],
      );

      const worker = await clientFor("worker");
      expect((await worker.from("PaymentReceipts").select("id")).data, "worker: receipts").toEqual([]);
      expect((await worker.from("PaymentIntents").select("id")).data, "worker: payment attempts").toEqual([]);
      expectDenied(
        await worker
          .from("PaymentReceipts")
          .insert({ payment_id: payId, storage_path: `receipts/${payId}/x.pdf`, file_name: "x.pdf", content_type: "application/pdf" })
          .select(),
        "a worker cannot write receipts",
      );

      // The people the money belongs to still see it.
      for (const persona of ["tenant", "landlord", "admin"] as const) {
        const client = await clientFor(persona);
        expect((await client.from("PaymentReceipts").select("id")).data, `${persona}: receipts`).toHaveLength(1);
        expect((await client.from("PaymentIntents").select("id")).data, `${persona}: payment attempts`).toHaveLength(1);
      }
    });

    describe("payment ledger RPCs", () => {
      test("anon cannot EXECUTE record_payment or delete_payment (privileges + PostgREST)", async () => {
        const [privs] = await sql<{
          record_anon: boolean;
          delete_anon: boolean;
          record_auth: boolean;
          delete_auth: boolean;
        }>(
          `select
             has_function_privilege('anon', 'public.record_payment(bigint, numeric, text, text, text, timestamptz)', 'EXECUTE') as record_anon,
             has_function_privilege('anon', 'public.delete_payment(bigint)', 'EXECUTE') as delete_anon,
             has_function_privilege('authenticated', 'public.record_payment(bigint, numeric, text, text, text, timestamptz)', 'EXECUTE') as record_auth,
             has_function_privilege('authenticated', 'public.delete_payment(bigint)', 'EXECUTE') as delete_auth`,
        );
        expect(privs).toMatchObject({
          record_anon: false,
          delete_anon: false,
          record_auth: true,
          delete_auth: true,
        });

        const anon = anonClient();
        const record = await anon.rpc("record_payment", { p_charge_id: chargeId, p_amount: 1 });
        expect(record.error).not.toBeNull();
        expect(record.data).toBeNull();

        const del = await anon.rpc("delete_payment", { p_payment_id: 1 });
        expect(del.error).not.toBeNull();
        expect(del.data).toBeNull();
      });

      test("authenticated admin path still records and deletes via the RPCs", async () => {
        const id = await freshCharge("2099-09");
        await signInApp("admin");
        const afterRecord = await data.recordPayment({
          charge_id: id,
          amount: 125,
          method: "cash",
          reference: "anon-revoke-guard",
        });
        expect(afterRecord).toMatchObject({ amount_paid: 125, status: "partial" });
        const payment = (await data.listPayments(id)).find((p) => p.reference === "anon-revoke-guard");
        expect(payment).toBeTruthy();
        const afterDelete = await data.deletePayment(payment!.id);
        expect(afterDelete).toMatchObject({ amount_paid: 0, status: "open" });
        expect(await sql(`select 1 from public."Payments" where charge_id = $1`, [id])).toHaveLength(0);
      });

      test("deleting a payment reverses the charge balance from the remaining ledger SUM", async () => {
        const id = await freshCharge("2099-02");
        await signInApp("admin");
        await data.recordPayment({ charge_id: id, amount: 400, method: "cash", reference: "keep" });
        await data.recordPayment({ charge_id: id, amount: 200, method: "cash", reference: "drop" });
        const payments = await data.listPayments(id);
        const drop = payments.find((p) => p.reference === "drop");
        expect(drop).toBeTruthy();

        const after = await data.deletePayment(drop!.id);
        expect(after).toMatchObject({ amount_paid: 400, status: "partial" });
        const [sum] = await sql<{ total: string }>(
          `select coalesce(sum(amount), 0)::text as total from public."Payments" where charge_id = $1`,
          [id],
        );
        expect(Number(sum.total)).toBe(400);
        expect(Number(sum.total)).toBe(after.amount_paid);
      });

      test("recording a payment heals amount_paid drift back to SUM(Payments)", async () => {
        const id = await freshCharge("2099-03");
        await signInApp("admin");
        await data.recordPayment({ charge_id: id, amount: 300, method: "cash" });
        await sql(`update public."RentCharges" set amount_paid = 9999, status = 'paid' where id = $1`, [id]);

        const healed = await data.recordPayment({ charge_id: id, amount: 100, method: "cash" });
        expect(healed).toMatchObject({ amount_paid: 400, status: "partial" });
        const [sum] = await sql<{ total: string }>(
          `select coalesce(sum(amount), 0)::text as total from public."Payments" where charge_id = $1`,
          [id],
        );
        expect(Number(sum.total)).toBe(400);
        expect(healed.amount_paid).toBe(Number(sum.total));
      });

      test("deleting a payment also heals amount_paid drift from the ledger SUM", async () => {
        const id = await freshCharge("2099-04");
        await signInApp("admin");
        await data.recordPayment({ charge_id: id, amount: 250, method: "cash", reference: "a" });
        await data.recordPayment({ charge_id: id, amount: 150, method: "cash", reference: "b" });
        const drop = (await data.listPayments(id)).find((p) => p.reference === "b")!;
        await sql(`update public."RentCharges" set amount_paid = 0, status = 'open' where id = $1`, [id]);

        const healed = await data.deletePayment(drop.id);
        expect(healed).toMatchObject({ amount_paid: 250, status: "partial" });
      });

      test("only an admin can delete a payment via the RPC", async () => {
        const id = await freshCharge("2099-05");
        await signInApp("admin");
        await data.recordPayment({ charge_id: id, amount: 50, method: "cash", reference: "guard" });
        const [payment] = await sql<{ id: number }>(
          `select id from public."Payments" where charge_id = $1 and reference = 'guard'`,
          [id],
        );
        for (const persona of ["worker", "tenant", "landlord"] as const) {
          const client = await clientFor(persona);
          const { error } = await client.rpc("delete_payment", { p_payment_id: payment.id });
          expect(error?.message, persona).toMatch(/only admins/i);
        }
        expect(
          await sql(`select 1 from public."Payments" where id = $1`, [payment.id]),
        ).toHaveLength(1);
      });

      test("payments cannot be deleted directly, even by an admin", async () => {
        const id = await freshCharge("2099-06");
        await signInApp("admin");
        await data.recordPayment({ charge_id: id, amount: 75, method: "cash", reference: "direct-del" });
        const [payment] = await sql<{ id: number }>(
          `select id from public."Payments" where charge_id = $1 and reference = 'direct-del'`,
          [id],
        );
        const client = await clientFor("admin");
        expectDenied(await client.from("Payments").delete().eq("id", payment.id).select());
        expect(await sql(`select 1 from public."Payments" where id = $1`, [payment.id])).toHaveLength(1);
      });

      test("admin cannot UPDATE RentCharges.amount_paid or status except via payment RPCs", async () => {
        const id = await freshCharge("2099-10");
        await signInApp("admin");
        await data.recordPayment({ charge_id: id, amount: 50, method: "cash" });
        const client = await clientFor("admin");
        const paid = await client
          .from("RentCharges")
          .update({ amount_paid: 9999 })
          .eq("id", id)
          .select("amount_paid");
        expect(paid.error?.message ?? "").toMatch(/record_payment|delete_payment|amount_paid|status/i);
        expect(paid.data ?? []).toEqual([]);
        const status = await client
          .from("RentCharges")
          .update({ status: "paid" })
          .eq("id", id)
          .select("status");
        expect(status.error?.message ?? "").toMatch(/record_payment|delete_payment|amount_paid|status/i);
        expect(status.data ?? []).toEqual([]);
        const [row] = await sql<{ amount_paid: string; status: string }>(
          `select amount_paid::text, status from public."RentCharges" where id = $1`,
          [id],
        );
        expect(row).toMatchObject({ amount_paid: "50", status: "partial" });
      });

      test("a zero or negative payment amount is refused", async () => {
        const id = await freshCharge("2099-07");
        await signInApp("admin");
        await expect(data.recordPayment({ charge_id: id, amount: 0 })).rejects.toThrow(/positive/i);
        await expect(data.recordPayment({ charge_id: id, amount: -10 })).rejects.toThrow(/positive/i);
        expect(await sql(`select 1 from public."Payments" where charge_id = $1`, [id])).toHaveLength(0);
      });

      test("any payment on a waived charge clears waived and follows the ledger status", async () => {
        const id = await freshCharge("2099-08");
        await sql(`update public."RentCharges" set status = 'waived', amount_paid = 0 where id = $1`, [id]);
        await signInApp("admin");
        const after = await data.recordPayment({ charge_id: id, amount: 100, method: "cash" });
        expect(after.status).toBe("partial");
        expect(after.status).not.toBe("waived");
        expect(after.amount_paid).toBe(100);
      });
    });
  });

  // Runs last: it adds requests, and the counts in the blocks above assume the fixture set.
  describe("landlord-filed requests (D3) and office message links (D6)", () => {
    const fileAsLandlord = async (title: string, over: Record<string, unknown>) => {
      const client = await clientFor("landlord");
      const row = expectOk(
        await client
          .from("MaintenanceRequests")
          .insert({
            title,
            description: "Filed by the landlord",
            category: "Plumbing",
            submitted_by_landlord_id: world.landlord.id,
            ...over,
          })
          .select("id")
          .single(),
        `landlord files "${title}"`,
      ) as { id: number };
      return Number(row.id);
    };

    // D3 (changed by the owner 2026-11-24): the current tenant of the unit sees a
    // landlord-filed request on it, view only, with the landlord's name only.
    let unitRequestId: number;
    const reporterNames = async (persona: "tenant" | "tenant2" | "landlord" | "worker" | "worker2" | "admin", ids: number[]) =>
      (await clientFor(persona)).rpc("list_request_reporter_names", { p_request_ids: ids });

    test("the unit's tenant sees a landlord-filed request on their unit, with its photos, history and worker", async () => {
      unitRequestId = await fileAsLandlord("Leak under 1A (landlord)", { unit_id: world.units.a.id });
      const id = unitRequestId;
      await signInApp("landlord");
      await data.uploadMaintenancePhoto(id, pngFile("leak.png"));
      // The office assigns Riley and leaves a tenant-visible update and an internal note.
      await sql(
        `update public."MaintenanceRequests"
            set assigned_staff_id = $2, scheduled_for = now() + interval '1 day', status = 'Scheduled'
          where id = $1`,
        [id, world.staff.worker2.id],
      );
      await sql(
        `insert into public."MaintenanceRequestComments" (maintenance_request_id, author_role, body, visibility)
         values ($1, 'admin', 'Plumber booked for tomorrow', 'tenant_visible'),
                ($1, 'admin', 'Landlord pays for this one', 'internal')`,
        [id],
      );

      const tenant = await clientFor("tenant");
      expect((await tenant.from("MaintenanceRequests").select("id").eq("id", id)).data).toEqual([{ id }]);
      const trail = (await tenant.from("MaintenanceRequestStatusHistory").select("to_status").eq("maintenance_request_id", id))
        .data;
      expect(trail?.map((r) => r.to_status)).toEqual(["Open", "Scheduled"]);
      expect(
        (await tenant.from("MaintenanceRequestPhotos").select("id").eq("maintenance_request_id", id)).data,
      ).toHaveLength(1);
      expect(
        (await tenant.from("MaintenanceRequestComments").select("body").eq("maintenance_request_id", id)).data,
      ).toEqual([{ body: "Plumber booked for tomorrow" }]);
      // The assigned worker's name, as on the tenant's own requests.
      const staff = (await tenant.from("Staff").select("id, first_name")).data ?? [];
      expect(staff.map((s) => s.id).sort()).toEqual([world.staff.worker.id, world.staff.worker2.id].sort());
      // Prices and staff notes stay hidden.
      for (const table of ["MaintenanceRequestWorkerPrices", "MaintenanceRequestLandlordPrices", "MaintenanceRequestStaffNotes"]) {
        expect((await tenant.from(table).select("maintenance_request_id").eq("maintenance_request_id", id)).data, table).toEqual(
          [],
        );
      }

      await signInApp("tenant");
      const orders = await data.listWorkOrders();
      expect(orders.find((w) => w.id === id)).toMatchObject({ tenant_id: null, unit_id: world.units.a.id });
      const photos = await data.listMaintenancePhotos(id);
      expect(photos).toHaveLength(1);
      expect(photos[0]!.url).toBeTruthy();
      expect((await data.listMaintenanceStatusHistory(id)).length).toBeGreaterThan(0);

      const landlord = await clientFor("landlord");
      expect((await landlord.from("MaintenanceRequests").select("id").eq("id", id)).data).toEqual([{ id }]);
    });

    test("the tenant sees the landlord's name, but never the landlord's email or phone", async () => {
      const id = unitRequestId;
      const named = await reporterNames("tenant", [id, requestId]);
      expect(named.error).toBeNull();
      // Only the landlord-filed request comes back; the tenant's own has no landlord reporter.
      expect(named.data).toEqual([{ request_id: id, landlord_name: "Owner Holdings LLC" }]);

      await signInApp("tenant");
      expect(await listRequestReporterNames([id, requestId])).toEqual(new Map([[id, "Owner Holdings LLC"]]));

      const tenant = await clientFor("tenant");
      const contact = await tenant.from("Landlords").select("email, mobile_phone").eq("id", world.landlord.id);
      expect(contact.data ?? []).toEqual([]);
      expect((await tenant.from("Landlords").select("*")).data ?? []).toEqual([]);

      // Callers who can't see the request get nothing, not even the name.
      for (const persona of ["tenant2", "worker"] as const) {
        const other = await reporterNames(persona, [id]);
        expect(other.error, persona).toBeNull();
        expect(other.data, persona).toEqual([]);
      }
      const anon = await anonClient().rpc("list_request_reporter_names", { p_request_ids: [id] });
      expect(anon.error !== null || (anon.data ?? []).length === 0).toBe(true);
      // The landlord, the assigned worker and the admin get it too.
      for (const persona of ["landlord", "worker2", "admin"] as const) {
        expect((await reporterNames(persona, [id])).data, persona).toEqual([
          { request_id: id, landlord_name: "Owner Holdings LLC" },
        ]);
      }
    });

    test("another unit's tenant, and a tenant who moved out of the unit, do not see it", async () => {
      const id = unitRequestId;
      const tenant2 = await clientFor("tenant2");
      expect((await tenant2.from("MaintenanceRequests").select("id").eq("id", id)).data).toEqual([]);
      expect(
        (await tenant2.from("MaintenanceRequestPhotos").select("id").eq("maintenance_request_id", id)).data,
      ).toEqual([]);
      expect(
        (await tenant2.from("MaintenanceRequestStatusHistory").select("id").eq("maintenance_request_id", id)).data,
      ).toEqual([]);
      expect((await tenant2.from("Staff").select("id")).data ?? []).toEqual([]);

      // Tina moves to another unit: the 1A request disappears at once, her own request stays.
      await sql(`update public."Tenants" set unit_id = $2 where id = $1`, [world.tenants.tenant.id, world.units.other.id]);
      try {
        const moved = await clientFor("tenant");
        const ids = ((await moved.from("MaintenanceRequests").select("id")).data ?? []).map((r) => r.id);
        expect(ids).not.toContain(id);
        expect(ids).toContain(requestId);
        expect(
          (await moved.from("MaintenanceRequestPhotos").select("id").eq("maintenance_request_id", id)).data,
        ).toEqual([]);
        expect(
          (await moved.from("MaintenanceRequestStatusHistory").select("id").eq("maintenance_request_id", id)).data,
        ).toEqual([]);
        expect(
          (await moved.from("MaintenanceRequestComments").select("id").eq("maintenance_request_id", id)).data,
        ).toEqual([]);
        expect((await moved.rpc("list_request_reporter_names", { p_request_ids: [id] })).data).toEqual([]);

        // No unit at all (moved out).
        await sql(`update public."Tenants" set unit_id = null where id = $1`, [world.tenants.tenant.id]);
        const out = await clientFor("tenant");
        expect((await out.from("MaintenanceRequests").select("id").eq("id", id)).data).toEqual([]);
      } finally {
        await sql(`update public."Tenants" set unit_id = $2 where id = $1`, [world.tenants.tenant.id, world.units.a.id]);
      }
    });

    test("a tenant does not see a landlord-filed common-area request on their property", async () => {
      const id = await fileAsLandlord("Stairwell light (landlord)", { unit_id: null, property_id: world.property.id });
      await signInApp("landlord");
      await data.uploadMaintenancePhoto(id, pngFile("stairs.png"));
      for (const persona of ["tenant", "tenant2", "worker"] as const) {
        const client = await clientFor(persona);
        expect((await client.from("MaintenanceRequests").select("id").eq("id", id)).data, persona).toEqual([]);
        expect(
          (await client.from("MaintenanceRequestPhotos").select("id").eq("maintenance_request_id", id)).data,
          persona,
        ).toEqual([]);
        expect(
          (await client.from("MaintenanceRequestStatusHistory").select("id").eq("maintenance_request_id", id)).data,
          persona,
        ).toEqual([]);
      }
      expect((await reporterNames("tenant", [id])).data).toEqual([]);
    });

    test("the tenant cannot comment on, add photos to, confirm or change a landlord-filed request", async () => {
      const id = unitRequestId;
      const tenant = await clientFor("tenant");

      expectDenied(
        await tenant
          .from("MaintenanceRequestComments")
          .insert({
            maintenance_request_id: id,
            author_user_id: world.users.tenant.id,
            author_role: "tenant",
            author_tenant_id: world.tenants.tenant.id,
            body: "Any news?",
            visibility: "tenant_visible",
          })
          .select(),
        "tenant comment on a landlord-filed request",
      );
      await signInApp("tenant");
      await expect(data.addMaintenanceComment(id, "Any news?", "tenant_visible")).rejects.toThrow();
      expect(await sql(`select 1 from public."MaintenanceRequestComments" where maintenance_request_id = $1 and author_role = 'tenant'`, [id])).toHaveLength(0);

      await expect(data.uploadMaintenancePhoto(id, pngFile("tenant.png"))).rejects.toThrow();
      const up = await tenant.storage
        .from("maintenance-photos")
        .upload(`${id}/tenant-direct.png`, new Blob([new Uint8Array([1])], { type: "image/png" }));
      expect(up.error).not.toBeNull();
      expect(
        await sql(`select 1 from public."MaintenanceRequestPhotos" where maintenance_request_id = $1 and uploaded_by_role = 'tenant'`, [id]),
      ).toHaveLength(0);

      expectDenied(
        await tenant.from("MaintenanceRequests").update({ title: "Changed by tenant", priority: "urgent" }).eq("id", id).select(),
        "tenant update",
      );
      expectDenied(await tenant.from("MaintenanceRequests").delete().eq("id", id).select(), "tenant delete");

      // Office links: a tenant may not tag their office message with this request.
      expectDenied(
        await tenant
          .from("OfficeMessages")
          .insert({ thread_user_id: world.users.tenant.id, author_role: "tenant", body: "About 1A", request_id: id })
          .select(),
        "tenant links a landlord-filed request",
      );

      // Completed: only the reporter answers "is it fixed?", and the landlord is the reporter.
      await sql(
        `update public."MaintenanceRequests" set status = 'Closed', closed_at = now(), resolution_notes = 'Fixed' where id = $1`,
        [id],
      );
      const confirm = await tenant.rpc("confirm_maintenance_request_fixed", { p_request_id: id, p_fixed: true });
      expect(confirm.error).not.toBeNull();

      const [row] = await sql<{ title: string; tenant_fix_response: string | null }>(
        `select title, tenant_fix_response from public."MaintenanceRequests" where id = $1`,
        [id],
      );
      expect(row).toEqual({ title: "Leak under 1A (landlord)", tenant_fix_response: null });
      // Still visible, view only.
      expect((await tenant.from("MaintenanceRequests").select("id").eq("id", id)).data).toEqual([{ id }]);
    });

    test("the assigned worker cannot move a common-area job onto another property", async () => {
      // Landlords see common-area rows through property_id, so only admins may change it.
      const [birch] = await sql<{ id: number }>(
        `insert into public."MaintenanceRequests"
           (title, description, category, property_id, assigned_staff_id, scheduled_for, status)
         values ('Birch House boiler', 'Office-filed', 'Other', $1, $2, now() + interval '1 day', 'Scheduled')
         returning id`,
        [world.otherProperty.id, world.staff.worker.id],
      );
      const birchId = Number(birch.id);
      const own = await fileAsLandlord("Lobby door (landlord)", { unit_id: null, property_id: world.property.id });
      await sql(
        `update public."MaintenanceRequests" set assigned_staff_id = $2, scheduled_for = now() + interval '1 day', status = 'Scheduled' where id = $1`,
        [own, world.staff.worker.id],
      );

      const landlord = await clientFor("landlord");
      expect((await landlord.from("MaintenanceRequests").select("id").eq("id", birchId)).data).toEqual([]);

      const worker = await clientFor("worker");
      // Pull another landlord's job into this landlord's view.
      expectDenied(
        await worker.from("MaintenanceRequests").update({ property_id: world.property.id }).eq("id", birchId).select(),
        "worker re-points a common-area job onto Maple Court",
      );
      // Push this landlord's own job (their photos and words) to another landlord.
      expectDenied(
        await worker.from("MaintenanceRequests").update({ property_id: world.otherProperty.id }).eq("id", own).select(),
        "worker re-points the landlord's common-area request onto Birch House",
      );
      const rows = await sql<{ id: number; property_id: number }>(
        `select id, property_id from public."MaintenanceRequests" where id = any($1::bigint[]) order by id`,
        [[birchId, own]],
      );
      expect(rows.map((r) => [Number(r.id), Number(r.property_id)])).toEqual([
        [birchId, world.otherProperty.id],
        [own, world.property.id],
      ]);
      expect((await landlord.from("MaintenanceRequests").select("id").eq("id", birchId)).data).toEqual([]);
      expect((await landlord.from("MaintenanceRequests").select("id").eq("id", own)).data).toEqual([{ id: own }]);

      // The worker can still work the job, and the admin can still re-point it.
      expectOk(
        await worker.from("MaintenanceRequests").update({ status: "In Progress", started_at: new Date().toISOString() }).eq("id", own).select(),
        "worker starts the job",
      );
      const admin = await clientFor("admin");
      expectOk(
        await admin.from("MaintenanceRequests").update({ property_id: world.property.id }).eq("id", birchId).select(),
        "admin moves the job",
      );
      expect((await landlord.from("MaintenanceRequests").select("id").eq("id", birchId)).data).toEqual([{ id: birchId }]);
      await sql(`delete from public."MaintenanceRequests" where id = any($1::bigint[])`, [[birchId, own]]);
    });

    test("a landlord can link a chat message to their own request, but not to one they can't see", async () => {
      const own = await fileAsLandlord("Boiler noise (landlord)", { unit_id: null, property_id: world.property.id });
      const [other] = await sql<{ id: number }>(
        `insert into public."MaintenanceRequests" (title, description, category, property_id)
         values ('Birch House roof', 'Office-filed', 'Roof / leaks', $1) returning id`,
        [world.otherProperty.id],
      );
      const otherId = Number(other.id);
      const say = (client: Awaited<ReturnType<typeof clientFor>>, threadUser: string, role: string, requestIdLink: number) =>
        client
          .from("OfficeMessages")
          .insert({ thread_user_id: threadUser, author_role: role, body: "About this request", request_id: requestIdLink })
          .select("id, request_id")
          .single();

      const landlord = await clientFor("landlord");
      expect(expectOk(await say(landlord, world.users.landlord.id, "landlord", own))).toMatchObject({ request_id: own });
      expect(expectOk(await say(landlord, world.users.landlord.id, "landlord", requestId))).toMatchObject({
        request_id: requestId,
      });
      expectDenied(await say(landlord, world.users.landlord.id, "landlord", otherId), "another landlord's request");

      const worker2 = await clientFor("worker2");
      expectDenied(await say(worker2, world.users.worker2.id, "maintenance", requestId), "a job not assigned to them");

      const admin = await clientFor("admin");
      expectOk(await say(admin, world.users.landlord.id, "admin", own), "admin links a request");

      expect(
        await sql(`select 1 from public."OfficeMessages" where request_id = $1`, [otherId]),
      ).toHaveLength(0);

      // Deleting the request keeps the message and clears the link.
      await sql(`delete from public."MaintenanceRequests" where id = $1`, [own]);
      const kept = await sql<{ request_id: number | null }>(
        `select request_id from public."OfficeMessages" where thread_user_id = $1 and body = 'About this request' order by id`,
        [world.users.landlord.id],
      );
      expect(kept.map((r) => r.request_id)).toEqual([null, requestId, null]);
    });
  });
});
