/**
 * The one request page (/maintenance/:id), per role, on the demo world.
 *
 *   Landlord: same page, "Emergency" everywhere, status events only, no composer.
 *   Worker:   a pooled job opens with its address and an Accept job button.
 *   Worker:   a job they may not see is "isn't available" with a way back to My jobs.
 */
import { E2E_EMULATOR_URL } from "../support/ports";
import { expect, sql, signIn, test, type World } from "./support";

const EMERGENCY = "Bedroom radiator stays cold"; // In progress, Riley, DB priority urgent
const POOLED_ELECTRICAL = "Bathroom outlet sparks when used"; // offered to the pool, Electrical

test.describe.configure({ mode: "serial" });

let world: World;

/** The demo world (what `pnpm dev:local` and staging show), not the standard one. */
async function resetDemoWorld(): Promise<World> {
  const res = await fetch(`${E2E_EMULATOR_URL}/__emulator/reset`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ seed: true, demo: true }),
  });
  const json = (await res.json()) as { world: World; message?: string };
  if (!res.ok) throw new Error(`emulator /reset: ${json.message ?? res.status}`);
  return json.world;
}

async function requestId(title: string): Promise<number> {
  const [row] = await sql<{ id: number }>(`select id from public."MaintenanceRequests" where title = $1`, [title]);
  return Number(row.id);
}

test.describe("Request page · per role", () => {
  test.beforeAll(async () => {
    world = await resetDemoWorld();
    expect(world).toBeTruthy();
  });

  test("Landlord · opens a request in one click and never sees Urgent", async ({ page }) => {
    await signIn(page, "landlord");
    await page.goto("/maintenance");
    await page.getByRole("link", { name: new RegExp(EMERGENCY) }).filter({ visible: true }).first().click();
    await expect(page).toHaveURL(/\/maintenance\/\d+$/);
    await expect(page.getByRole("heading", { name: EMERGENCY })).toBeVisible();
    await expect(page.getByText("Emergency").first()).toBeVisible();
    await expect(page.getByText("Urgent")).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "Message" }), "no landlord messaging (SOW)").toHaveCount(0);
    await expect(page.getByText("Landlord conversation")).toHaveCount(0);
    await expect(page.getByRole("complementary", { name: "Actions" })).toHaveCount(0);
  });

  test("Worker · accepts a pooled job from its request page", async ({ page }) => {
    const id = await requestId(POOLED_ELECTRICAL);
    await signIn(page, "worker2");
    await page.goto(`/maintenance/${id}`);
    await expect(page.getByRole("heading", { name: POOLED_ELECTRICAL })).toBeVisible();
    await expect(page.getByText("Offered to workers")).toHaveCount(0);
    await expect(page.getByText(/Maple Court|Cedar/).first(), "pooled job shows its address").toBeVisible();
    await page.getByRole("button", { name: "Accept job" }).filter({ visible: true }).first().click();
    await expect(page.getByText("Job accepted.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Start work" }).filter({ visible: true }).first()).toBeVisible();
  });

  test("Worker · a job outside their trades is not available, with a way back", async ({ page }) => {
    const id = await requestId(EMERGENCY); // Riley's job; Sam may not see it
    await signIn(page, "worker");
    await page.goto(`/maintenance/${id}`);
    await expect(page.getByText(/This request isn.t available/)).toBeVisible();
    await page.getByRole("button", { name: "Go to My jobs" }).click();
    await expect(page.getByRole("heading", { name: "My jobs" })).toBeVisible();
  });
});
