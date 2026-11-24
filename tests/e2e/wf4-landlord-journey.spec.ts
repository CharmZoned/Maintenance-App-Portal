/**
 * WF4 — Landlord journey, in a real browser.
 *
 *   Landlord sees their units  →  opens a unit and sees its requests  →  files
 *   a common-area request with photos  →  the admin sees it in the queue  →
 *   the landlord messages the office about it  →  the admin replies from
 *   Messages → Landlords  →  the landlord sees the reply and the unread clears.
 *
 * Every step signs in through the login form as that person and uses the same
 * screens they would. Steps run in order on one database, so a failure stops
 * the rest. The data-layer version is tests/workflows/wf4-landlord-journey.test.ts.
 */
import type { Page } from "@playwright/test";
import { choose, expect, PNG, resetWorld, shot, signIn, sql, test, type World } from "./support";

const UNIT_REQUEST = "Kitchen faucet dripping";
const TITLE = "Hallway light out by the front door";
const DETAILS = "The ceiling light in the front hallway has stopped working.";
const QUESTION = "I filed a request for the hallway light. Can Sam fit it into his next visit?";
const REPLY = "Yes, Sam will be there Thursday morning.";

let world: World;

/** A chat bubble's text. The thread list's preview line repeats it with a "You:" / name prefix. */
const bubble = (page: Page, text: string) => page.getByText(text, { exact: true }).filter({ visible: true }).first();

test.describe.configure({ mode: "serial" });

