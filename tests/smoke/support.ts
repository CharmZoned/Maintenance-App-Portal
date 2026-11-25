/**
 * Shared pieces for the smoke tests (playwright.smoke.config.ts).
 *
 * They run against the local emulator by default, or against a deployed
 * staging site when SMOKE_BASE_URL is set. Everything here is read-only: the
 * tests sign in with the quick sign-in buttons and open pages, nothing more.
 */
import { test as base, expect, type Page, type Request } from "@playwright/test";
import { DEMO_ACCOUNTS, DEMO_ROLE_ORDER, homePathForDemoRole, type DemoRoleKey } from "../../src/client/lib/demo-accounts";

export { expect };
export type { DemoRoleKey };

/** True when pointed at a deployed site rather than the local emulator. */
export const REMOTE = Boolean(process.env.SMOKE_BASE_URL?.trim());

const BYPASS_SECRET = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim() || undefined;

/** Requests to the Supabase API (REST, auth, storage, functions), wherever it is hosted. */
const SUPABASE_API = /\/(rest|auth|storage|functions|graphql)\/v1\//;

export const ROLES: DemoRoleKey[] = DEMO_ROLE_ORDER;

/**
 * Expected role homes, from the app's own table (BUILD_PLAN Phase 3 checks: Admin /dashboard,
 * Landlord and Tenant /home, Maintenance /maintenance). The pathname must match exactly.
 */
export const ROLE_HOME = Object.fromEntries(
  DEMO_ROLE_ORDER.map((role) => [role, (url: URL) => url.pathname === homePathForDemoRole(role)]),
) as Record<DemoRoleKey, (url: URL) => boolean>;

export function roleLabel(role: DemoRoleKey): string {
  return DEMO_ACCOUNTS[role].roleLabel;
}

/** Things that went wrong on the page since the last check. */
export type Problems = {
  list: string[];
  /** apikey + authorization headers of the app's own Supabase REST calls, for read-only lookups. */
  rest: { origin: string; headers: Record<string, string> } | null;
};

/**
 * `page` that:
 *  - gets past Vercel Authentication when VERCEL_AUTOMATION_BYPASS_SECRET is set
 *    (the bypass headers go to the site's own origin only, never to Supabase);
 *  - against the emulator, refuses to reach any real Supabase project;
 *  - records failed Supabase API calls and uncaught page errors in `problems`.
 */
export const test = base.extend<{ problems: Problems }>({
  problems: async ({}, use) => {
    await use({ list: [], rest: null });
  },
  page: async ({ page, baseURL, problems }, use) => {
    const siteOrigin = new URL(baseURL!).origin;

    if (BYPASS_SECRET) {
      await page.route(
        (url) => url.origin === siteOrigin,
        (route) =>
          route.continue({
            headers: {
              ...route.request().headers(),
              "x-vercel-protection-bypass": BYPASS_SECRET,
              "x-vercel-set-bypass-cookie": "true",
            },
          }),
      );
    }

    const toRealSupabase: string[] = [];
    if (!REMOTE) {
      await page.route(
        (url) => /supabase\.(co|in|com)$/.test(url.hostname),
        (route) => {
          toRealSupabase.push(route.request().url());
          return route.abort();
        },
      );
    }

    page.on("pageerror", (err) => problems.list.push(`uncaught page error: ${err.message}`));
    page.on("requestfinished", (req) => void noteRest(req, problems));
    page.on("response", (res) => {
      if (!SUPABASE_API.test(new URL(res.url()).pathname)) return;
      if (res.status() >= 400) {
        const u = new URL(res.url());
        problems.list.push(`${res.request().method()} ${u.pathname}${u.search} → ${res.status()}`);
      }
    });
    page.on("requestfailed", (req) => {
      const u = new URL(req.url());
      if (!SUPABASE_API.test(u.pathname)) return;
      const reason = req.failure()?.errorText ?? "failed";
      // Navigating away cancels in-flight fetches; that is not a server failure.
      if (/ERR_ABORTED|NS_BINDING_ABORTED|cancelled/i.test(reason)) return;
      problems.list.push(`${req.method()} ${u.pathname} → ${reason}`);
    });

    await use(page);
    expect(toRealSupabase, "the browser tried to reach a real Supabase project").toEqual([]);
    // Anything that went wrong after the test's last screen check still fails the test.
    expect(problems.list, "failed Supabase calls or page errors after the last screen check").toEqual([]);
  },
});

/** Keep the latest session's headers, so a role switch is picked up. */
async function noteRest(req: Request, problems: Problems): Promise<void> {
  const u = new URL(req.url());
  if (!u.pathname.includes("/rest/v1/") || req.method() !== "GET") return;
  const headers = await req.allHeaders();
  if (!headers.apikey || !headers.authorization) return;
  problems.rest = { origin: u.origin, headers: { apikey: headers.apikey, authorization: headers.authorization } };
}

