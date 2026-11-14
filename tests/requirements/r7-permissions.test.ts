/**
 * R7 — Permissions
 * Nothing is readable without logging in, and each role sees only its own slice.
 */
import { beforeAll, describe, expect, test } from "vitest";
import * as data from "@/lib/data";
import legacyWorker from "../../archive/legacy-d1-hono/index";
import {
  anonClient,
  clientFor,
  expectDenied,
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
});
