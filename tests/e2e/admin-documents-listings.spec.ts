/**
 * Admin Documents and Website listings: no developer copy, and no Dashboard
 * control that leads somewhere it can't deliver. Upload works from Quick add;
 * listings say plainly that publishing is coming soon and show what is live.
 */
import type { Page } from "@playwright/test";
import { choose, expect, resetWorld, shot, signIn, test, type World } from "./support";

/** Words that only make sense to the people building the portal. */
const DEVELOPER_COPY = /\bPRs?\b|lands? in|later .*screen|isn.t built|not built|\bstub/i;

async function expectNoDeveloperCopy(page: Page) {
  const text = await page.locator("main, body").first().innerText();
  expect(text).not.toMatch(DEVELOPER_COPY);
}

test.describe("Admin documents and website listings", () => {
  let world: World;
  test.beforeAll(async () => {
    world = await resetWorld();
  });

  test("Quick add uploads a document, and the Documents page lists it", async ({ page }, testInfo) => {
    await signIn(page, "admin");
    await page.getByRole("button", { name: "Quick add" }).click();
    const menu = page.getByRole("menu", { name: "Quick add" });
    await expect(menu.getByRole("menuitem", { name: "Upload document" })).toBeVisible();
    // Listings can't be created from the portal yet, so Quick add doesn't offer it.
    await expect(menu.getByRole("menuitem", { name: "New listing" })).toHaveCount(0);
    await shot(page, testInfo, "Quick add menu");

    await menu.getByRole("menuitem", { name: "Upload document" }).click();
    const dialog = page.getByRole("dialog", { name: "Upload document" });
    await choose(page, dialog.getByRole("combobox", { name: "Property" }), world.property.name);
    await dialog.getByLabel("Title").fill("Pest control schedule");
    await dialog.locator("#admin-doc-file").setInputFiles({
      name: "pest-control.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\n% pest control\n"),
    });
    await choose(page, dialog.getByRole("combobox", { name: "Who can see it" }), "Tenant (+ landlord + staff)");
    await dialog.getByRole("button", { name: "Upload", exact: true }).click();
    await expect(dialog).toBeHidden();

    await page.goto("/documents");
    await expect(page.getByRole("heading", { level: 1, name: "Documents" })).toBeVisible();
    await expect(page.getByText("Pest control schedule", { exact: true })).toBeVisible();
    await expect(page.getByText("Tenant can see").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Download Pest control schedule" })).toBeVisible();
    await expectNoDeveloperCopy(page);
    await shot(page, testInfo, "Admin Documents page");
  });

  test("Website listings says publishing is coming soon and shows what is live", async ({ page }, testInfo) => {
    await signIn(page, "admin");
    await page.goto("/listings");
    await expect(page.getByRole("heading", { level: 1, name: "Website listings" })).toBeVisible();
    await expect(page.getByText("Publishing listings from the portal is coming soon")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Live on your website" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Vacant, not on your website" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open properties" })).toBeVisible();
    await expectNoDeveloperCopy(page);
    await shot(page, testInfo, "Website listings page");
  });
});
