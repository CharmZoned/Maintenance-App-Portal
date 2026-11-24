/**
 * BUILD_PLAN 3.8: each staging quick sign-in button lands on its role's home,
 * within three seconds (Phase 3 checks). Also `/login?as=<role>` and the
 * ribbon's role switcher. Read-only, so it is safe against staging too.
 */
import { expect, expectRoleHome, openLogin, quickSignIn, REMOTE, ROLE_HOME, test, type DemoRoleKey } from "./support";

const ROLES: DemoRoleKey[] = ["admin", "landlord", "tenant", "maintenance"];
/** The Phase 3 budget; a deployed site gets extra slack for a cold function or slow network. */
const LANDING_MS = REMOTE ? 6_000 : 3_000;

test.describe("Quick sign-in · each button lands on its role's home", () => {
  for (const role of ROLES) {
    test(`${role} button`, async ({ page }) => {
      await openLogin(page);
      const started = Date.now();
      await page.locator(`[data-quick-signin-role="${role}"]`).click();
      await expect(page).toHaveURL(ROLE_HOME[role], { timeout: LANDING_MS });
      await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible({
        timeout: Math.max(500, LANDING_MS - (Date.now() - started)),
      });
      expect(Date.now() - started, `${role} landed within ${LANDING_MS} ms`).toBeLessThanOrEqual(LANDING_MS);
      await expectRoleHome(page, role);
      // The quick sign-in leaves no `?as=` or login leftovers on the address.
      expect(new URL(page.url()).search).toBe("");
    });
  }
});

test.describe("Quick sign-in · /login?as=<role>", () => {
  for (const role of ROLES) {
    test(`?as=${role}`, async ({ page }) => {
      await page.goto(`/login?as=${role}`);
      await expectRoleHome(page, role);
      expect(new URL(page.url()).search, "?as= is cleared so signing out does not sign in again").toBe("");
    });
  }

  test("an unknown role does nothing", async ({ page }) => {
    await openLogin(page, "login?as=superuser");
    await page.waitForTimeout(1_000);
    await expect(page.getByRole("navigation", { name: "Primary" })).toHaveCount(0);
  });
});

test("Staging ribbon · the role switcher moves between all four roles", async ({ page }) => {
  await quickSignIn(page, "admin");
  const ribbon = page.locator("[data-staging-ribbon]");
  await expect(ribbon).toBeVisible();
  await expect(page).toHaveTitle(/^\[STAGING\]/);

  for (const role of ["landlord", "tenant", "maintenance", "admin"] as const) {
    await ribbon.getByRole("button", { name: /^(Viewing as|Switch role)/ }).click();
    await ribbon.getByRole("menuitem", { name: new RegExp(`^${roleLabel(role)}\\b`) }).click();
    await expectRoleHome(page, role);
    await expect(ribbon.getByRole("button", { name: `Viewing as ${roleLabel(role)} ▾` })).toBeVisible();
  }
});

function roleLabel(role: DemoRoleKey): string {
  return { admin: "Admin", landlord: "Landlord", tenant: "Tenant", maintenance: "Maintenance" }[role];
}
