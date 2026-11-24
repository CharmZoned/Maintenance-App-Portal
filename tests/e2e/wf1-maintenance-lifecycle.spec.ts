/**
 * WF1 — Maintenance request lifecycle, in a real browser.
 *
 *   Tenant submits a request  →  Admin assigns it to a worker  →  Worker views
 *   and works the request  →  Tenant sees the outcome.
 *
 * Every step signs in through the login form as that person and uses the same
 * screens they would. Steps run in order and share one database, so a failure
 * stops the rest (later steps would be meaningless).
 */
import { choose, expect, PNG, resetWorld, selectUnder, shot, signIn, test, tomorrow } from "./support";

const TITLE = "Bathroom sink is leaking";
const DESCRIPTION = "Water pools under the sink every time the tap runs.";
const WORKER_UPDATE = "Found a cracked trap — back tomorrow with the part.";
const RESOLUTION = "Replaced the cracked trap and re-sealed the drain.";

test.describe.configure({ mode: "serial" });

test.describe("[WF1] Maintenance request lifecycle", () => {
  test.beforeAll(async () => {
    await resetWorld();
  });

  test("Tenant · submits a maintenance request with a photo", async ({ page }, testInfo) => {
    await signIn(page, "tenant");
    // Tenants land on Home; their requests are one click away in the nav.
    await page.getByRole("link", { name: "Requests", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Requests" })).toBeVisible();
    await expect(page.getByText(/Unit 1A · Maple Court/).first()).toBeVisible();

    await page.getByRole("button", { name: "New maintenance request" }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Request maintenance" })).toBeVisible();
    await expect(dialog).toContainText("Unit 1A · Maple Court");
    await dialog.getByLabel("Issue title").fill(TITLE);
    await choose(page, dialog.locator("#tenant-category"), "Plumbing");
    await dialog.getByLabel("Description").fill(DESCRIPTION);
    await choose(page, dialog.locator("#tenant-permission"), "Yes, if no one home");
    await dialog.locator("#tenant-photos").setInputFiles(PNG);
    await shot(page, testInfo, "Tenant fills in the request");
    await dialog.getByRole("button", { name: "Submit", exact: true }).click();

    await expect(dialog).toHaveCount(0);
    await expect(page.getByText(TITLE).filter({ visible: true }).first()).toBeVisible();
    await shot(page, testInfo, "Request appears in Requests");
  });

  test("Worker · does not see the request before it is assigned", async ({ page }, testInfo) => {
    await signIn(page, "worker");
    await page.goto("/maintenance");
    await expect(page.getByRole("heading", { level: 1, name: "My jobs" })).toBeVisible();
    await expect(page.getByText("No jobs assigned yet. New work will show up here.")).toBeVisible();
    await expect(page.getByRole("button", { name: new RegExp(TITLE) })).toHaveCount(0);
    await shot(page, testInfo, "Worker's queue is empty");
  });

  test("Admin · sees the new request and assigns it to a worker with a date", async ({ page }, testInfo) => {
    await signIn(page, "admin");
    await page.goto("/maintenance");
    // New, unassigned requests land in Needs action (the default tab).
    const row = page.getByRole("link", { name: new RegExp(TITLE) });
    await expect(row).toBeVisible();
    await expect(row).toContainText("Tina Renter");
    await expect(row).toContainText("Unassigned");
    await shot(page, testInfo, "Admin's maintenance queue");

    await row.click();
    await expect(page).toHaveURL(/\/maintenance\/\d+$/);
    await expect(page.getByText(DESCRIPTION).first()).toBeVisible();
    await expect(page.getByText("1 photo", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Assign and schedule" }).first().click();
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

    await page.goto("/maintenance");
    await expect(page.getByRole("link", { name: new RegExp(TITLE) }), "assigned work leaves Needs action").toHaveCount(0);
    await page.getByRole("button", { name: /^Active \(/ }).click();
    const active = page.getByRole("link", { name: new RegExp(TITLE) });
    await expect(active).toBeVisible();
    await expect(active).toContainText("Sam Fixit");
    await shot(page, testInfo, "Request is now Active, assigned to Sam");
  });

  test("Worker · opens the assigned request and sees the tenant's report and photo", async ({ page }, testInfo) => {
    await signIn(page, "worker");
    await page.goto("/maintenance");
    const row = page.getByRole("button", { name: new RegExp(TITLE) });
    await expect(row).toBeVisible();
    await expect(row).toContainText("Maple Court · Unit 1A");
    await shot(page, testInfo, "Worker's queue shows the job");

    await row.click();
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
    await page.getByRole("button", { name: new RegExp(TITLE) }).click();
    const dialog = page.getByRole("dialog");

    await choose(page, selectUnder(dialog, "Status"), "In progress");
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Work order saved.")).toBeVisible();

    const row = page.getByRole("button", { name: new RegExp(TITLE) });
    await expect(row).toContainText("In progress");
    await row.click();
    await dialog.getByPlaceholder("Add a comment…").fill(WORKER_UPDATE);
    await choose(page, dialog.locator('button[role="combobox"]', { hasText: "Internal" }), "Tenant visible");
    await dialog.getByRole("button", { name: "Post comment" }).click();
    await expect(dialog.getByText(WORKER_UPDATE)).toBeVisible();
    await expect(dialog.getByText("Scheduled → In Progress")).toBeVisible();
    await shot(page, testInfo, "Job in progress with a tenant-visible update");
  });

  test("Tenant · sees the request in progress and reads the worker's update", async ({ page }, testInfo) => {
    await signIn(page, "tenant");
    await page.getByRole("link", { name: "Requests", exact: true }).click();
    const row = page.getByRole("button", { name: new RegExp(TITLE) });
    await expect(row).toContainText("In progress");
    await row.click();
    await expect(page.getByText(WORKER_UPDATE).filter({ visible: true }).first()).toBeVisible();
    await shot(page, testInfo, "Tenant reads the worker's update");
    // Tenant replies would go through Messages, whose request threads are still a
    // demo (no message-center API), so there is no real reply to test here yet.
  });

  test("Worker · closes the job with resolution notes", async ({ page }, testInfo) => {
    await signIn(page, "worker");
    await page.goto("/maintenance");
    await page.getByRole("button", { name: new RegExp(TITLE) }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(WORKER_UPDATE)).toBeVisible();

    // A job can't be completed without a photo of the finished work.
    await dialog.locator('input[type="file"]').setInputFiles(PNG);
    await dialog.getByRole("button", { name: "Upload 1 photo" }).click();
    await expect(page.getByText("Photos uploaded.")).toBeVisible();
    await expect(dialog.getByRole("img", { name: "Maintenance photo" })).toHaveCount(2);

    await choose(page, selectUnder(dialog, "Status"), "Closed");
    await dialog.getByPlaceholder("What fixed it?").fill(RESOLUTION);
    await shot(page, testInfo, "Worker records what fixed it");
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Work order saved.")).toBeVisible();

    await expect(page.getByText("No open jobs"), "closed jobs leave the open queue").toBeVisible();
    const completed = page.locator("section", { has: page.getByRole("heading", { name: "Recently completed" }) });
    await expect(completed.getByRole("button", { name: new RegExp(TITLE) })).toBeVisible();
    await shot(page, testInfo, "Job moves to Recently completed");
  });

  test("Tenant · sees the request completed with its status history", async ({ page }, testInfo) => {
    await signIn(page, "tenant");
    await page.getByRole("link", { name: "Requests", exact: true }).click();
    await expect(page.getByText("No open requests right now.")).toBeVisible();
    await page.getByRole("button", { name: "Completed · 1", exact: true }).click();
    const row = page.getByRole("button", { name: new RegExp(TITLE) });
    await expect(row).toContainText("Completed");
    await row.click();
    await page.getByRole("button", { name: "Open full request" }).click();
    await expect(page).toHaveURL(/\/maintenance\/\d+$/);
    const updates = page.getByRole("list").filter({ hasText: "Status → Closed" });
    for (const line of ["Created", "Status → Scheduled", "Status → In Progress", WORKER_UPDATE, "Status → Closed"]) {
      await expect(updates.getByText(line, { exact: true })).toBeVisible();
    }
    await expect(updates.getByRole("img", { name: "Photo" }), "the tenant's photo and the finished-work photo").toHaveCount(2);
    await shot(page, testInfo, "Tenant sees the completed request and its trail");
  });

  test("Admin · sees the job completed, with the worker's resolution", async ({ page }, testInfo) => {
    await signIn(page, "admin");
    await page.goto("/maintenance");
    await page.getByRole("button", { name: /^Completed \(/ }).click();
    const row = page.getByRole("link", { name: new RegExp(TITLE) });
    await expect(row).toContainText("Sam Fixit");
    await row.click();
    await expect(page).toHaveURL(/\/maintenance\/\d+$/);
    await page.getByRole("button", { name: "Edit details" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByPlaceholder("What fixed it?")).toHaveValue(RESOLUTION);
    await shot(page, testInfo, "Admin reviews the completed job");
  });
});
