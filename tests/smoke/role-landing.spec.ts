/**
 * BUILD_PLAN 3.8: each staging quick sign-in button lands on its role's home,
 * within three seconds (Phase 3 checks). Also `/login?as=<role>` and the
 * ribbon's role switcher. Read-only, so it is safe against staging too.
 */
import { expect, expectRoleHome, openLogin, quickSignIn, REMOTE, roleLabel, ROLES, settle, test } from "./support";

/** The Phase 3 budget; a deployed site gets extra slack for a cold function or slow network. */
const LANDING_MS = REMOTE ? 6_000 : 3_000;

test.describe("Quick sign-in · each button lands on its role's home", () => {
  for (const role of ROLES) {
    test(`${role} button`, async ({ page }) => {
      await openLogin(page);
      const started = Date.now();
      await page.locator(`[data-quick-signin-role="${role}"]`).click();
      // The timer covers the address change and the home content, not just the shell.
      await expectRoleHome(page, role, LANDING_MS);
      expect(Date.now() - started, `${role} home rendered within ${LANDING_MS} ms`).toBeLessThanOrEqual(LANDING_MS);
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
    const signInCalls: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/auth/v1/token")) signInCalls.push(req.url());
    });
    await openLogin(page, "login?as=superuser");
    // A real ?as= starts signing in right after the card mounts (it lands well under a second
    // locally), so hold the page for a moment: no sign-in call, the buttons stay usable, still on login.
    const admin = page.locator('[data-quick-signin-role="admin"]');
    for (let i = 0; i < 6; i++) {
      await expect(admin).toBeEnabled();
      await page.waitForTimeout(250);
    }
    expect(signInCalls, "no sign-in attempt for an unknown role").toEqual([]);
    await expect(page.getByRole("navigation", { name: "Primary" })).toHaveCount(0);
    await expect(page).toHaveURL(/\/login\?as=superuser$/);
  });
});

// Each home is left to finish loading before the next switch, as a person would. Switching while the
// bell is still loading makes its later queries go out signed-out (401); see the PR #106 notes.
test("Staging ribbon · the role switcher moves between all four roles", async ({ page }) => {
  await quickSignIn(page, "admin");
  await settle(page);
  const ribbon = page.locator("[data-staging-ribbon]");
  await expect(ribbon).toBeVisible();
  await expect(page).toHaveTitle(/^\[STAGING\]/);

  for (const role of ["landlord", "tenant", "maintenance", "admin"] as const) {
    await ribbon.getByRole("button", { name: /^(Viewing as|Switch role)/ }).click();
    await ribbon.getByRole("menuitem", { name: new RegExp(`^${roleLabel(role)}\\b`) }).click();
    await expectRoleHome(page, role);
    await expect(ribbon.getByRole("button", { name: `Viewing as ${roleLabel(role)} ▾` })).toBeVisible();
    await settle(page);
  }
});
