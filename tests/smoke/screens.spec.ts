/**
 * Smoke: each role signs in with its quick sign-in button and opens its main
 * screens. A screen fails on a Supabase API call answering 4xx/5xx, an uncaught
 * page error, an image that did not load, or an error boundary / missing
 * configuration notice (see checkScreen in ./support).
 *
 * Read-only by design — no clicks that save anything — so it can run against
 * staging again and again. Opening a request or conversation may move the demo
 * user's own "read up to" mark, exactly as a person looking at it would.
 */
import { checkScreen, expect, newestId, quickSignIn, settle, test, visit, type Problems } from "./support";
import type { Page } from "@playwright/test";

/** Open the request page of the newest request this user can see, if any. */
async function visitNewestRequest(page: Page, problems: Problems): Promise<void> {
  const id = await newestId(page, problems, "MaintenanceRequests");
  test.info().annotations.push({ type: "request", description: id === null ? "none visible" : `#${id}` });
  if (id !== null) await visit(page, problems, `/maintenance/${id}`);
}

async function visitNewestProperty(page: Page, problems: Problems): Promise<void> {
  const id = await newestId(page, problems, "Properties");
  test.info().annotations.push({ type: "property", description: id === null ? "none visible" : `#${id}` });
  if (id !== null) await visit(page, problems, `/properties/${id}`);
}

/** The bell opens the notifications panel; looking at it marks nothing read. */
async function openNotifications(page: Page, problems: Problems): Promise<void> {
  await test.step("notifications panel", async () => {
    await page.getByRole("button", { name: /^Notifications/ }).first().click();
    const panel = page.getByRole("dialog", { name: "Notifications" });
    await expect(panel).toBeVisible();
    await settle(page);
    await checkScreen(page, problems, "notifications panel");
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
  });
}

test("Admin · main screens", async ({ page, problems }) => {
  await quickSignIn(page, "admin");
  await settle(page);
  await checkScreen(page, problems, "/dashboard (after sign-in)");

  for (const path of [
    "/maintenance",
    "/calendar",
    "/properties",
    "/people?tab=approvals",
    "/people?tab=tenants",
    "/people?tab=landlords",
    "/people?tab=team",
    "/people?tab=vendors",
    "/users",
    "/messages",
    "/documents",
    "/listings",
    "/rent",
    "/leases",
    "/applications",
    "/settings",
    "/account",
  ]) {
    await visit(page, problems, path);
  }
  await visitNewestRequest(page, problems);
  await visitNewestProperty(page, problems);
  await visit(page, problems, "/dashboard");
  await openNotifications(page, problems);
});

test("Landlord · main screens", async ({ page, problems }) => {
  await quickSignIn(page, "landlord");
  await settle(page);
  await checkScreen(page, problems, "/home (after sign-in)");

  for (const path of ["/properties", "/maintenance", "/messages", "/documents", "/account"]) {
    await visit(page, problems, path);
  }
  await visitNewestRequest(page, problems);
  await visitNewestProperty(page, problems);
  await visit(page, problems, "/home");
  await openNotifications(page, problems);
});

test("Tenant · main screens", async ({ page, problems }) => {
  await quickSignIn(page, "tenant");
  await settle(page);
  await checkScreen(page, problems, "/home (after sign-in)");

  for (const path of ["/maintenance", "/messages", "/documents", "/payments", "/payments/ledger", "/account"]) {
    await visit(page, problems, path);
  }
  await visitNewestRequest(page, problems);
  await visit(page, problems, "/home");
  await openNotifications(page, problems);
});

test("Maintenance · main screens", async ({ page, problems }) => {
  await quickSignIn(page, "maintenance");
  await settle(page);
  await checkScreen(page, problems, "/maintenance (after sign-in)");

  for (const path of ["/calendar", "/messages", "/account"]) {
    await visit(page, problems, path);
  }
  await visitNewestRequest(page, problems);
  await visit(page, problems, "/maintenance");
  await openNotifications(page, problems);
});
