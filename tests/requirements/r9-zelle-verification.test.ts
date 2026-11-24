/**
 * R8 — Admin web portal: verifying a Zelle payment a tenant reported.
 *
 * A tenant's "I sent it by Zelle" must not move the balance. It waits in
 * "Awaiting verification" on the admin Rent page until an admin confirms it,
 * and only then is a Payment recorded against the charge.
 * Data layer: src/client/lib/zelle-payments.ts → public.confirm_zelle_payment.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, test } from "vitest";
import * as data from "@/lib/data";
import { confirmZellePayment, listReportedZellePayments } from "@/lib/zelle-payments";
import { anonClient, clientFor, expectOk, resetWorld, signInApp, sql, type World } from "../support/harness";

const RENT = 1450;

let world: World;
let leaseId: number;

async function freshCharge(period: string, amount = RENT): Promise<number> {
  const [charge] = await sql<{ id: number }>(
    `insert into public."RentCharges" (lease_id, period, due_date, amount)
     values ($1, $2, ($2 || '-01')::date, $3) returning id`,
    [leaseId, period, amount],
  );
  return Number(charge.id);
}

/** The tenant's two steps in the portal: start a Zelle payment, then say it was sent. */
async function tenantReportsZelle(
  chargeId: number,
  amount: number,
  bankRef?: string,
): Promise<{ id: number; client_reference: string }> {
  const tenant = await clientFor("tenant");
  const intent = expectOk(
    await tenant.rpc("initiate_tenant_payment", { p_charge_id: chargeId, p_amount: amount, p_method: "zelle" }),
    "tenant starts a Zelle payment",
  ) as { id: number };
  const reported = expectOk(
    await tenant.rpc("report_zelle_sent", { p_intent_id: intent.id, p_bank_confirmation_ref: bankRef ?? null }),
    "tenant marks the Zelle payment as sent",
  ) as { id: number; status: string; client_reference: string };
  expect(reported.status).toBe("zelle_reported");
  return { id: Number(reported.id), client_reference: reported.client_reference };
}

async function intentRow(id: number) {
  const [row] = await sql<{ status: string; payment_id: number | null }>(
    `select status, payment_id from public."PaymentIntents" where id = $1`,
    [id],
  );
  return { status: row.status, payment_id: row.payment_id == null ? null : Number(row.payment_id) };
}

async function chargeRow(id: number) {
  const [row] = await sql<{ amount_paid: string; status: string }>(
    `select amount_paid::text as amount_paid, status from public."RentCharges" where id = $1`,
    [id],
  );
  return { amount_paid: Number(row.amount_paid), status: row.status };
}

async function paymentsFor(chargeId: number) {
  return sql<{ id: number; amount: string; method: string; reference: string | null; notes: string | null }>(
    `select id, amount::text as amount, method, reference, notes from public."Payments" where charge_id = $1 order by id`,
    [chargeId],
  );
}

beforeAll(async () => {
  world = await resetWorld();
  const [lease] = await sql<{ id: number }>(
    `insert into public."Leases" (unit_id, primary_tenant_id, start_date, end_date, monthly_rent, status)
     values ($1, $2, '2026-01-01', '2099-12-31', $3, 'active') returning id`,
    [world.units.a.id, world.tenants.tenant.id, RENT],
  );
  leaseId = Number(lease.id);
  await sql(
    `insert into public."LeaseTenants" (lease_id, tenant_id) values ($1, $2) on conflict do nothing`,
    [leaseId, world.tenants.tenant.id],
  );
});

