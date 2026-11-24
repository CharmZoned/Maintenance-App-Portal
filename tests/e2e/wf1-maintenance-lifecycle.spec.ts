/**
 * WF1 — Maintenance request lifecycle, in a real browser.
 *
 *   Tenant submits a request  →  Admin assigns it to a worker  →  Worker starts
 *   and completes it on the request page  →  Tenant follows it on the same page.
 *
 * Every role works on the ONE request page (/maintenance/:id), reached in one
 * click from its list. Every step signs in through the login form as that
 * person. Steps run in order and share one database, so a failure stops the
 * rest (later steps would be meaningless).
 */
import { type Page } from "@playwright/test";
import { choose, expect, PNG, resetWorld, shot, signIn, test, tomorrow } from "./support";

const TITLE = "Bathroom sink is leaking";
const DESCRIPTION = "Water pools under the sink every time the tap runs.";
const WORKER_UPDATE = "Found a cracked trap — back tomorrow with the part.";
const TENANT_REPLY = "Thanks — I'll keep the bathroom clear.";
const RESOLUTION = "Replaced the cracked trap and re-sealed the drain.";
const STATUS_WORDS_NEVER_SHOWN = /Open → |Scheduled → |In Progress → |Offered to workers|Assigned \(staff\)|Urgent/;

test.describe.configure({ mode: "serial" });

/** The visible list row (desktop grid or phone row) for a request title. */
function requestRow(page: Page, title: string) {
  return page.getByRole("link", { name: new RegExp(title) }).filter({ visible: true }).first();
}

/** One click from the role's list lands on the request page. */
async function openFromList(page: Page, title: string) {
  await requestRow(page, title).click();
  await expect(page).toHaveURL(/\/maintenance\/\d+$/);
  await expect(page.getByRole("heading", { name: "Details" })).toBeVisible();
}

