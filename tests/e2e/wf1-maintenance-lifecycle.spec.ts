/**
 * WF1 — Maintenance request lifecycle, in a real browser.
 *
 *   Tenant submits a request  →  Admin assigns it to a worker  →  Worker views
 *   and works the request  →  Tenant sees the outcome.
 *
 * Every step signs in through the login form as that person and uses the same
 * screens they would. Steps run in order and share one database, so a failure
 * stops the rest (later steps would be meaningless).
 *
 * Which screen each person uses:
 *   Tenant  Home → Requests (list + detail panel) → the full request page
 *   Admin   Maintenance queue → the request page → the work order dialog
 *   Worker  My jobs → the work order dialog
 */
import type { Locator, Page } from "@playwright/test";
import { choose, expect, PNG, resetWorld, selectUnder, shot, signIn, test, tomorrow } from "./support";

const TITLE = "Bathroom sink is leaking";
const DESCRIPTION = "Water pools under the sink every time the tap runs.";
const WORKER_UPDATE = "Found a cracked trap — back tomorrow with the part.";
const RESOLUTION = "Replaced the cracked trap and re-sealed the drain.";

/** The request's row in whichever list is on screen: every queue renders it as one button led by the title. */
const requestRow = (page: Page): Locator => page.getByRole("button", { name: new RegExp(`^${TITLE}`) });

/** A page section (card) found by its own heading. */
const sectionTitled = (page: Page, heading: string): Locator =>
  page.locator("section", { has: page.getByRole("heading", { name: heading, exact: true }) });

/** The tenant signs in to Home; Requests is one click away in the nav. */
async function openTenantRequests(page: Page): Promise<void> {
  await signIn(page, "tenant");
  await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Requests" }).click();
  await expect(page).toHaveURL(/\/maintenance$/);
  await expect(page.getByRole("heading", { level: 1, name: "Requests", exact: true })).toBeVisible();
}

/** From the tenant's list, open the selected request on its own page (it lists every update, not the latest three). */
async function openTenantFullRequest(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Open full request" }).click();
  await expect(page).toHaveURL(/\/maintenance\/\d+$/);
  await expect(page.getByRole("heading", { level: 2, name: TITLE })).toBeVisible();
}

test.describe.configure({ mode: "serial" });

