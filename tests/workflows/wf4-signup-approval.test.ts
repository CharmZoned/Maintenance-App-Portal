/**
 * WF4 — Public sign-up approval (tenant and owner)
 *
 *   Person signs up from the website as a tenant or an owner, with no matching
 *   record on file  →  verifies their email  →  Admin sees their name, chosen
 *   role and address on Approvals  →  Admin approves in one step, linking an
 *   existing record or creating one from the sign-up  →  they sign in to
 *   their own home.
 *
 * Before 20261124090000 this deadlocked: unmatched sign-ups are stored as
 * pending 'maintenance' with no link, and switching them to tenant/landlord
 * without a link broke the user_roles CHECK.
 */
import { beforeAll, describe, expect, test } from "vitest";
import * as data from "@/lib/data";
import {
  anonClient,
  clientFor,
  clientForLogin,
  followMailLink,
  outbox,
  resetWorld,
  signInApp,
  sql,
  type World,
} from "../support/harness";

const TENANT = { email: "nina.renter@signup.test", password: "Signup-Tenant-1", name: "Nina Renter", address: "12 Elm St, Apt 3" };
const OWNER = { email: "omar.owner@signup.test", password: "Signup-Owner-1", name: "Omar Owner", address: "400 Harbor Rd" };
const OWNER2 = { email: "olga.owner@signup.test", password: "Signup-Owner-2", name: "Olga Newowner", address: "9 Bay Ln" };

let world: World;
const ids: Record<string, string> = {};

async function signUpAndVerify(
  who: { email: string; password: string; name: string; address: string },
  intent: "tenant" | "landlord",
): Promise<string> {
  const { data: result, error } = await anonClient().auth.signUp({
    email: who.email,
    password: who.password,
    options: { data: { full_name: who.name, intent_role: intent, signup_address: who.address } },
  });
  expect(error).toBeNull();
  const mail = (await outbox()).find((m) => m.to === who.email && m.type === "signup");
  await followMailLink(mail!.link);
  return result.user!.id;
}

beforeAll(async () => {
  world = await resetWorld();
});