test.describe("[WF1] Maintenance request lifecycle", () => {
  test.beforeAll(async () => {
    await resetWorld();
  });

  test("Tenant · reports a problem with a photo", async ({ page }, testInfo) => {
    await signIn(page, "tenant");
    await page.goto("/maintenance");
    await expect(page.getByRole("heading", { name: "Requests" })).toBeVisible();

    await page.getByRole("button", { name: "Report a problem" }).filter({ visible: true }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Unit 1A · Maple Court")).toBeVisible();
    await dialog.locator("#tenant-title").fill(TITLE);
    await choose(page, dialog.locator("#tenant-category"), "Plumbing");
    await dialog.locator("#tenant-desc").fill(DESCRIPTION);
    await choose(page, dialog.locator("#tenant-permission"), "Yes, if no one home");
    await dialog.locator("#tenant-photos").setInputFiles(PNG);
    await shot(page, testInfo, "Tenant fills in the request");
    await dialog.getByRole("button", { name: "Submit", exact: true }).click();

    await expect(page.getByText(/Request submitted with photos/)).toBeVisible();
    await expect(requestRow(page, TITLE)).toBeVisible();
    await shot(page, testInfo, "Request appears in Requests");
  });

  test("Worker · does not see the request before it is assigned", async ({ page }, testInfo) => {
    await signIn(page, "worker");
    await page.goto("/maintenance");
    await expect(page.getByRole("heading", { name: "My jobs" })).toBeVisible();
    await expect(page.getByText(TITLE)).toHaveCount(0);
    await shot(page, testInfo, "Worker's jobs do not include it");
  });

  test("Admin · opens the new request in one click and assigns it with a date", async ({ page }, testInfo) => {
    await signIn(page, "admin");
    await page.goto("/maintenance");
    await expect(requestRow(page, TITLE)).toBeVisible();
    await shot(page, testInfo, "Admin's Needs action list");

    await openFromList(page, TITLE);
    await expect(page.getByRole("heading", { name: TITLE })).toBeVisible();
    await expect(page.getByText(DESCRIPTION)).toBeVisible();
    await expect(page.getByRole("button", { name: "Open photo 1 of 1" })).toBeVisible();
    await expect(page.getByText("Not assigned yet").first()).toBeVisible();
    await expect(page.getByText("Request #")).toHaveCount(0);

    await page.getByRole("button", { name: "Assign and schedule" }).filter({ visible: true }).first().click();
    const dialog = page.getByRole("dialog", { name: "Assign and schedule" });
    await expect
      .poll(
        async () => {
          await dialog.locator("#assign-staff").click();
          const n = await page.getByRole("option", { name: /Sam Fixit/ }).count();
          await page.keyboard.press("Escape");
          return n;
        },
        { timeout: 15_000 },
      )
      .toBeGreaterThan(0);
    await choose(page, dialog.locator("#assign-staff"), /Sam Fixit/);
    await dialog.locator("#assign-date").fill(tomorrow());
    await shot(page, testInfo, "Admin assigns Sam and picks a date");
    await dialog.getByRole("button", { name: "Assign", exact: true }).click();

    await expect(page.getByText(/Sam Fixit assigned for/)).toBeVisible();
    await expect(page.getByText("Assigned", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(STATUS_WORDS_NEVER_SHOWN)).toHaveCount(0);
    await shot(page, testInfo, "Request is now Assigned");
  });

  test("Worker · opens the job from My jobs and starts work", async ({ page }, testInfo) => {
    await signIn(page, "worker");
    await page.goto("/maintenance");
    await page.getByRole("button", { name: new RegExp(TITLE) }).filter({ visible: true }).first().click();
    await expect(page).toHaveURL(/\/maintenance\/\d+$/);

    await expect(page.getByRole("heading", { name: TITLE })).toBeVisible();
    await expect(page.getByText(DESCRIPTION)).toBeVisible();
    await expect(page.getByText("OK to enter if absent")).toBeVisible();
    await expect(page.getByRole("button", { name: "Open photo 1 of 1" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Edit work order" }), "the old form is retired").toHaveCount(0);
    await expect(page.getByRole("button", { name: "Edit details" }), "editing is admin-only").toHaveCount(0);
    await expect(page.getByRole("button", { name: "Put on hold" }).filter({ visible: true })).toHaveCount(1);
    await shot(page, testInfo, "Worker views the request page");

    await page.getByRole("button", { name: "Start work" }).filter({ visible: true }).first().click();
    await expect(page.getByText("Work started.")).toBeVisible();
    await expect(page.getByText("You started work")).toBeVisible();

    // Internal only is off by default: the tenant sees this update.
    await expect(page.getByRole("switch", { name: "Internal only" })).toHaveAttribute("aria-checked", "false");
    await page.getByRole("textbox", { name: "Message" }).fill(WORKER_UPDATE);
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByText("Message sent.")).toBeVisible();
    await expect(page.getByText(WORKER_UPDATE)).toBeVisible();
    await shot(page, testInfo, "Job in progress with a tenant-visible update");
  });

  test("Tenant · follows the request on the page and replies there", async ({ page }, testInfo) => {
    await signIn(page, "tenant");
    await page.goto("/maintenance");
    await openFromList(page, TITLE);

    await expect(page.getByText("In progress", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Sam Fixit", { exact: false }).first()).toBeVisible();
    await expect(page.getByText(WORKER_UPDATE)).toBeVisible();
    await expect(page.getByRole("switch", { name: "Internal only" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open request conversation" })).toHaveCount(0);

    await page.getByRole("textbox", { name: "Message" }).fill(TENANT_REPLY);
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByText(TENANT_REPLY)).toBeVisible();
    await expect(page).toHaveURL(/\/maintenance\/\d+$/);
    await shot(page, testInfo, "Tenant reads the update and replies on the page");
  });

  test("Worker · adds a photo of the finished work and marks the job completed", async ({ page }, testInfo) => {
    await signIn(page, "worker");
    await page.goto("/maintenance");
    await page.getByRole("button", { name: new RegExp(TITLE) }).filter({ visible: true }).first().click();
    await expect(page.getByText(TENANT_REPLY)).toBeVisible();

    await page.getByRole("button", { name: "Mark completed" }).filter({ visible: true }).first().click();
    const dialog = page.getByRole("dialog", { name: "Mark completed" });
    await expect(dialog.getByText("Add a photo of the finished work first.")).toBeVisible();
    await dialog.locator('input[type="file"]').setInputFiles({ ...PNG, name: "fixed.png" });
    await expect(page.getByText("Photo added.")).toBeVisible();
    await dialog.locator("#resolution-notes").fill(RESOLUTION);
    await shot(page, testInfo, "Worker records what fixed it");
    await dialog.getByRole("button", { name: "Mark completed" }).click();

    await expect(page.getByText("Marked completed.")).toBeVisible();
    await expect(page.getByText("This request is completed. Messages are closed.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Open photo 2 of 2" })).toBeVisible();
  });

  test("Tenant · sees it completed with a plain-language timeline", async ({ page }, testInfo) => {
    await signIn(page, "tenant");
    await page.goto("/maintenance");
    await page.getByRole("button", { name: /^Completed/ }).first().click();
    await openFromList(page, TITLE);

    await expect(page.getByText("Completed", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("You reported this")).toBeVisible();
    await expect(page.getByText("Sam Fixit started work")).toBeVisible();
    await expect(page.getByText(new RegExp(`Sam Fixit completed this: .${RESOLUTION.replace(/\./g, "\\.")}`))).toBeVisible();
    await expect(page.getByText(STATUS_WORDS_NEVER_SHOWN)).toHaveCount(0);
    await shot(page, testInfo, "Tenant sees the completed request and its timeline");
  });

  test("Admin · reviews the completed job and can reopen it", async ({ page }, testInfo) => {
    await signIn(page, "admin");
    await page.goto("/maintenance");
    await page.getByRole("button", { name: "Completed", exact: true }).click();
    await openFromList(page, TITLE);
    await expect(page.getByText("What fixed it")).toBeVisible();
    await expect(page.getByText(RESOLUTION).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Reopen" })).toBeVisible();
    await shot(page, testInfo, "Admin reviews the completed job");
  });

  test("Admin · New request picks the unit first, which fills in the tenant", async ({ page }, testInfo) => {
    await signIn(page, "admin");
    await page.goto("/maintenance");
    await page.getByRole("button", { name: "New request" }).filter({ visible: true }).first().click();
    const dialog = page.getByRole("dialog", { name: "New request" });
    for (const gone of ["Worker price", "Landlord price", "Vendor", "Internal notes"]) {
      await expect(dialog.getByText(gone, { exact: true }), `${gone} is not on the new form`).toHaveCount(0);
    }
    await dialog.locator("#anr-title").fill("Hallway light is out");
    await choose(page, dialog.locator("#anr-property"), "Maple Court");
    await choose(page, dialog.locator("#anr-unit"), /1A/);
    await expect(dialog.locator("#anr-tenant")).toContainText("Tina");
    await expect(dialog.getByText("Filled in from the unit.", { exact: false })).toBeVisible();
    await choose(page, dialog.locator("#anr-category"), "Electrical");
    await choose(page, dialog.locator("#anr-priority"), "Emergency");
    await shot(page, testInfo, "Admin fills in the new request");
    await dialog.getByRole("button", { name: "Create request" }).click();

    await expect(page.getByText("Request created.", { exact: false })).toBeVisible();
    await expect(requestRow(page, "Hallway light is out")).toBeVisible();
    await expect(page.getByText("Urgent")).toHaveCount(0);
  });
});