describe("[R9] Verifying Zelle payments", () => {
  describe("Zelle payments awaiting verification", () => {
    test("a payment the tenant reports waits for the office and does not move the balance", async () => {
      const chargeId = await freshCharge("2098-01");
      const intent = await tenantReportsZelle(chargeId, 725, "BANK-CONF-8841");

      expect(await chargeRow(chargeId)).toMatchObject({ amount_paid: 0 });
      expect(await paymentsFor(chargeId)).toHaveLength(0);

      await signInApp("admin");
      const awaiting = await listReportedZellePayments();
      const mine = awaiting.find((p) => p.id === intent.id);
      expect(mine).toMatchObject({
        charge_id: chargeId,
        tenant_id: world.tenants.tenant.id,
        amount: 725,
        method: "zelle",
        payer_name: "Tina Renter",
        client_reference: intent.client_reference,
        bank_confirmation_ref: "BANK-CONF-8841",
      });
      // The row says which period and home it belongs to, whatever month the page is showing.
      expect(mine?.charge).toMatchObject({ period: "2098-01", unit_id: world.units.a.id, property_id: world.property.id });
      expect(Number.isNaN(Date.parse(mine?.reported_at ?? ""))).toBe(false);
    });

    test("an admin confirms it: a Zelle payment lands on the charge and the item leaves the list", async () => {
      const chargeId = await freshCharge("2098-02");
      const intent = await tenantReportsZelle(chargeId, 725);

      await signInApp("admin");
      const confirmed = await confirmZellePayment(intent.id, "  Matched deposit on the 3rd  ");
      expect(confirmed).toMatchObject({ intent_id: intent.id, charge_id: chargeId, amount: 725, status: "succeeded" });
      expect(confirmed.payment_id).toEqual(expect.any(Number));

      expect(await intentRow(intent.id)).toEqual({ status: "succeeded", payment_id: confirmed.payment_id });
      expect(await chargeRow(chargeId)).toEqual({ amount_paid: 725, status: "partial" });
      const payments = await paymentsFor(chargeId);
      expect(payments).toHaveLength(1);
      expect(payments[0]).toMatchObject({
        id: confirmed.payment_id,
        method: "zelle",
        reference: intent.client_reference,
        notes: "Matched deposit on the 3rd",
      });
      expect(Number(payments[0].amount)).toBe(725);

      // What the Rent page reads after the confirm.
      expect((await listReportedZellePayments()).map((p) => p.id)).not.toContain(intent.id);
      const charge = (await data.listCharges("2098-02")).find((c) => c.id === chargeId);
      expect(charge).toMatchObject({ amount_paid: 725, status: "partial" });
      expect((await data.listPayments(chargeId)).map((p) => p.id)).toEqual([confirmed.payment_id]);
    });

    test("confirming the full balance marks the charge paid, and blank notes get the default note", async () => {
      const chargeId = await freshCharge("2098-03");
      const intent = await tenantReportsZelle(chargeId, RENT);

      await signInApp("admin");
      const confirmed = await confirmZellePayment(intent.id, "   ");
      expect(confirmed.status).toBe("succeeded");
      expect(await chargeRow(chargeId)).toEqual({ amount_paid: RENT, status: "paid" });
      expect((await paymentsFor(chargeId))[0]).toMatchObject({ notes: "Admin-confirmed Zelle" });
    });

    test("only an admin can confirm: everyone else is refused and nothing is recorded", async () => {
      const chargeId = await freshCharge("2098-04");
      const intent = await tenantReportsZelle(chargeId, 500);

      // Including the tenant who reported it, and the landlord who can see it.
      for (const persona of ["tenant", "tenant2", "worker", "landlord", "pending"] as const) {
        const client: SupabaseClient = await clientFor(persona);
        const { data: row, error } = await client.rpc("confirm_zelle_payment", { p_intent_id: intent.id });
        expect(row, persona).toBeNull();
        expect(error?.message, persona).toMatch(/only admins can confirm zelle payments/i);
      }
      const anon = await anonClient().rpc("confirm_zelle_payment", { p_intent_id: intent.id });
      expect(anon.error).not.toBeNull();
      expect(anon.data).toBeNull();

      // The app's own function surfaces the database's message for a non-admin.
      await signInApp("tenant");
      await expect(confirmZellePayment(intent.id)).rejects.toThrow(/only admins can confirm zelle payments/i);

      expect(await intentRow(intent.id)).toEqual({ status: "zelle_reported", payment_id: null });
      expect(await chargeRow(chargeId)).toMatchObject({ amount_paid: 0 });
      expect(await paymentsFor(chargeId)).toHaveLength(0);
    });

    test("who can see the waiting payment: the office, its tenant and its landlord — not other tenants or workers", async () => {
      const chargeId = await freshCharge("2098-05");
      const intent = await tenantReportsZelle(chargeId, 300);

      for (const persona of ["admin", "tenant", "landlord"] as const) {
        const client = await clientFor(persona);
        const { data: rows } = await client.from("PaymentIntents").select("id").eq("id", intent.id);
        expect(rows, persona).toEqual([{ id: intent.id }]);
      }
      for (const persona of ["tenant2", "worker", "pending"] as const) {
        const client = await clientFor(persona);
        const { data: rows } = await client.from("PaymentIntents").select("id").eq("id", intent.id);
        expect(rows ?? [], persona).toEqual([]);
      }
    });

    test("a confirmed payment cannot be confirmed twice", async () => {
      const chargeId = await freshCharge("2098-06");
      const intent = await tenantReportsZelle(chargeId, 400);

      await signInApp("admin");
      await confirmZellePayment(intent.id);
      await expect(confirmZellePayment(intent.id)).rejects.toThrow(/not awaiting zelle confirmation/i);
      expect(await paymentsFor(chargeId)).toHaveLength(1);
      expect(await chargeRow(chargeId)).toEqual({ amount_paid: 400, status: "partial" });
    });

    test("confirming is refused when the charge no longer owes that much, and the report stays waiting", async () => {
      const chargeId = await freshCharge("2098-07");
      const intent = await tenantReportsZelle(chargeId, 1000);

      // The office recorded the same money by hand before verifying the report.
      await signInApp("admin");
      await data.recordPayment({ charge_id: chargeId, amount: 1000, method: "other", reference: "by hand" });
      await expect(confirmZellePayment(intent.id)).rejects.toThrow(/exceeds live remaining balance/i);

      expect(await intentRow(intent.id)).toEqual({ status: "zelle_reported", payment_id: null });
      expect(await chargeRow(chargeId)).toEqual({ amount_paid: 1000, status: "partial" });
      expect(await paymentsFor(chargeId)).toHaveLength(1);
      // There is no database function to decline or dismiss a report, so it still shows.
      expect((await listReportedZellePayments()).map((p) => p.id)).toContain(intent.id);
    });
  });
});