test.describe("[WF1] Maintenance request lifecycle", () => {
  test.beforeAll(async () => {
    await resetWorld();
  });

  test("Tenant · submits a maintenance request with a photo", async ({ page }, testInfo) => {
    await signIn(page, "tenant");
    await expect(page.getByRole("heading", { level: 1, name: "Home", exact: true })).toBeVisible();
    await expect(page.getByText("Unit 1A · Maple Court")).toBeVisible();
    await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Requests" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Requests", exact: true })).toBeVisible();
    await expect(page.getByText("Submit a request when something needs fixing in your unit.")).toBeVisible();

    await page.getByRole("button", { name: "New maintenance request" }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Request maintenance" })).toBeVisible();
    await expect(dialog.getByText("Unit 1A · Maple Court"), "the form says which home it reports for").toBeVisible();
    await dialog.getByLabel("Issue title").fill(TITLE);
    await choose(page, dialog.getByRole("combobox", { name: "Category" }), "Plumbing");
    await dialog.getByLabel("Description").fill(DESCRIPTION);
    await choose(page, dialog.getByRole("combobox", { name: "Permission to enter" }), "Yes, if no one home");
    await dialog.locator("#tenant-photos").setInputFiles(PNG);
    await expect(dialog.getByRole("img", { name: PNG.name })).toBeVisible();
    await shot(page, testInfo, "Tenant fills in the request");
    await dialog.getByRole("button", { name: "Submit", exact: true }).click();

    await expect(page.getByText("Request submitted with photos")).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(requestRow(page)).toBeVisible();
    await expect(requestRow(page).getByText("New", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open · 1", exact: true })).toHaveAttribute("aria-pressed", "true");
    // The new request is selected, so its detail panel is open beside the list — with the photo.
    const details = page.locator("section", { has: page.getByRole("heading", { level: 2, name: TITLE }) });
    await expect(details.getByText(DESCRIPTION)).toBeVisible();
    await expect(details.getByText("Plumbing", { exact: true })).toBeVisible();
    await expect(details.getByText("Not yet assigned")).toBeVisible();
    await expect(details.getByRole("img", { name: "Photo", exact: true })).toBeVisible();
    await shot(page, testInfo, "Request appears under Requests");
  });

  test("Worker · does not see the request before it is assigned", async ({ page }, testInfo) => {
    await signIn(page, "worker");
    await page.goto("/maintenance");
    await expect(page.getByRole("heading", { level: 1, name: "My jobs" })).toBeVisible();
    await expect(page.getByText("No jobs assigned yet. New work will show up here.")).toBeVisible();
    await expect(page.getByText(TITLE)).toHaveCount(0);
    await shot(page, testInfo, "Worker's queue is empty");
  });

  test("Admin · sees the new request and assigns it to a worker with a date", async ({ page }, testInfo) => {
    await signIn(page, "admin");
    await page.goto("/maintenance");
    await expect(page.getByRole("button", { name: "Needs action (1)", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(requestRow(page)).toBeVisible();
    await expect(requestRow(page)).toContainText("Maple Court · Unit 1A · Tina Renter");
    await expect(requestRow(page).getByText("New", { exact: true })).toBeVisible();
    await shot(page, testInfo, "Admin's maintenance queue");

    // A row opens the request on its own page.
    await requestRow(page).click();
    await expect(page).toHaveURL(/\/maintenance\/\d+$/);
    await expect(page.getByRole("heading", { level: 1, name: /^Request #/ })).toBeVisible();
    const details = sectionTitled(page, "Details");
    await expect(details).toContainText("Unit 1A · Maple Court");
    await expect(details).toContainText("Tina Renter");
    await expect(details).toContainText("Plumbing");
    await expect(details).toContainText(DESCRIPTION);
    await expect(page.getByRole("img", { name: "Photo", exact: true })).toBeVisible();
    await shot(page, testInfo, "Admin opens the request");

    const actions = page.getByRole("complementary").filter({ has: page.getByRole("heading", { name: "Actions", exact: true }) });
    await actions.getByRole("button", { name: "Assign and schedule" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Edit work order" })).toBeVisible();
    await expect(dialog.getByLabel("Description")).toHaveValue(DESCRIPTION);
    await expect(dialog.getByRole("img", { name: "Maintenance photo" })).toBeVisible();

    // Accept & schedule is expanded by default for Open requests (WS-K).
    await expect(dialog.getByRole("button", { name: "Hide", exact: true })).toBeVisible();
    // Wait until staff options have loaded (listStaff is async on dialog open).
    await expect
      .poll(async () => {
        await selectUnder(dialog, "Staff").click();
        const n = await page.getByRole("option", { name: /Fixit, Sam/ }).count();
        await page.keyboard.press("Escape");
        return n;
      }, { timeout: 15_000 })
      .toBeGreaterThan(0);
    await choose(page, selectUnder(dialog, "Staff"), "Fixit, Sam");
    await dialog.locator('label:text-is("Date") ~ input[type="date"]').fill(tomorrow());
    await shot(page, testInfo, "Admin assigns Sam and picks a date");
    await dialog.getByRole("button", { name: "Confirm Accept & schedule" }).click();

    await expect(page.getByText("Request accepted and scheduled.")).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(details).toContainText("Assigned (staff)");

    // Back in the queue it has left "Needs action" and sits under Active, with its assignee.
    await page.getByRole("button", { name: "← Maintenance" }).click();
    await expect(page.getByRole("button", { name: "Needs action (0)", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Active (1)", exact: true }).click();
    await expect(requestRow(page)).toContainText("Assigned Fixit, Sam");
    await expect(requestRow(page).getByText("Assigned", { exact: true })).toBeVisible();
    await shot(page, testInfo, "Request is now assigned");
  });

  test("Worker · opens the assigned request and sees the tenant's report and photo", async ({ page }, testInfo) => {
    await signIn(page, "worker");
    await page.goto("/maintenance");
    await expect(page.getByRole("heading", { level: 2, name: "Upcoming" })).toBeVisible();
    await expect(requestRow(page)).toContainText("Maple Court · Unit 1A");
    await expect(requestRow(page).getByText("Assigned", { exact: true })).toBeVisible();
    await shot(page, testInfo, "Worker's queue shows the job");

    await requestRow(page).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Title")).toHaveValue(TITLE);
    await expect(dialog.getByLabel("Title"), "worker cannot edit what the tenant reported").toBeDisabled();
    await expect(dialog.getByLabel("Description")).toHaveValue(DESCRIPTION);
    await expect(dialog.getByLabel("Permission to enter")).toBeChecked();
    await expect(dialog.getByRole("img", { name: "Maintenance photo" })).toBeVisible();
    await expect(dialog.getByText("Open → Scheduled")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Accept & schedule", exact: true }), "scheduling is admin-only").toHaveCount(0);
    await shot(page, testInfo, "Worker views the request details");
  });

  test("Worker · starts the job and posts an update for the tenant", async ({ page }, testInfo) => {
    await signIn(page, "worker");
    await page.goto("/maintenance");
    await requestRow(page).click();
    const dialog = page.getByRole("dialog");

    await choose(page, selectUnder(dialog, "Status"), "In progress");
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Work order saved.")).toBeVisible();
    await expect(dialog).toBeHidden();

    // A job in progress moves up to Today.
    await expect(page.getByRole("heading", { level: 2, name: "Today" })).toBeVisible();
    await expect(requestRow(page).getByText("In progress", { exact: true })).toBeVisible();
    await requestRow(page).click();
    await dialog.getByPlaceholder("Add a comment…").fill(WORKER_UPDATE);
    await choose(page, dialog.locator('button[role="combobox"]', { hasText: "Internal" }), "Tenant visible");
    await dialog.getByRole("button", { name: "Post comment" }).click();
    await expect(dialog.getByText(WORKER_UPDATE)).toBeVisible();
    await expect(dialog.getByText("Scheduled → In Progress")).toBeVisible();
    await shot(page, testInfo, "Job in progress with a tenant-visible update");
  });

  test("Tenant · sees the request in progress and reads the worker's update", async ({ page }, testInfo) => {
    await openTenantRequests(page);
    await expect(requestRow(page).getByText("In progress", { exact: true })).toBeVisible();
    await openTenantFullRequest(page);
    const main = page.getByRole("main");
    await expect(main.getByText("In progress", { exact: true })).toBeVisible();
    await expect(main.getByText("Assigned (staff)")).toBeVisible();
    await expect(main.getByText(WORKER_UPDATE)).toBeVisible();
    // Replies to staff go through the request's conversation in Messages, not this page.
    await expect(main.getByRole("button", { name: "Open request conversation" })).toBeVisible();
    await shot(page, testInfo, "Tenant reads the worker's update");
  });

  test("Worker · closes the job with resolution notes", async ({ page }, testInfo) => {
    await signIn(page, "worker");
    await page.goto("/maintenance");
    await requestRow(page).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(WORKER_UPDATE)).toBeVisible();

    // A worker has to add their own photo of the finished work before a job can be closed.
    await dialog.locator('input[type="file"]').setInputFiles({ ...PNG, name: "fixed.png" });
    await dialog.getByRole("button", { name: "Upload 1 photo" }).click();
    await expect(page.getByText("Photos uploaded.")).toBeVisible();
    await expect(dialog.getByRole("img", { name: "Maintenance photo" })).toHaveCount(2);

    await choose(page, selectUnder(dialog, "Status"), "Closed");
    await dialog.getByPlaceholder("What fixed it?").fill(RESOLUTION);
    await shot(page, testInfo, "Worker records what fixed it");
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Work order saved.")).toBeVisible();
    await expect(dialog).toBeHidden();

    await expect(page.getByText("No open jobs"), "closed jobs leave the open queue").toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Recently completed" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Today" })).toHaveCount(0);
    await expect(requestRow(page).getByText("Completed", { exact: true })).toBeVisible();
  });

  test("Tenant · sees the request closed with its full status history", async ({ page }, testInfo) => {
    await openTenantRequests(page);
    await expect(page.getByRole("button", { name: "Open · 0", exact: true })).toBeVisible();
    await expect(page.getByText("No open requests right now.")).toBeVisible();
    await page.getByRole("button", { name: "Completed · 1", exact: true }).click();
    await expect(requestRow(page).getByText("Completed", { exact: true })).toBeVisible();
    await openTenantFullRequest(page);
    const main = page.getByRole("main");
    for (const line of ["Created", "Status → Scheduled", "Status → In Progress", "Status → Closed"]) {
      await expect(main.getByText(line, { exact: true })).toBeVisible();
    }
    await expect(main.getByText(WORKER_UPDATE)).toBeVisible();
    await shot(page, testInfo, "Tenant sees the closed request and its trail");
  });

  test("Admin · sees the closed job on the dashboard as no longer open", async ({ page }, testInfo) => {
    await signIn(page, "admin");
    await page.goto("/maintenance");
    await expect(page.getByRole("button", { name: "Needs action (0)", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "Active (0)", exact: true })).toBeVisible();
    await expect(requestRow(page)).toHaveCount(0);
    await page.getByRole("button", { name: "Completed (1)", exact: true }).click();
    await expect(requestRow(page).getByText("Completed", { exact: true })).toBeVisible();

    await requestRow(page).click();
    await expect(page).toHaveURL(/\/maintenance\/\d+$/);
    await expect(page.getByText(RESOLUTION), "the request page shows what fixed it").toBeVisible();
    const actions = page.getByRole("complementary").filter({ has: page.getByRole("heading", { name: "Actions", exact: true }) });
    await actions.getByRole("button", { name: "Edit details" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByPlaceholder("What fixed it?")).toHaveValue(RESOLUTION);
    await expect(dialog.getByText("In Progress → Closed")).toBeVisible();
    await shot(page, testInfo, "Admin reviews the closed job");
  });
});
