/**
 * R1 — Accounts and login
 * User accounts, passwords, email verification, password reset, and roles.
 */
import { beforeAll, describe, expect, test } from "vitest";
import {
  anonClient,
  clientFor,
  clientForLogin,
  expectDenied,
  followMailLink,
  outbox,
  PASSWORD,
  PERSONAS,
  resetWorld,
  sql,
  type World,
} from "../support/harness";

let world: World;

beforeAll(async () => {
  world = await resetWorld();
});

describe("[R1] Accounts and login", () => {
  describe("signing in", () => {
    test("a user signs in with email and password", async () => {
      const client = anonClient();
      const { data, error } = await client.auth.signInWithPassword({
        email: PERSONAS.admin.email,
        password: PASSWORD,
      });
      expect(error).toBeNull();
      expect(data.session?.access_token).toBeTruthy();
      expect(data.user?.email).toBe(PERSONAS.admin.email);
    });

    test("a wrong password is rejected", async () => {
      const { data, error } = await anonClient().auth.signInWithPassword({
        email: PERSONAS.admin.email,
        password: "not-the-password",
      });
      expect(data.session).toBeNull();
      expect(error?.message).toMatch(/invalid login credentials/i);
    });

    test("an unknown email is rejected with the same message (no account enumeration)", async () => {
      const { error } = await anonClient().auth.signInWithPassword({
        email: "nobody@nowhere.test",
        password: PASSWORD,
      });
      expect(error?.message).toMatch(/invalid login credentials/i);
    });

    test("a session can be refreshed without signing in again", async () => {
      const client = await clientFor("worker");
      const { data, error } = await client.auth.refreshSession();
      expect(error).toBeNull();
      expect(data.session?.user.email).toBe(PERSONAS.worker.email);
    });

    test("signing out ends access to data", async () => {
      const client = await clientFor("admin");
      expect((await client.from("Properties").select("id")).data?.length).toBeGreaterThan(0);
      await client.auth.signOut();
      expectDenied(await client.from("Properties").select("id"), "signed-out client must not read properties");
    });
  });

  describe("roles", () => {
    test.each([
      ["admin", "admin"],
      ["worker", "maintenance"],
      ["tenant", "tenant"],
      ["landlord", "landlord"],
    ] as const)("the %s account carries the %s role", async (persona, role) => {
      const client = await clientFor(persona);
      const { data, error } = await client.from("user_roles").select("*").maybeSingle();
      expect(error).toBeNull();
      expect(data?.role).toBe(role);
    });

    test("role records link each login to its Staff / Tenant / Landlord record", async () => {
      const worker = (await (await clientFor("worker")).from("user_roles").select("*").single()).data;
      const tenant = (await (await clientFor("tenant")).from("user_roles").select("*").single()).data;
      const landlord = (await (await clientFor("landlord")).from("user_roles").select("*").single()).data;
      expect(worker.staff_id).toBe(world.staff.worker.id);
      expect(tenant.tenant_id).toBe(world.tenants.tenant.id);
      expect(landlord.landlord_id).toBe(world.landlord.id);
    });

    test("a user can read only their own role record", async () => {
      const client = await clientFor("tenant");
      const { data } = await client.from("user_roles").select("user_id");
      expect(data).toEqual([{ user_id: world.users.tenant.id }]);
    });
  });

  describe("sign-up and email verification", () => {
    test("a new sign-up must verify their email before they can sign in", async () => {
      await sql(
        `insert into public."Tenants" (first_name, last_name, email, unit_id, primary_on_lease, invite_to_app)
         values ('Nina', 'Newcomer', 'nina@signup.test', $1, false, true)`,
        [world.units.b.id],
      );
      const client = anonClient();
      const signUp = await client.auth.signUp({ email: "nina@signup.test", password: PASSWORD });
      expect(signUp.error).toBeNull();
      expect(signUp.data.session, "no session until the email is verified").toBeNull();

      const before = await anonClient().auth.signInWithPassword({ email: "nina@signup.test", password: PASSWORD });
      expect(before.error?.message).toMatch(/email not confirmed/i);

      const mail = (await outbox()).find((m) => m.to === "nina@signup.test" && m.type === "signup");
      expect(mail, "a confirmation email is sent").toBeTruthy();
      await followMailLink(mail!.link);

      const after = await anonClient().auth.signInWithPassword({ email: "nina@signup.test", password: PASSWORD });
      expect(after.error).toBeNull();
    });

    test("signing up with a known tenant's email links the account to that tenant", async () => {
      const client = await clientForLogin("nina@signup.test");
      const { data } = await client.from("user_roles").select("*").maybeSingle();
      expect(data).toMatchObject({ role: "tenant", account_status: "pending" });
      expect(data.tenant_id).toBeGreaterThan(0);
    });

    test("signing up with a staff member's email links the account to that staff record", async () => {
      await sql(
        `insert into public."Staff" (first_name, last_name, email, gets_request_alerts)
         values ('Sasha', 'Hire', 'sasha@signup.test', true)`,
      );
      const { error } = await anonClient().auth.signUp({ email: "sasha@signup.test", password: PASSWORD });
      expect(error).toBeNull();
      const rows = await sql<{ role: string; staff_id: number | null; account_status: string }>(
        `select ur.role, ur.staff_id, ur.account_status
           from public.user_roles ur join auth.users u on u.id = ur.user_id
          where u.email = 'sasha@signup.test'`,
      );
      expect(rows[0]).toMatchObject({ role: "maintenance", account_status: "pending" });
      expect(rows[0].staff_id).not.toBeNull();
    });

    test("anyone can sign up, even if their email is not in the system yet", async () => {
      // Phase 2 decision: public sign-up → pending queue, admin assigns the role later.
      const { data, error } = await anonClient().auth.signUp({
        email: "stranger@signup.test",
        password: PASSWORD,
      });
      expect(error, `sign-up failed: ${error?.message}`).toBeNull();
      expect(data.user?.email).toBe("stranger@signup.test");
      const rows = await sql<{ account_status: string }>(
        `select ur.account_status from public.user_roles ur
           join auth.users u on u.id = ur.user_id where u.email = 'stranger@signup.test'`,
      );
      expect(rows[0]?.account_status).toBe("pending");
    });

    test("passwords shorter than 6 characters are rejected", async () => {
      const { error } = await anonClient().auth.signUp({ email: "short@signup.test", password: "abc" });
      expect(error?.message).toMatch(/at least 6 characters/i);
    });
  });

  describe("password reset", () => {
    test("a user can request a reset email and choose a new password", async () => {
      const email = PERSONAS.tenant2.email;
      const request = await anonClient().auth.resetPasswordForEmail(email, {
        redirectTo: "http://localhost:5173/reset-password",
      });
      expect(request.error).toBeNull();

      const mail = (await outbox()).find((m) => m.to === email && m.type === "recovery");
      expect(mail, "a recovery email is sent").toBeTruthy();
      expect(mail!.link).toContain(encodeURIComponent("http://localhost:5173/reset-password"));

      const session = await followMailLink(mail!.link);
      expect(session.type).toBe("recovery");
      const client = anonClient();
      await client.auth.setSession(session);
      const update = await client.auth.updateUser({ password: "BrandNew456!" });
      expect(update.error).toBeNull();

      const oldPw = await anonClient().auth.signInWithPassword({ email, password: PASSWORD });
      expect(oldPw.error?.message).toMatch(/invalid login credentials/i);
      const newPw = await anonClient().auth.signInWithPassword({ email, password: "BrandNew456!" });
      expect(newPw.error).toBeNull();
    });

    test("requesting a reset for an unknown email reveals nothing", async () => {
      const before = (await outbox()).length;
      const { error } = await anonClient().auth.resetPasswordForEmail("ghost@nowhere.test");
      expect(error).toBeNull();
      expect((await outbox()).length).toBe(before);
    });

    test("a reset link works only once", async () => {
      const email = PERSONAS.worker2.email;
      await anonClient().auth.resetPasswordForEmail(email);
      const mail = (await outbox()).filter((m) => m.to === email && m.type === "recovery").pop()!;
      await followMailLink(mail.link);
      await expect(followMailLink(mail.link)).rejects.toThrow(/did not grant a session/);
    });
  });
});
