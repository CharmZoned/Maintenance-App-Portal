import path from "node:path";
import { defineConfig } from "vitest/config";
import { ANON_KEY } from "./tests/emulator/jwt";
import { EMULATOR_URL } from "./tests/support/ports";

/**
 * Unit + requirement + workflow tests.
 * The suite talks to a local Supabase emulator (tests/emulator), never to the
 * live project. See tests/README.md.
 */
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src/client") },
  },
  test: {
    include: ["tests/{unit,requirements,workflows}/**/*.test.ts", "src/**/*.test.ts"],
    environment: "node",
    globalSetup: ["tests/support/global-setup.ts"],
    // One shared database → one test file at a time.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
    env: {
      VITE_SUPABASE_URL: EMULATOR_URL,
      VITE_SUPABASE_ANON_KEY: ANON_KEY,
    },
  },
});
