/**
 * Screen-level checks for the requirements, in a real browser: who gets which
 * portal, the login / sign-up / reset screens, the approval queue, and the
 * property + document screens.
 */
import type { Page } from "@playwright/test";
import { choose, expect, outbox, PASSWORD, resetWorld, selectUnder, shot, signIn, signOut, sql, test, type World } from "./support";

const nav = (page: Page) => page.getByRole("navigation", { name: "Primary" });
/** The admin dashboard's page heading is its greeting. */
const GREETING = /^Good (morning|afternoon|evening)/;
const navLinks = async (page: Page) => (await nav(page).getByRole("link").allInnerTexts()).map((t) => t.trim());
/**
 * The landlord Documents page titles itself twice on purpose: once in the shell toolbar and once
 * in the page's own intro, under the "Your property records" eyebrow. This is the intro's heading.
 */
const landlordDocumentsHeading = (page: Page) =>
  page.locator("header", { hasText: "Your property records" }).getByRole("heading", { level: 1, name: "Documents", exact: true });
/**
 * A file on the landlord Documents page. Each row renders a phone and a desktop layout, so the
 * title text is in the DOM twice; the row's Download button is the one accessible handle.
 */
const landlordDocument = (page: Page, title: string) =>
  page.getByRole("button", { name: `Download ${title}`, exact: true });

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

  test("an admin sees the dashboard and the admin workspace nav", async ({ page }, testInfo) => {
    await signIn(page, "admin");
    await expect(page.getByText("Admin workspace / Dashboard")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: GREETING })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Needs your attention" })).toBeVisible();
    const kpis = page.getByRole("list", { name: "Portfolio KPIs" });
    await expect(kpis.getByText("Open requests")).toBeVisible();
    await expect(kpis.getByText("Approvals waiting")).toBeVisible();
    // Count badges append to a link's text ("People 1 …"), so compare the label line only.
    expect((await navLinks(page)).map((text) => text.split("\n")[0])).toEqual([
      "Dashboard",
      "Maintenance",
      "Properties",
      "Rent",
      "People",
      "Messages",
      "Documents",
      "Website listings",
      "Settings",
    ]);
    await expect(page.getByRole("link", { name: "Landlord Gopher" })).toBeVisible();
    await shot(page, testInfo, "Admin dashboard");
  });

  test("a worker gets My jobs + Messages only (no empty admin shell)", async ({ page }, testInfo) => {
    await signIn(page, "worker");
    expect(await navLinks(page)).toEqual(["My jobs", "Messages"]);
    await expect(page.getByRole("link", { name: "Landlord Gopher" })).toHaveAttribute(
      "href",
      "/maintenance",
    );
    await expect(page.getByRole("heading", { name: "My jobs" })).toBeVisible();
    const links = await navLinks(page);
    expect(links).not.toContain("Users");
    expect(links).not.toContain("Dashboard");
    expect(links).not.toContain("Rent");
    expect(links).not.toContain("Properties");
    await page.goto("/users");
    await expect(page, "admin routes bounce a worker back to assigned jobs").toHaveURL(/\/maintenance$/);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/maintenance$/);
    await page.goto("/calendar");
    await expect(page).toHaveURL(/\/calendar$/);
    await shot(page, testInfo, "Worker jobs + messages shell");
  });

  test("a tenant gets Home · Requests · Messages · Documents", async ({ page }, testInfo) => {
    await signIn(page, "tenant");
    expect(await navLinks(page)).toEqual(["Home", "Requests", "Messages", "Documents"]);
    await expect(page.getByRole("link", { name: "Landlord Gopher" })).toHaveAttribute("href", "/home");
    await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();
    await page.goto("/properties");
    await expect(page, "staff pages bounce a tenant back to home").toHaveURL(/\/home$/);
    await page.goto("/users");
    await expect(page).toHaveURL(/\/home$/);
    await shot(page, testInfo, "Tenant portal");
  });

  test("a landlord gets Home · Properties · Maintenance · Messages · Documents", async ({ page }, testInfo) => {
    await signIn(page, "landlord");
    expect(await navLinks(page)).toEqual([
      "Home",
      "Properties",
      "Maintenance",
      "Messages",
      "Documents",
    ]);
    await expect(page.getByRole("link", { name: "Landlord Gopher" })).toHaveAttribute("href", "/home");
    await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();
    await expect(page.getByText("Read-only")).toHaveCount(0);
    // Their own property is listed under "Your properties"; the other landlord's is nowhere on the page.
    const theirProperties = page.getByRole("region", { name: "Your properties" });
    await expect(theirProperties.getByRole("heading", { name: "Maple Court", exact: true })).toBeVisible();
    await expect(theirProperties.getByRole("listitem")).toHaveCount(1);
    await expect(page.getByText("Birch House"), "another landlord's property").toHaveCount(0);
    await expect(page.getByRole("button", { name: "New property" })).toHaveCount(0);
    await page.goto("/documents");
    await expect(landlordDocumentsHeading(page)).toBeVisible();
    await expect(page.getByRole("button", { name: "Upload" })).toHaveCount(0);
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
    await page.getByLabel("Password", { exact: true }).fill("definitely-wrong");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByText("Invalid login credentials")).toBeVisible();
    await expect(nav(page)).toHaveCount(0);
    await shot(page, testInfo, "Wrong password");
  });

  test("a signed-in user stays signed in after a refresh, and can sign out", async ({ page }) => {
    await signIn(page, "admin");
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: GREETING })).toBeVisible();
    await page.getByRole("button", { name: /Account menu/i }).first().click();
    await expect(page.getByText("admin@test.local")).toBeVisible();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
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
    await page.getByRole("button", { name: "New here? Create an account" }).click();
    await page.getByLabel("Full name").fill("Nina Newcomer");
    await page.getByLabel("Email").fill("nina@signup.test");
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Create account", exact: true }).click();
    await expect(page.getByText("Check your email to verify your account")).toBeVisible();
    await shot(page, testInfo, "Sign-up confirmation message");

    const mail = (await outbox()).find((m) => m.to === "nina@signup.test" && m.type === "signup");
    expect(mail, "a verification email was sent").toBeTruthy();
    await page.goto(mail!.link);
    await expect(
      page.getByRole("heading", { name: "Thanks — we’re reviewing your account" }),
    ).toBeVisible();
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
    await page.getByLabel("Confirm password").fill("BrandNew456!");
    await page.getByRole("button", { name: "Update password" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();

    await signOut(page);
    await signIn(page, { email: "worker2@test.local", password: "BrandNew456!" });
  });
});

