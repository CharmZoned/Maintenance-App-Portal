/**
 * Local ports used by the test tooling. Override with env vars if they clash.
 *
 *   54331  emulator for `pnpm test` (vitest)
 *   54332  emulator for browser tests (Playwright)
 *   54330  emulator for `pnpm dev:local` (manual poking around)
 *   5199   Vite dev server for browser tests
 *   5198   Vite dev server for `pnpm dev:local`
 *   4600   test dashboard
 */
const num = (name: string, fallback: number) => Number(process.env[name] ?? fallback);

export const EMULATOR_PORT = num("EMULATOR_PORT", 54331);
export const EMULATOR_URL = `http://127.0.0.1:${EMULATOR_PORT}`;

export const E2E_EMULATOR_PORT = num("E2E_EMULATOR_PORT", 54332);
export const E2E_EMULATOR_URL = `http://127.0.0.1:${E2E_EMULATOR_PORT}`;
export const E2E_APP_PORT = num("E2E_APP_PORT", 5199);
export const E2E_APP_URL = `http://127.0.0.1:${E2E_APP_PORT}`;

export const DEV_EMULATOR_PORT = num("DEV_EMULATOR_PORT", 54330);
export const DEV_APP_PORT = num("DEV_APP_PORT", 5198);

export const DASHBOARD_PORT = num("TEST_DASHBOARD_PORT", 4600);
