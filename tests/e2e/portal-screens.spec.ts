/**
 * Screen-level checks for the requirements, in a real browser: who gets which
 * portal, the login / sign-up / reset screens, the approval queue, and the
 * property + document screens.
 */
import type { Page } from "@playwright/test";
import { choose, expect, outbox, PASSWORD, resetWorld, selectUnder, shot, signIn, signOut, sql, test, type World } from "./support";

const nav = (page: Page) => page.getByRole("navigation", { name: "Primary" });
const navLinks = async (page: Page) => (await nav(page).getByRole("link").allInnerTexts()).map((t) => t.trim());

test.describe("[R8] Admin web portal — who sees what", () => {
  test.beforeAll(async () => {
    await resetWorld();
  });

  test("a signed-out visitor gets the login page, whatever address they open", async ({ page }, testInfo) => {
    for (const path of ["/dashboard", "/users", "/maintenance", "/properties/1"]) {
      await page.goto(path);
      await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
      await expect(nav(page)).toHaveCount(0);
    }
    await shot(page, testInfo, "Login page");
  });

  test("an admin sees the dashboard and every section of the portal", async ({ page }, testInfo) => {
    await signIn(page, "admin");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByText("Occupancy").first()).toBeVisible();
    await expect(page.getByText("Open work orders").first()).toBeVisible();
    expect(await navLinks(page)).toEqual([
      "Properties",
      "Landlords",
      "Tenants",
      "Leases",
      "Rent",
      "Maintenance",
      "Users",
      "Rental applications",
      "Settings",
    ]);
    await shot(page, testInfo, "Admin dashboard");
  });

  test("a worker gets the staff portal without Users or Rental applications", async ({ page }, testInfo) => {
    await signIn(page, "worker");
    const links = await navLinks(page);
    expect(links).toContain("Maintenance");
    expect(links).not.toContain("Users");
    expect(links).not.toContain("Rental applications");
    await page.goto("/users");
    await expect(page.getByRole("heading", { name: "Admins only" })).toBeVisible();
    await page.goto("/applications");
    await expect(page.getByRole("heading", { name: "Admins only" })).toBeVisible();
    await shot(page, testInfo, "Worker is kept out of admin screens");
  });

  test("a tenant gets the tenant portal: My requests and Documents only", async ({ page }, testInfo) => {
    await signIn(page, "tenant");
    // "My requests" is the home page (the portal title links to it); Documents is the only other section.
    expect(await navLinks(page)).toEqual(["Documents"]);
    await expect(page.getByRole("link", { name: "LG Tenant Portal" })).toHaveAttribute("href", "/maintenance");
    await expect(page.getByRole("heading", { name: "My requests" })).toBeVisible();
    await page.goto("/properties");
    await expect(page, "staff pages bounce a tenant back to their requests").toHaveURL(/\/maintenance$/);
    await page.goto("/users");
    await expect(page).toHaveURL(/\/maintenance$/);
    await shot(page, testInfo, "Tenant portal");
  });

  test("a landlord gets a read-only portal with their properties and maintenance", async ({ page }, testInfo) => {
    await signIn(page, "landlord");
    // Properties is the home page (the portal title links to it); Maintenance is the only other section.
    expect(await navLinks(page)).toEqual(["Maintenance"]);
    await expect(page.getByRole("link", { name: "LG Landlord Portal" })).toHaveAttribute("href", "/properties");
    await expect(page.getByText("Read-only")).toBeVisible();
    await expect(page.getByText("Maple Court")).toBeVisible();
    await expect(page.getByText("Birch House"), "another landlord's property").toHaveCount(0);
    await expect(page.getByRole("button", { name: "New property" })).toHaveCount(0);
    await shot(page, testInfo, "Landlord portal");
  });
});