test.describe("[WF4] Landlord journey", () => {
  test.beforeAll(async () => {
    world = await resetWorld();
    // Something already open on Unit 1A, reported by its tenant.
    await sql(
      `insert into public."MaintenanceRequests"
         (unit_id, property_id, submitted_by_tenant_id, title, description, category, permission_to_enter)
       values ($1, $2, $3, $4, 'Drips about once a second.', 'Plumbing', true)`,
      [world.units.a.id, world.property.id, world.tenants.tenant.id, UNIT_REQUEST],
    );
  });

  test("Landlord · sees their units", async ({ page }, testInfo) => {
    await signIn(page, "landlord");
    await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Properties" }).click();
    // One property: Properties goes straight to it.
    await expect(page).toHaveURL(new RegExp(`/properties/${world.property.id}$`));
    await expect(page.getByRole("heading", { name: "Maple Court" }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /Unit 1A/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Unit 2B/ })).toBeVisible();
    await shot(page, testInfo, "Landlord's property with its units");
  });

  test("Landlord · opens a unit and sees its requests", async ({ page }, testInfo) => {
    await signIn(page, "landlord");
    await page.goto(`/properties/${world.property.id}`);
    await page.getByRole("link", { name: /Unit 1A/ }).click();
    await expect(page).toHaveURL(new RegExp(`/properties/${world.property.id}/units/${world.units.a.id}$`));
    await expect(page.getByText(UNIT_REQUEST).first()).toBeVisible();
    await expect(page.getByText("New", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /New request/ }).first()).toBeVisible();
    await shot(page, testInfo, "Unit 1A with its open request");
  });

  test("Landlord · files a request with photos", async ({ page }, testInfo) => {
    await signIn(page, "landlord");
    await page.goto("/maintenance");
    await page.getByRole("button", { name: "New request" }).first().click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Report an issue" })).toBeVisible();
    await expect(dialog.locator("#landlord-request-property")).toContainText("Maple Court");
    await expect(dialog.locator("#landlord-request-unit")).toBeEnabled();
    await choose(page, dialog.locator("#landlord-request-unit"), "Common area");
    await dialog.getByLabel("What’s the problem?").fill(TITLE);
    await choose(page, dialog.locator("#landlord-request-category"), "Electrical");
    await dialog.getByLabel("Details").fill(DETAILS);
    await dialog
      .locator('input[type="file"][multiple]')
      .first()
      .setInputFiles([
        { ...PNG, name: "hallway-1.png" },
        { ...PNG, name: "hallway-2.png" },
      ]);
    await expect(dialog.getByText("2 of 5")).toBeVisible();
    await shot(page, testInfo, "Landlord fills in a common-area request");

    await dialog.getByRole("button", { name: "Submit request" }).click();
    await expect(dialog.getByText("Request submitted")).toBeVisible();
    await dialog.getByRole("button", { name: "Done" }).click();

    await expect(page.getByText(TITLE).first()).toBeVisible();
    const [row] = await sql<{ unit_id: number | null; submitted_by_landlord_id: number | null; photos: number }>(
      `select r.unit_id, r.submitted_by_landlord_id,
              (select count(*)::int from public."MaintenanceRequestPhotos" p where p.maintenance_request_id = r.id) as photos
         from public."MaintenanceRequests" r where r.title = $1`,
      [TITLE],
    );
    expect(row).toEqual({ unit_id: null, submitted_by_landlord_id: world.landlord.id, photos: 2 });
    await shot(page, testInfo, "The request in the landlord's list");
  });

  test("Admin · sees it in the queue", async ({ page }, testInfo) => {
    await signIn(page, "admin");
    await page.goto("/maintenance");
    // New requests land in "Needs action": the tenant's one and the landlord's.
    await expect(page.getByText("Needs action (2)", { exact: true })).toBeVisible();
    const row = page.getByRole("button", { name: new RegExp(TITLE) }).or(page.getByRole("link", { name: new RegExp(TITLE) }));
    await expect(row.first()).toBeVisible();
    await expect(row.first()).toContainText("Maple Court");
    await expect(row.first()).toContainText("New");
    await shot(page, testInfo, "Admin's maintenance queue with the landlord's request");
  });

  test("Landlord · messages the office about it", async ({ page }, testInfo) => {
    await signIn(page, "landlord");
    await page.getByRole("button", { name: "Message Landlord Gopher" }).first().click();
    await expect(page).toHaveURL(/\/messages\?thread=office$/);

    await choose(page, page.getByRole("combobox", { name: "About a request (optional)" }), new RegExp(TITLE));
    await page.getByRole("textbox", { name: "Write a message…" }).fill(QUESTION);
    await page.getByRole("button", { name: "Send", exact: true }).click();

    await expect(bubble(page, QUESTION)).toBeVisible();
    await expect(page.getByText(/Regarding #MR-\d+/)).toBeVisible();
    await shot(page, testInfo, "Landlord's message with the request chip");
  });

  test("Admin · replies from Messages → Landlords", async ({ page }, testInfo) => {
    await signIn(page, "admin");
    await page.goto("/messages");
    await page.getByRole("button", { name: /^Landlords/ }).click();
    const row = page.getByRole("button", { name: /^Lena Owner, unread\./ });
    await expect(row).toBeVisible();
    await shot(page, testInfo, "Messages → Landlords shows the thread unread");

    await row.click();
    await expect(bubble(page, QUESTION)).toBeVisible();
    await expect(page.getByText(/Regarding #MR-\d+/)).toBeVisible();
    await page.getByRole("textbox", { name: "Write a reply…" }).fill(REPLY);
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(bubble(page, REPLY)).toBeVisible();
    await expect(page.getByRole("button", { name: /^Lena Owner\./ })).toBeVisible();
    await shot(page, testInfo, "Admin's reply in the landlord thread");

    // People → Landlords: the portfolio row and its Message button open the same thread.
    await page.goto("/people?tab=landlords");
    await expect(page.getByText("Maple Court").first()).toBeVisible();
    await page.getByRole("button", { name: "Message Owner Holdings LLC" }).click();
    await expect(page).toHaveURL(new RegExp(`/messages\\?thread=office(:|%3A)${world.users.landlord.id}$`));
    await expect(bubble(page, REPLY)).toBeVisible();
    await shot(page, testInfo, "People → Landlords opens the same thread");
  });

  test("Landlord · sees the reply and the unread clears", async ({ page }, testInfo) => {
    await signIn(page, "landlord");
    await expect(page.getByText("1 new message from Landlord Gopher")).toBeVisible();
    await expect(page.getByText(REPLY, { exact: true }).first()).toBeVisible();
    await shot(page, testInfo, "Home shows the office's reply, unread");

    await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Messages" }).click();
    const office = page.getByRole("button", { name: /^Landlord Gopher office, unread\./ });
    await expect(office).toBeVisible();
    await office.click();
    await expect(bubble(page, REPLY)).toBeVisible();
    await expect(page.getByRole("button", { name: /^Landlord Gopher office\./ })).toBeVisible();
    await shot(page, testInfo, "The reply is read");

    await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Home" }).click();
    await expect(page.getByText("Nothing needs your input right now.")).toBeVisible();
  });
});