test.describe("[R2] Account approval — screens", () => {
  test.beforeAll(async () => {
    await resetWorld();
  });

  test("a pending user sees a review notice instead of the portal", async ({ page }, testInfo) => {
    await page.goto("/");
    await page.getByLabel("Email").fill("pending@test.local");
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Thanks — we’re reviewing your account" }),
    ).toBeVisible();
    await expect(nav(page)).toHaveCount(0);
    await shot(page, testInfo, "Pending user is blocked");
  });

  test("an admin approves a pending account on the Users page, and that user gets in", async ({ page, browser }, testInfo) => {
    // The pending user is already signed in and waiting in another browser.
    const waiting = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
    const theirPage = await waiting.newPage();
    await theirPage.goto("/");
    await theirPage.getByLabel("Email").fill("pending@test.local");
    await theirPage.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await theirPage.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      theirPage.getByRole("heading", { name: "Thanks — we’re reviewing your account" }),
    ).toBeVisible();

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
    await expect(theirPage.getByRole("navigation", { name: "Primary" })).toBeVisible();
    await expect(theirPage.getByRole("button", { name: /Account menu/i })).toBeVisible();
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
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Your access is paused" })).toBeVisible();
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
    await expect(page.getByRole("heading", { name: "Cedar Row" })).toBeVisible();
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

  test("a landlord sees landlord/tenant-shared docs and cannot upload", async ({ page }, testInfo) => {
    await sql(
      `insert into public."PropertyDocuments" (property_id, title, file_name, storage_path, visibility)
       values
         ($1, 'Landlord lease copy', 'lease.pdf', $2, 'landlord'),
         ($1, 'Staff only binder', 'binder.pdf', $3, 'staff')`,
      [world.property.id, `${world.property.id}/lease.pdf`, `${world.property.id}/binder.pdf`],
    );
    await signIn(page, "landlord");
    await page.goto("/documents");
    await expect(landlordDocumentsHeading(page)).toBeVisible();
    await expect(landlordDocument(page, "Landlord lease copy")).toBeVisible();
    await expect(landlordDocument(page, "House rules")).toBeVisible();
    await expect(page.getByText("Staff only binder")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Upload" })).toHaveCount(0);
    // The landlord's property page keeps documents on their own tab.
    await page.goto(`/properties/${world.property.id}`);
    await page.getByRole("tab", { name: "Documents" }).click();
    await expect(page.getByRole("heading", { name: `Documents · ${world.property.name}` })).toBeVisible();
    await expect(page.getByText("Staff only binder")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Upload" })).toHaveCount(0);
    await shot(page, testInfo, "Landlord Documents page");
  });
});