test.describe("[R1] Accounts and login — screens", () => {
  let world: World;
  test.beforeAll(async () => {
    world = await resetWorld();
  });

  test("a wrong password shows an error and stays on the login page", async ({ page }, testInfo) => {
    await page.goto("/");
    await page.getByLabel("Email").fill("admin@test.local");
    await page.getByLabel("Password").fill("definitely-wrong");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByText("Invalid login credentials")).toBeVisible();
    await expect(nav(page)).toHaveCount(0);
    await shot(page, testInfo, "Wrong password");
  });

  test("a signed-in user stays signed in after a refresh, and can sign out", async ({ page }) => {
    await signIn(page, "admin");
    await page.reload();
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByText("admin@test.local")).toBeVisible();
    await signOut(page);
    await page.goto("/dashboard");
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  });

  test("sign-up asks the user to verify their email, then holds them as pending", async ({ page }, testInfo) => {
    await sql(
      `insert into public."Tenants" (first_name, last_name, email, unit_id, primary_on_lease, invite_to_app)
       values ('Nina', 'Newcomer', 'nina@signup.test', $1, false, true)`,
      [world.units.b.id],
    );
    await page.goto("/");
    await page.getByRole("button", { name: "Need an account? Sign up" }).click();
    await page.getByLabel("Email").fill("nina@signup.test");
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign up", exact: true }).click();
    await expect(page.getByText("Check your email to verify your account")).toBeVisible();
    await shot(page, testInfo, "Sign-up confirmation message");

    const mail = (await outbox()).find((m) => m.to === "nina@signup.test" && m.type === "signup");
    expect(mail, "a verification email was sent").toBeTruthy();
    await page.goto(mail!.link);
    await expect(page.getByRole("heading", { name: "Account not approved" })).toBeVisible();
    await expect(page.getByText("An admin must approve your account")).toBeVisible();
    await shot(page, testInfo, "Verified but waiting for approval");
  });

  test("forgot password: request a link, choose a new password, sign in with it", async ({ page }, testInfo) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Forgot password?" }).click();
    await expect(page.getByRole("heading", { name: "Reset password" })).toBeVisible();
    await page.getByLabel("Email").fill("worker2@test.local");
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect.poll(async () => (await outbox()).some((m) => m.to === "worker2@test.local" && m.type === "recovery")).toBe(true);
    await shot(page, testInfo, "Reset link requested");

    const mail = (await outbox()).find((m) => m.to === "worker2@test.local" && m.type === "recovery")!;
    expect(mail.link).toContain(encodeURIComponent("/reset-password"));
    await page.goto(mail.link);
    await expect(page.getByRole("heading", { name: "Choose a new password" })).toBeVisible();
    await page.getByLabel("New password").fill("BrandNew456!");
    await page.getByRole("button", { name: "Update password" }).click();
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();

    await signOut(page);
    await signIn(page, { email: "worker2@test.local", password: "BrandNew456!" });
  });
});

