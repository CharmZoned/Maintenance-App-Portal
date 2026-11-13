/**
 * R2 — Account approval
 * Pending status; admins approve, reject, or suspend accounts.
 */
import { beforeAll, describe, expect, test } from "vitest";
import * as data from "@/lib/data";
import {
  anonClient,
  clientFor,
  expectDenied,
  PERSONAS,
  resetWorld,
  signInApp,
  sql,
  type World,
} from "../support/harness";

let world: World;

beforeAll(async () => {
  world = await resetWorld();
});

async function statusOf(userId: string): Promise<string | undefined> {
  const rows = await sql<{ account_status: string }>(
    `select account_status from public.user_roles where user_id = $1`,
    [userId],
  );
  return rows[0]?.account_status;
}

/** Put an account into a state directly (SQL editor), so a test does not depend on another feature working. */
async function setStatusFixture(userId: string, status: string): Promise<void> {
  await sql(`update public.user_roles set account_status = $2 where user_id = $1`, [userId, status]);
}

/**
 * A verified login with no role row. The sign-up trigger leaves these behind
 * when an email matches more than one of Landlord / Tenant / Staff.
 */
async function roleLessLogin(name: string): Promise<string> {
  const email = `${name}@dual.test`;
  await sql(`insert into public."Landlords" (first_name, last_name, email) values ($1, 'Dual', $2)`, [name, email]);
  await sql(
    `insert into public."Staff" (first_name, last_name, email, gets_request_alerts) values ($1, 'Dual', $2, true)`,
    [name, email],
  );
  const login = await sql<{ id: string }>(
    `insert into auth.users (email, encrypted_password, email_confirmed_at) values ($1, 'x', now()) returning id`,
    [email],
  );
  expect(await statusOf(login[0].id), "ambiguous sign-ups get no role").toBeUndefined();
  return login[0].id;
}

