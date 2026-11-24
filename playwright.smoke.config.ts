import { defineConfig } from "@playwright/test";
import { ANON_KEY } from "./tests/emulator/jwt";
import { PASSWORD } from "./tests/emulator/seed";
import { SMOKE_APP_PORT, SMOKE_APP_URL, SMOKE_EMULATOR_PORT, SMOKE_EMULATOR_URL } from "./tests/support/ports";

/**
 * Smoke tests: sign in with the staging quick sign-in buttons and open every
 * role's main screens, read-only (tests/smoke/).
 *
 *   pnpm test:smoke                                   local emulator + a `VITE_APP_ENV=local` build
 *   SMOKE_BASE_URL=https://<staging> pnpm test:smoke  a deployed staging site; nothing is started
 *
 * Against a deployed site, VERCEL_AUTOMATION_BYPASS_SECRET (when set) gets the
 * browser past Vercel Authentication; see tests/smoke/support.ts.
 */
const SMOKE_DIST = "tests/.results/smoke-dist";
const remote = process.env.SMOKE_BASE_URL?.trim().replace(/\/+$/, "") || undefined;

export default defineConfig({
  testDir: "tests/smoke",
  outputDir: "tests/.results/playwright-smoke",
  fullyParallel: false,
  workers: 1,
  // A deployed site is further away than the emulator; allow for a cold start.
  timeout: remote ? 90_000 : 60_000,
  expect: { timeout: remote ? 15_000 : 8_000 },
  retries: remote ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["github"]] : [["list"]],
  use: {
    baseURL: remote ?? SMOKE_APP_URL,
    viewport: { width: 1280, height: 860 },
    trace: "off",
    screenshot: "only-on-failure",
  },
  webServer: remote
    ? undefined
    : [
        {
          command: `pnpm exec tsx tests/emulator/cli.ts --port ${SMOKE_EMULATOR_PORT} --seed --demo`,
          url: `${SMOKE_EMULATOR_URL}/__emulator/health`,
          reuseExistingServer: false,
          timeout: 60_000,
        },
        {
          // A built bundle, like the deployed site, so the landing-time check measures the app and not
          // the dev server compiling modules on first use. Own outDir: never touches dist/.
          command:
            `pnpm exec vite build --outDir ${SMOKE_DIST} --emptyOutDir --logLevel warn && ` +
            `pnpm exec vite preview --outDir ${SMOKE_DIST} --port ${SMOKE_APP_PORT} --strictPort --host 127.0.0.1`,
          url: SMOKE_APP_URL,
          reuseExistingServer: false,
          timeout: 180_000,
          // Same build settings as `pnpm dev:local`: staging tools on, demo password from the seed.
          env: {
            VITE_SUPABASE_URL: SMOKE_EMULATOR_URL,
            VITE_SUPABASE_ANON_KEY: ANON_KEY,
            VITE_APP_ENV: "local",
            VITE_DEMO_PASSWORD: PASSWORD,
            VITE_BUILD_ID: "smoke",
          },
        },
      ],
});