test.describe("[R2] Account approval — screens", () => {
  test.beforeAll(async () => {
    await resetWorld();
  });

  test("a pending user sees 'Account not approved' instead of the portal", async ({ page }, testInfo) => {
    await page.goto("/");
    await page.getByLabel("Email").fill("pending@test.local");
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Account not approved" })).toBeVisible();
    await expect(nav(page)).toHaveCount(0);
    await shot(page, testInfo, "Pending user is blocked");
  });

  test("an admin approves a pending account on the Users page, and that user gets in", async ({ page, browser }, testInfo) => {
    // The pending user is already signed in and waiting in another browser.
    const waiting = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
    const theirPage = await waiting.newPage();
    await theirPage.goto("/");
    await theirPage.getByLabel("Email").fill("pending@test.local");
    await theirPage.getByLabel("Password").fill(PASSWORD);
    await theirPage.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(theirPage.getByRole("heading", { name: "Account not approved" })).toBeVisible();

    await signIn(page, "admin");
    await page.goto("/users");
    await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();
    await page.getByRole("button", { name: /^Pending/ }).click();
    const row = page.locator("div.space-y-3 > div", { hasText: "pending@test.local" }).first();
    await expect(row).toBeVisible();
    await shot(page, testInfo, "Approval queue");
    await row.getByRole("button", { name: "Approve", exact: true }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Approve" }).click();
    await page.getByRole("button", { name: /^Approved/ }).click();
    await expect(page.locator("div.space-y-3 > div", { hasText: "pending@test.local" }).first()).toBeVisible();
    await shot(page, testInfo, "Account approved");

    await theirPage.getByRole("button", { name: "Check again" }).click();
    await expect(theirPage.getByRole("button", { name: "Sign out" })).toBeVisible();
    await expect(theirPage.getByRole("navigation", { name: "Primary" })).toBeVisible();
    await waiting.close();
  });

  test("an admin suspends an account on the Users page, and that user is locked out", async ({ page }, testInfo) => {
    await signIn(page, "admin");
    await page.goto("/users");
    await page.getByRole("button", { name: /^Approved/ }).click();
    const row = page.locator("div.space-y-3 > div", { hasText: "worker2@test.local" }).first();
    await row.getByRole("button", { name: "Suspend", exact: true }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Suspend" }).click();
    await shot(page, testInfo, "After clicking Suspend");
    await page.getByRole("button", { name: /^Suspended/ }).click();
    await expect(
      page.locator("div.space-y-3 > div", { hasText: "worker2@test.local" }).first(),
      "worker2 should now be listed under Suspended",
    ).toBeVisible();

    await signOut(page);
    await page.getByLabel("Email").fill("worker2@test.local");
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Account not approved" })).toBeVisible();
  });
});

test.describe("[R3] Properties and units — screens", () => {
  test.beforeAll(async () => {
    await resetWorld();
  });

  test("an admin sees the portfolio on the Properties page", async ({ page }, testInfo) => {
    await signIn(page, "admin");
    await page.goto("/properties");
    await expect(page.getByText("Maple Court")).toBeVisible();
    await expect(page.getByText("Birch House")).toBeVisible();
    await shot(page, testInfo, "Properties list");
  });

  test("an admin adds a property from the Properties page", async ({ page }, testInfo) => {
    await signIn(page, "admin");
    await page.goto("/properties");
    await page.getByRole("button", { name: "New property" }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill("Cedar Row");
    await choose(page, selectUnder(dialog, "Landlord"), /Owner/);
    await dialog.getByLabel("Address").fill("4 Cedar Row");
    await dialog.getByLabel("City").fill("Baltimore");
    await dialog.getByLabel("State").fill("MD");
    await dialog.getByLabel("Zip").fill("21202");
    await dialog.getByRole("button", { name: "Create property" }).click();
    await shot(page, testInfo, "After clicking Create property");
    await expect(dialog, "the dialog closes when the property is saved").toBeHidden();
    await expect(page.getByText("Cedar Row")).toBeVisible();
  });
});

test.describe("[R5] Property documents — screens", () => {
  let world: World;
  test.beforeAll(async () => {
    world = await resetWorld();
  });

  test("an admin uploads a document and shares it with tenants", async ({ page }, testInfo) => {
    await signIn(page, "admin");
    await page.goto(`/properties/${world.property.id}`);
    await expect(page.getByRole("heading", { name: "Documents" })).toBeVisible();
    await page.getByRole("button", { name: "Upload" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Title").fill("House rules");
    await dialog.locator("#doc-file").setInputFiles({
      name: "house-rules.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\n% house rules\n"),
    });
    await choose(page, selectUnder(dialog, "Visibility"), "Tenant (+ landlord + staff)");
    await dialog.getByRole("button", { name: "Upload", exact: true }).click();
    await expect(page.getByText("Document uploaded.")).toBeVisible();
    await expect(page.getByText("House rules", { exact: true })).toBeVisible();
    await shot(page, testInfo, "Document uploaded on the property page");
  });

  test("the tenant finds the shared document under Documents; a staff-only one stays hidden", async ({ page }, testInfo) => {
    await sql(
      `insert into public."PropertyDocuments" (property_id, title, file_name, storage_path, visibility)
       values ($1, 'Vendor contracts', 'contracts.pdf', $2, 'staff')`,
      [world.property.id, `${world.property.id}/contracts.pdf`],
    );
    await signIn(page, "tenant");
    await page.goto("/documents");
    await expect(page.getByRole("heading", { name: "Documents" })).toBeVisible();
    await expect(page.getByText("House rules", { exact: true })).toBeVisible();
    await expect(page.getByText("Vendor contracts")).toHaveCount(0);
    await shot(page, testInfo, "Tenant's Documents page");
  });
});