describe("[WF4] Sign-up approval as tenant or owner", () => {
  test("New tenant · signs up as a tenant with their name and address, and verifies", async () => {
    ids.tenant = await signUpAndVerify(TENANT, "tenant");
    const [row] = await sql<{ role: string; account_status: string; tenant_id: number | null }>(
      `select role, account_status, tenant_id from public.user_roles where user_id = $1`,
      [ids.tenant],
    );
    // No record on file: stored as the unlinked queue row.
    expect(row).toMatchObject({ role: "maintenance", account_status: "pending", tenant_id: null });
  });

  test("New owner · signs up as an owner and verifies", async () => {
    ids.owner = await signUpAndVerify(OWNER, "landlord");
    ids.owner2 = await signUpAndVerify(OWNER2, "landlord");
  });

  test("Admin · sees each applicant's name, chosen role and address", async () => {
    await signInApp("admin");
    const accounts = await data.listUserAccounts();
    expect(accounts.find((a) => a.user_id === ids.tenant)).toMatchObject({
      email: TENANT.email,
      account_status: "pending",
      full_name: TENANT.name,
      intent_role: "tenant",
      signup_address: TENANT.address,
    });
    expect(accounts.find((a) => a.user_id === ids.owner)).toMatchObject({
      full_name: OWNER.name,
      intent_role: "landlord",
      signup_address: OWNER.address,
    });
  });

  test("Admin · the old two-step path explains itself instead of a raw constraint error", async () => {
    await signInApp("admin");
    await expect(data.adminSetUserRole(ids.tenant, "tenant", { tenant_id: null })).rejects.toThrow(
      /needs a linked record/i,
    );
  });

  test("Admin · approves the tenant, creating their Tenant record from the sign-up", async () => {
    await signInApp("admin");
    const row = await data.assignAccountRole(ids.tenant, "tenant", {
      approve: true,
      create: {
        first_name: "Nina",
        last_name: "Renter",
        email: TENANT.email,
        notes: `Address given at sign-up: ${TENANT.address}`,
      },
    });
    expect(row).toMatchObject({ role: "tenant", account_status: "approved" });
    expect(row.tenant_id).toBeTruthy();
    const [tenant] = await sql<{ first_name: string; email: string; notes: string }>(
      `select first_name, email, notes from public."Tenants" where id = $1`,
      [row.tenant_id],
    );
    expect(tenant).toMatchObject({ first_name: "Nina", email: TENANT.email });
    expect(tenant.notes).toContain(TENANT.address);
  });

  test("New tenant · signs in to their tenant home", async () => {
    await signInApp({ email: TENANT.email, password: TENANT.password });
    const home = await data.getTenantHomeContext();
    expect(home).not.toBeNull();
    expect(home!.unit_id).toBeNull(); // no lease yet — Home shows the "waiting for a unit" state
  });

  test("Admin · approves the first owner by linking an existing Landlord record", async () => {
    // The office already has a record for this owner's company, under another email.
    const [landlord] = await sql<{ id: number }>(
      `insert into public."Landlords" (first_name, last_name, email, company_name)
       values ('Omar', 'Owner', 'office-copy@harbor.test', 'Harbor Holdings') returning id`,
    );
    await sql(`update public."Properties" set landlord_id = $1 where id = $2`, [landlord.id, world.otherProperty.id]);

    await signInApp("admin");
    const row = await data.assignAccountRole(ids.owner, "landlord", { approve: true, linkId: landlord.id });
    expect(row).toMatchObject({ role: "landlord", account_status: "approved", landlord_id: landlord.id });
  });

  test("New owner · signs in and sees their property", async () => {
    await signInApp({ email: OWNER.email, password: OWNER.password });
    const props = await data.listProperties();
    expect(props.map((p) => p.id)).toEqual([world.otherProperty.id]);
  });

  test("Admin · approves the second owner, creating their Landlord record", async () => {
    await signInApp("admin");
    const row = await data.assignAccountRole(ids.owner2, "landlord", {
      approve: true,
      create: { first_name: "Olga", last_name: "Newowner", email: OWNER2.email, phone: "(410) 555-0199" },
    });
    expect(row).toMatchObject({ role: "landlord", account_status: "approved" });
    const client = await clientForLogin(OWNER2.email, OWNER2.password);
    const { data: own } = await client.from("Landlords").select("first_name, mobile_phone");
    expect(own).toEqual([{ first_name: "Olga", mobile_phone: "(410) 555-0199" }]);
  });

  describe("guards", () => {
    test("Admin · cannot link a record another login already holds", async () => {
      const id = await signUpAndVerify(
        { email: "copycat@signup.test", password: "Signup-Copy-1", name: "Copy Cat", address: "" },
        "tenant",
      );
      await signInApp("admin");
      await expect(
        data.assignAccountRole(id, "tenant", { approve: true, linkId: world.tenants.tenant.id }),
      ).rejects.toThrow(/already linked to another login/i);
      await expect(
        data.assignAccountRole(id, "tenant", {
          approve: true,
          create: { first_name: "Copy", last_name: "Cat", email: "tenant@test.local" },
        }),
      ).rejects.toThrow(/already exists; link it instead/i);
      const [row] = await sql<{ account_status: string; role: string }>(
        `select account_status, role from public.user_roles where user_id = $1`,
        [id],
      );
      expect(row).toMatchObject({ account_status: "pending", role: "maintenance" });
    });

    test("Admin · cannot approve before the email is confirmed", async () => {
      const { data: result } = await anonClient().auth.signUp({
        email: "unverified@signup.test",
        password: "Signup-Unv-1",
        options: { data: { intent_role: "tenant" } },
      });
      await signInApp("admin");
      await expect(
        data.assignAccountRole(result.user!.id, "tenant", {
          approve: true,
          create: { first_name: "Un", last_name: "Verified", email: "unverified@signup.test" },
        }),
      ).rejects.toThrow(/haven't confirmed their email/i);
      const rows = await sql(`select 1 from public."Tenants" where email = 'unverified@signup.test'`);
      expect(rows, "no Tenant row is left behind").toEqual([]);
    });

    test("Admin · can set the role and link without approving (Users page)", async () => {
      const id = await signUpAndVerify(
        { email: "later@signup.test", password: "Signup-Later-1", name: "Lee Later", address: "" },
        "landlord",
      );
      await signInApp("admin");
      const row = await data.assignAccountRole(id, "landlord", {
        approve: false,
        create: { first_name: "Lee", last_name: "Later", email: "later@signup.test" },
      });
      expect(row).toMatchObject({ role: "landlord", account_status: "pending" });
      expect(row.landlord_id).toBeTruthy();
    });

    test("Worker · cannot call the approval RPC", async () => {
      const worker = await clientFor("worker");
      const { error } = await worker.rpc("admin_assign_account_role", {
        p_user_id: world.users.pending.id,
        p_role: "maintenance",
        p_link_id: world.staff.pending.id,
        p_approve: true,
      });
      expect(error?.message).toMatch(/only admins/i);
      expect(
        (await anonClient().rpc("admin_assign_account_role", { p_user_id: world.users.pending.id, p_role: "admin" }))
          .error,
      ).toBeTruthy();
    });
  });
});