/** The login page with the quick sign-in card loaded. */
export async function openLogin(page: Page, search = ""): Promise<void> {
  await page.goto(`/${search}`);
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.locator("[data-quick-signin]"), "the staging quick sign-in card").toBeVisible();
}

/** Click a role's quick sign-in button and wait for the signed-in shell. */
export async function quickSignIn(page: Page, role: DemoRoleKey): Promise<void> {
  await openLogin(page);
  await page.locator(`[data-quick-signin-role="${role}"]`).click();
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
  await expect(page).toHaveURL(ROLE_HOME[role]);
}

/**
 * The content each role's home must show once it has loaded. With `withinMs`, every wait shares
 * that one deadline (no per-step floor), so a slow paint fails rather than stretching the budget.
 */
export async function expectRoleHome(page: Page, role: DemoRoleKey, withinMs?: number): Promise<void> {
  const deadline = withinMs === undefined ? undefined : Date.now() + withinMs;
  // Playwright reads timeout 0 as "no limit", so an exhausted budget becomes 1 ms, not 0.
  const t = () => (deadline === undefined ? {} : { timeout: Math.max(1, deadline - Date.now()) });
  await expect(page).toHaveURL(ROLE_HOME[role], t());
  const greeting = page.getByRole("heading", { level: 1, name: /^Good (morning|afternoon|evening)/ });
  switch (role) {
    case "admin":
      await expect(greeting).toBeVisible(t());
      await expect(page.getByRole("heading", { name: "Needs your attention" })).toBeVisible(t());
      break;
    case "landlord":
      await expect(greeting).toBeVisible(t());
      await expect(page.getByRole("region", { name: "Your properties" })).toBeVisible(t());
      break;
    case "tenant":
      await expect(page.getByRole("heading", { name: "Home" }).first()).toBeVisible(t());
      break;
    case "maintenance":
      await expect(page.getByRole("heading", { name: "My jobs" })).toBeVisible(t());
      break;
  }
  await expect(page.getByRole("navigation", { name: "Primary" }).first()).toBeVisible(t());
}

/**
 * Open `path` and check the screen: it settles, no error boundary or
 * configuration notice, every image decoded, and no failed Supabase call or
 * page error since the previous check.
 */
export async function visit(page: Page, problems: Problems, path: string): Promise<void> {
  await test.step(path, async () => {
    await page.goto(path);
    await settle(page);
    await checkScreen(page, problems, path);
  });
}

export async function settle(page: Page): Promise<void> {
  await expect(page.getByRole("navigation", { name: "Primary" }).first()).toBeVisible();
  // The app keeps no long-lived connections open, so the network goes quiet once the page has loaded.
  // Best effort only: a screen that polls may never go fully quiet. The Loading check below is the hard one.
  await page.waitForLoadState("networkidle", { timeout: REMOTE ? 20_000 : 10_000 }).catch(() => undefined);
  await expect(page.getByText(/^Loading/), "the screen is still loading").toHaveCount(0, { timeout: REMOTE ? 15_000 : 8_000 });
}

export async function checkScreen(page: Page, problems: Problems, label: string): Promise<void> {
  await expect(page.getByRole("heading", { name: "Something went wrong" }), `${label}: error boundary`).toHaveCount(0);
  await expect(page.getByText(/not configured|Missing VITE_SUPABASE_URL/i), `${label}: missing configuration notice`).toHaveCount(0);
  await expect(page.getByText("Restoring session…"), `${label}: still restoring the session`).toHaveCount(0);

  const broken = await brokenImages(page);
  expect(broken, `${label}: images that did not load`).toEqual([]);

  const seen = problems.list.splice(0);
  expect(seen, `${label}: failed Supabase calls or page errors`).toEqual([]);
}

/** Images on the page that finished loading with nothing to show. Lazy images not yet requested are skipped. */
async function brokenImages(page: Page): Promise<string[]> {
  // Give images that are still downloading a moment to finish.
  await page
    .waitForFunction(() => [...document.images].every((img) => img.complete || img.loading === "lazy"), undefined, {
      timeout: REMOTE ? 15_000 : 8_000,
    })
    .catch(() => undefined);
  return page.evaluate(() =>
    [...document.images]
      .filter((img) => img.complete && img.naturalWidth === 0 && (img.currentSrc || img.src))
      .map((img) => img.currentSrc || img.src),
  );
}

/**
 * The newest row id this signed-in user can read from `table`, using the app's
 * own Supabase session (a GET; row-level security decides what comes back).
 * Null when the user can see no rows.
 */
export async function newestId(page: Page, problems: Problems, table: string): Promise<number | null> {
  await expect.poll(() => problems.rest !== null, { message: "the app made no Supabase REST call to borrow" }).toBe(true);
  const { origin, headers } = problems.rest!;
  const res = await page.request.get(`${origin}/rest/v1/${encodeURIComponent(table)}?select=id&order=id.desc&limit=1`, {
    headers,
  });
  expect(res.status(), `GET ${table}`).toBe(200);
  const rows = (await res.json()) as Array<{ id: number }>;
  return rows.length ? Number(rows[0].id) : null;
}
