/**
 * `pnpm dev:local` — run the portal on your machine against the local Supabase
 * emulator, pre-loaded with the demo world. Nothing touches the live project,
 * and every restart begins from the same clean data.
 */
import { spawn } from "node:child_process";
import { DEV_APP_PORT, DEV_EMULATOR_PORT } from "../support/ports";
import { ANON_KEY } from "./jwt";
import { PASSWORD, PERSONAS } from "./seed";
import { startEmulator } from "./server";

// Bind all interfaces so Cursor Cloud / Docker port-forward can reach the app
// (loopback-only listeners are not forwarded to the user's localhost).
const emulator = await startEmulator({ port: DEV_EMULATOR_PORT, host: "0.0.0.0" });
await emulator.reset({ seed: true });

console.log(`\nLocal backend ready (${emulator.db.migrations.length} migrations applied) at ${emulator.url}`);
console.log(`\nDemo logins — password for all: ${PASSWORD}`);
for (const p of Object.values(PERSONAS)) console.log(`  ${p.email.padEnd(24)} ${p.label}`);
console.log(`\nEmails the app "sends" (sign-up / reset links): ${emulator.url}/__emulator/outbox\n`);
console.log(`Open the portal at http://localhost:${DEV_APP_PORT}/ (maintenance: /maintenance)\n`);

const vite = spawn(
  "pnpm",
  ["exec", "vite", "--host", "0.0.0.0", "--port", String(DEV_APP_PORT), "--strictPort"],
  {
    stdio: "inherit",
    env: { ...process.env, VITE_SUPABASE_URL: emulator.url, VITE_SUPABASE_ANON_KEY: ANON_KEY },
  },
);

const stop = () => {
  vite.kill();
  void emulator.close().finally(() => process.exit(0));
};
vite.on("exit", stop);
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