describe("[R2] Account approval", () => {
  describe("pending accounts", () => {
    test("a new account starts as pending", async () => {
      expect(await statusOf(world.users.pending.id)).toBe("pending");
    });

    test("a pending user can sign in but sees no portfolio data", async () => {
      const client = await clientFor("pending");
      for (const table of ["Properties", "Units", "Tenants", "MaintenanceRequests", "Vendors", "Leases"]) {
        expectDenied(await client.from(table).select("*"), `pending user must not read ${table}`);
      }
    });

    test("a pending user can still read their own status (for the 'waiting for approval' screen)", async () => {
      const client = await clientFor("pending");
      const { data: row } = await client.from("user_roles").select("account_status").maybeSingle();
      expect(row?.account_status).toBe("pending");
    });
  });

  describe("the admin approval queue", () => {
    test("an admin sees every account with its email and status, pending first", async () => {
      await signInApp("admin");
      const accounts = await data.listUserAccounts();
      expect(accounts.length).toBe(Object.keys(PERSONAS).length);
      expect(accounts[0]).toMatchObject({ email: PERSONAS.pending.email, account_status: "pending" });
      expect(accounts.find((a) => a.email === PERSONAS.admin.email)).toMatchObject({
        role: "admin",
        account_status: "approved",
      });
    });

    test("an admin approves a pending worker, who then gets access", async () => {
      await signInApp("admin");
      const row = await data.setAccountStatus(world.users.pending.id, "approved");
      expect(row.account_status).toBe("approved");

      const client = await clientFor("pending");
      const { data: staff, error } = await client.from("Staff").select("id");
      expect(error).toBeNull();
      expect(staff).toEqual([{ id: world.staff.pending.id }]);
    });

    test("an admin suspends an approved user, who loses access immediately", async () => {
      const client = await clientFor("worker2"); // signed in before the suspension
      expect((await client.from("Staff").select("id")).data?.length).toBe(1);

      await signInApp("admin");
      await data.setAccountStatus(world.users.worker2.id, "suspended");

      expectDenied(await client.from("Staff").select("id"), "suspended user must lose access on their next request");
      expect(await statusOf(world.users.worker2.id)).toBe("suspended");
    });

    test("an admin can re-approve a suspended user", async () => {
      await setStatusFixture(world.users.worker2.id, "suspended");
      await signInApp("admin");
      await data.setAccountStatus(world.users.worker2.id, "approved");
      const client = await clientFor("worker2");
      expect((await client.from("Staff").select("id")).data?.length).toBe(1);
    });

    test("an admin rejects an account, which stays locked out", async () => {
      await signInApp("admin");
      await data.setAccountStatus(world.users.tenant2.id, "rejected");
      const client = await clientFor("tenant2");
      expectDenied(await client.from("MaintenanceRequests").select("id"));
      expectDenied(await client.from("Units").select("id"));
      expect(await statusOf(world.users.tenant2.id)).toBe("rejected");
    });

    test("an admin approves a tenant who is linked to a tenant record", async () => {
      await setStatusFixture(world.users.tenant2.id, "pending");
      await signInApp("admin");
      const row = await data.setAccountStatus(world.users.tenant2.id, "approved");
      expect(row.account_status).toBe("approved");
      const client = await clientFor("tenant2");
      expect((await client.from("Units").select("id")).data).toEqual([{ id: world.units.b.id }]);
    });

    test("an unknown status value is refused", async () => {
      await signInApp("admin");
      await expect(data.setAccountStatus(world.users.pending.id, "vip" as never)).rejects.toThrow(
        /invalid account_status/i,
      );
    });
  });

  describe("assigning roles", () => {
    test("an admin links a login that has no role to a staff record, then approves it", async () => {
      const login = await roleLessLogin("uma");
      const staff = await sql<{ id: number }>(
        `insert into public."Staff" (first_name, last_name, email, gets_request_alerts)
         values ('Uma', 'Unlinked', 'uma.staffrecord@test.local', true) returning id`,
      );
      await signInApp("admin");
      const linked = await data.adminSetUserRole(login, "maintenance", { staff_id: Number(staff[0].id) });
      expect(linked).toMatchObject({ role: "maintenance", account_status: "pending" });
      const approved = await data.setAccountStatus(login, "approved");
      expect(approved.account_status).toBe("approved");
    });

    test("a login with no role cannot be approved until a role is assigned", async () => {
      const login = await roleLessLogin("rory");
      await signInApp("admin");
      await expect(data.setAccountStatus(login, "approved")).rejects.toThrow(/assign a role before approving/i);
    });

    test("an admin approves a landlord who is linked to a landlord record", async () => {
      await setStatusFixture(world.users.landlord.id, "pending");
      await signInApp("admin");
      const row = await data.setAccountStatus(world.users.landlord.id, "approved");
      expect(row).toMatchObject({ role: "landlord", account_status: "approved" });
      const client = await clientFor("landlord");
      expect((await client.from("Properties").select("id")).data).toEqual([{ id: world.property.id }]);
    });

    test("an approved worker cannot have their staff link removed", async () => {
      await signInApp("admin");
      await expect(data.adminSetUserRole(world.users.worker.id, "maintenance", { staff_id: null })).rejects.toThrow(
        /cannot clear staff link while approved/i,
      );
    });

    test("an admin can reject a sign-up that has no role yet", async () => {
      const login = await roleLessLogin("dana");
      await signInApp("admin");
      const row = await data.setAccountStatus(login, "rejected");
      expect(row.account_status).toBe("rejected");
    });
  });

  describe("only admins manage accounts", () => {
    test.each(["worker", "tenant", "landlord", "pending"] as const)(
      "a %s cannot change anyone's account status",
      async (persona) => {
        const client = await clientFor(persona);
        const { error } = await client.rpc("set_account_status", {
          p_user_id: world.users[persona].id,
          p_status: "approved",
        });
        expect(error?.message).toMatch(/only admins/i);
      },
    );

    test("a non-admin cannot list accounts", async () => {
      const client = await clientFor("worker");
      const { data: rows, error } = await client.rpc("list_user_accounts_for_admin");
      expect(rows).toBeNull();
      expect(error?.message).toMatch(/only admins/i);
    });

    test("a non-admin cannot assign roles", async () => {
      const client = await clientFor("worker");
      const { error } = await client.rpc("admin_set_user_role", {
        p_user_id: world.users.worker.id,
        p_role: "admin",
      });
      expect(error?.message).toMatch(/only admins/i);
    });

    test("nobody can edit their own role row directly", async () => {
      const client = await clientFor("pending");
      const attempt = await client
        .from("user_roles")
        .update({ account_status: "approved", role: "admin" })
        .eq("user_id", world.users.pending.id)
        .select();
      expectDenied(attempt, "direct UPDATE on user_roles must be refused");
      const rows = await sql<{ role: string }>(`select role from public.user_roles where user_id = $1`, [
        world.users.pending.id,
      ]);
      expect(rows[0].role).toBe("maintenance");
    });

    test("a signed-out visitor cannot call the account functions", async () => {
      const { error } = await anonClient().rpc("list_user_accounts_for_admin");
      expect(error).not.toBeNull();
    });
  });
});

