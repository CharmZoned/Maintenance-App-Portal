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
    await expect(page.getByRole("heading", { name: "My requests" })).toBeVisible();
    await expect(page.getByText("Unit 1A · Maple Court")).toBeVisible();

    await page.getByRole("button", { name: "New request" }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Reporting for")).toContainText("Unit 1A · Maple Court");
    await dialog.getByLabel("Title").fill(TITLE);
    await choose(page, selectUnder(dialog, "Category"), "Plumbing");
    await dialog.getByLabel("Description").fill(DESCRIPTION);
    await dialog.getByLabel("Permission to enter if nobody is home").check();
    await dialog.locator("#tenant-photos").setInputFiles(PNG);
    await shot(page, testInfo, "Tenant fills in the request");
    await dialog.getByRole("button", { name: "Submit request" }).click();

    await expect(page.getByText("Request submitted with photos")).toBeVisible();
    const card = page.locator("h3", { hasText: TITLE });
    await expect(card).toBeVisible();
    await expect(page.getByText("Submitted", { exact: true })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Active (1)", exact: true })).toBeVisible();
    await shot(page, testInfo, "Request appears in My requests");
  });

  test("Worker · does not see the request before it is assigned", async ({ page }, testInfo) => {
    await signIn(page, "worker");
    await page.goto("/maintenance");
    await expect(page.getByText("Nothing here")).toBeVisible();
    await expect(page.locator("h3", { hasText: TITLE })).toHaveCount(0);
    await shot(page, testInfo, "Worker's queue is empty");
  });

  test("Admin · sees the new request and assigns it to a worker with a date", async ({ page }, testInfo) => {
    await signIn(page, "admin");
    await page.goto("/maintenance");
    const card = page.locator("h3", { hasText: TITLE });
    await expect(card).toBeVisible();
    await expect(page.getByText(/Plumbing · Tina Renter · Maple Court · 1A/)).toBeVisible();
    await shot(page, testInfo, "Admin's maintenance queue");

    await card.click();
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
    await page.getByRole("tab", { name: "Scheduled", exact: true }).click();
    await expect(page.locator("h3", { hasText: TITLE })).toBeVisible();
    await shot(page, testInfo, "Request is now Scheduled");
  });

  test("Worker · opens the assigned request and sees the tenant's report and photo", async ({ page }, testInfo) => {
    await signIn(page, "worker");
    await page.goto("/maintenance");
    const card = page.locator("h3", { hasText: TITLE });
    await expect(card).toBeVisible();
    await expect(page.getByText(/Tina Renter · Maple Court · 1A/)).toBeVisible();
    await shot(page, testInfo, "Worker's queue shows the job");

    await card.click();
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
    await page.locator("h3", { hasText: TITLE }).click();
    const dialog = page.getByRole("dialog");

    await choose(page, selectUnder(dialog, "Status"), "In progress");
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Work order saved.")).toBeVisible();

    await page.getByRole("tab", { name: "In progress", exact: true }).click();
    await page.locator("h3", { hasText: TITLE }).click();
    await dialog.getByPlaceholder("Add a comment…").fill(WORKER_UPDATE);
    await choose(page, dialog.locator('button[role="combobox"]', { hasText: "Internal" }), "Tenant visible");
    await dialog.getByRole("button", { name: "Post comment" }).click();
    await expect(dialog.getByText(WORKER_UPDATE)).toBeVisible();
    await expect(dialog.getByText("Scheduled → In Progress")).toBeVisible();
    await shot(page, testInfo, "Job in progress with a tenant-visible update");
  });

  test("Tenant · sees the request in progress and reads the worker's update", async ({ page }, testInfo) => {
    await signIn(page, "tenant");
    await expect(page.getByText("In progress", { exact: true })).toBeVisible();
    await page.locator("h3", { hasText: TITLE }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Request details" })).toBeVisible();
    await expect(dialog.getByText(WORKER_UPDATE)).toBeVisible();
    await dialog.getByPlaceholder("Message staff…").fill("Thanks — I'll keep the bathroom clear.");
    await dialog.getByRole("button", { name: "Send message" }).click();
    await expect(dialog.getByText("Thanks — I'll keep the bathroom clear.")).toBeVisible();
    await shot(page, testInfo, "Tenant reads the update and replies");
  });

  test("Worker · closes the job with resolution notes", async ({ page }, testInfo) => {
    await signIn(page, "worker");
    await page.goto("/maintenance");
    await page.locator("h3", { hasText: TITLE }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Thanks — I'll keep the bathroom clear.")).toBeVisible();

    await choose(page, selectUnder(dialog, "Status"), "Closed");
    await dialog.getByPlaceholder("What fixed it?").fill(RESOLUTION);
    await shot(page, testInfo, "Worker records what fixed it");
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Work order saved.")).toBeVisible();

    await expect(page.getByText("Nothing here"), "closed jobs leave the open queue").toBeVisible();
    await page.getByRole("tab", { name: "Closed", exact: true }).click();
    await expect(page.locator("h3", { hasText: TITLE })).toBeVisible();
  });

  test("Tenant · sees the request closed with its full status history", async ({ page }, testInfo) => {
    await signIn(page, "tenant");
    await expect(page.getByRole("tab", { name: "Closed (1)", exact: true })).toBeVisible();
    await page.getByRole("tab", { name: "Closed (1)", exact: true }).click();
    await page.locator("h3", { hasText: TITLE }).click();
    const dialog = page.getByRole("dialog");
    for (const line of ["Open", "Open → Scheduled", "Scheduled → In Progress", "In Progress → Closed"]) {
      await expect(dialog.getByText(line, { exact: true })).toBeVisible();
    }
    await shot(page, testInfo, "Tenant sees the closed request and its trail");
  });

  test("Admin · sees the closed job on the dashboard as no longer open", async ({ page }, testInfo) => {
    await signIn(page, "admin");
    await page.goto("/maintenance");
    await expect(page.getByText("Nothing here")).toBeVisible();
    await page.getByRole("tab", { name: "Closed", exact: true }).click();
    await page.locator("h3", { hasText: TITLE }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByPlaceholder("What fixed it?")).toHaveValue(RESOLUTION);
    await shot(page, testInfo, "Admin reviews the closed job");
  });
});
