import { defineConfig } from "@playwright/test";
import { ANON_KEY } from "./tests/emulator/jwt";
import { E2E_APP_PORT, E2E_APP_URL, E2E_EMULATOR_PORT, E2E_EMULATOR_URL } from "./tests/support/ports";

/**
 * Browser tests: the real portal UI in Chromium, backed by the local Supabase
 * emulator. Nothing here can reach the live project — the dev server is started
 * with VITE_SUPABASE_URL pointing at 127.0.0.1, and tests/e2e/support.ts aborts
 * any request to another host.
 */
export default defineConfig({
  testDir: "tests/e2e",
  outputDir: "tests/.results/playwright",
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  reporter: [["list"]],
  use: {
    baseURL: E2E_APP_URL,
    viewport: { width: 1280, height: 860 },
    trace: "off",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: `pnpm exec tsx tests/emulator/cli.ts --port ${E2E_EMULATOR_PORT}`,
      url: `${E2E_EMULATOR_URL}/__emulator/health`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `pnpm exec vite --port ${E2E_APP_PORT} --strictPort --host 127.0.0.1`,
      url: E2E_APP_URL,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { VITE_SUPABASE_URL: E2E_EMULATOR_URL, VITE_SUPABASE_ANON_KEY: ANON_KEY },
    },
  ],
});
