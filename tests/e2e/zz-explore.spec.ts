import { choose, expect, resetWorld, signIn, test } from "./support";
test("explore tenant conversation", async ({ page }) => {
  await resetWorld();
  await signIn(page, "tenant");
  await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Requests" }).click();
  await page.getByRole("button", { name: "New maintenance request" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Issue title").fill("Explore leak");
  await dialog.getByLabel("Description").fill("desc");
  await dialog.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(page.getByText("Request submitted")).toBeVisible();
  await page.screenshot({ path: "/tmp/claude-0/-home-user-Maintenance-App-Portal/148f362b-cb24-5a19-ab08-c78c6131146e/scratchpad/tenant-requests.png", fullPage: true });
  await page.getByRole("button", { name: "Open request conversation" }).click();
  await page.waitForTimeout(1500);
  console.log("URL:", page.url());
  await page.screenshot({ path: "/tmp/claude-0/-home-user-Maintenance-App-Portal/148f362b-cb24-5a19-ab08-c78c6131146e/scratchpad/tenant-conversation.png", fullPage: true });
  console.log(await page.getByRole("main").innerText());
});
