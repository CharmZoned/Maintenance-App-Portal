/**
 * WF2 — New account onboarding
 *
 *   Staff add a tenant record  →  Tenant signs up and verifies their email  →
 *   Tenant waits (pending)  →  Admin approves  →  Tenant can use the portal.
 */
import { beforeAll, describe, expect, test } from "vitest";
import * as data from "@/lib/data";
import {
  anonClient,
  clientForLogin,
  expectDenied,
  followMailLink,
  outbox,
  resetWorld,
  signInApp,
  sql,
  type World,
} from "../support/harness";

const EMAIL = "newtenant@onboard.test";
const SECRET = "Welcome-2-the-portal";
let world: World;
let userId: string;

beforeAll(async () => {
  world = await resetWorld();
});

describe("[WF2] New account onboarding", () => {
  test("Staff · a tenant record exists for the new resident", async () => {
    // Created in the database directly: the portal's own 'create tenant' screen is covered by R3.
    await sql(
      `insert into public."Units" (property_id, unit_label, status) values ($1, '5E', 'Occupied')`,
      [world.property.id],
    );
    await sql(
      `insert into public."Tenants" (first_name, last_name, email, unit_id, primary_on_lease, invite_to_app)
       select 'Noor', 'Newly', $1, id, true, true from public."Units" where unit_label = '5E'`,
      [EMAIL],
    );
  });

  test("New tenant · signs up and is told to check their email", async () => {
    const { data: result, error } = await anonClient().auth.signUp({ email: EMAIL, password: SECRET });
    expect(error).toBeNull();
    expect(result.session, "no session before verification").toBeNull();
    userId = result.user!.id;
  });

  test("New tenant · cannot sign in before verifying", async () => {
    const { error } = await anonClient().auth.signInWithPassword({ email: EMAIL, password: SECRET });
    expect(error?.message).toMatch(/email not confirmed/i);
  });

  test("New tenant · clicks the link in the verification email", async () => {
    const mail = (await outbox()).find((m) => m.to === EMAIL && m.type === "signup");
    expect(mail).toBeTruthy();
    const session = await followMailLink(mail!.link);
    expect(session.access_token).toBeTruthy();
  });

  test("New tenant · can sign in but is held as 'pending' and sees no data", async () => {
    const client = await clientForLogin(EMAIL, SECRET);
    const { data: role } = await client.from("user_roles").select("*").maybeSingle();
    expect(role).toMatchObject({ role: "tenant", account_status: "pending" });
    expectDenied(await client.from("Units").select("*"));
    expectDenied(await client.from("MaintenanceRequests").select("*"));
  });

  test("Admin · finds the new account at the top of the approval queue", async () => {
    await signInApp("admin");
    const accounts = await data.listUserAccounts();
    const pending = accounts.filter((a) => a.account_status === "pending").map((a) => a.email);
    expect(pending).toContain(EMAIL);
    expect(accounts.find((a) => a.email === EMAIL)).toMatchObject({ role: "tenant", user_id: userId });
  });

  test("Admin · approves the account", async () => {
    await signInApp("admin");
    const row = await data.setAccountStatus(userId, "approved");
    expect(row).toMatchObject({ account_status: "approved", role: "tenant" });
  });

  test("New tenant · now sees their unit and submits their first request", async () => {
    await signInApp({ email: EMAIL, password: SECRET });
    expect(await data.getTenantHomeContext()).toMatchObject({ unit_label: "5E", property_name: "Maple Court" });
    const wo = await data.submitTenantMaintenanceRequest({
      title: "Move-in: missing smoke detector battery",
      description: "The detector in the hallway chirps.",
      category: "Electrical",
      permission_to_enter: true,
    });
    expect(wo.status).toBe("open");
  });

  test("Admin · suspends the account and the tenant is locked out again", async () => {
    await signInApp("admin");
    await data.setAccountStatus(userId, "suspended");
    const client = await clientForLogin(EMAIL, SECRET);
    expectDenied(await client.from("MaintenanceRequests").select("*"));
  });
});
