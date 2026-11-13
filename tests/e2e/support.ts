import { test as base, expect, type Locator, type Page, type TestInfo } from "@playwright/test";
import { PASSWORD, PERSONAS, type PersonaKey, type World } from "../emulator/seed";
import { E2E_EMULATOR_URL } from "../support/ports";

export { expect, PASSWORD, PERSONAS };
export type { PersonaKey, World };

/**
 * `page` with a tripwire. Requests that would leave this machine are aborted
 * (fonts, analytics — the tests are hermetic), and if any of them was headed for
 * a real Supabase project the test fails outright.
 */
export const test = base.extend<{ page: Page }>({
  page: async ({ page }, use) => {
    const toSupabase: string[] = [];
    await page.route(
      (url) => url.protocol.startsWith("http") && !["127.0.0.1", "localhost"].includes(url.hostname),
      (route) => {
        const url = route.request().url();
        if (/supabase\.(co|in|com)/.test(new URL(url).hostname)) toSupabase.push(url);
        return route.abort();
      },
    );
    await use(page);
    expect(toSupabase, "the browser tried to reach a real Supabase project").toEqual([]);
  },
});

async function control<T>(route: string, body?: unknown): Promise<T> {
  const res = await fetch(`${E2E_EMULATOR_URL}/__emulator${route}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`emulator ${route} → ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

export async function resetWorld(): Promise<World> {
  return (await control<{ world: World }>("/reset", { seed: true })).world;
}

export async function sql<T = Record<string, unknown>>(query: string, params: unknown[] = []): Promise<T[]> {
  return (await control<{ rows: T[] }>("/sql", { query, params })).rows;
}

export async function outbox(): Promise<Array<{ to: string; type: string; link: string }>> {
  return (await control<{ mail: Array<{ to: string; type: string; link: string }> }>("/outbox")).mail;
}

/** Sign in through the real login form. */
export async function signIn(page: Page, who: PersonaKey | { email: string; password?: string }): Promise<void> {
  const email = typeof who === "string" ? PERSONAS[who].email : who.email;
  const password = typeof who === "string" ? PASSWORD : (who.password ?? PASSWORD);
  await page.goto("/");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
}

export async function signOut(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
}

/** Attach a named screenshot to the test; the dashboard shows these per step. */
export async function shot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await testInfo.attach(name, { body: await page.screenshot(), contentType: "image/png" });
}

/** The dropdown that sits under a given field label (the app's selects have no accessible name). */
export function selectUnder(scope: Page | Locator, label: string): Locator {
  return scope.locator(`label:text-is("${label}") ~ button[role="combobox"]`).first();
}

export async function choose(page: Page, trigger: Locator, option: string | RegExp): Promise<void> {
  await trigger.click();
  await page.getByRole("option", { name: option }).click();
}

export function tomorrow(): string {
  return new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10);
}

/** A small real PNG on disk-free form, for file inputs. */
export const PNG = {
  name: "leak.png",
  mimeType: "image/png",
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
};
