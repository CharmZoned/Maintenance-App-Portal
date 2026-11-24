/**
 * `pnpm dev:local` — run the portal on your machine against the local Supabase
 * emulator, pre-loaded with the demo world. Nothing touches the live project,
 * and every restart begins from the same clean data.
 */
import { spawn } from "node:child_process";
import { DEV_APP_PORT, DEV_EMULATOR_PORT } from "../support/ports";
import { uploadDemoFiles } from "./demo-files";
import { ANON_KEY } from "./jwt";
import { PASSWORD, PERSONAS } from "./seed";
import { startEmulator } from "./server";

const emulator = await startEmulator({ port: DEV_EMULATOR_PORT });
const world = await emulator.reset({ seed: true, demo: true });
// The seed writes photo and document rows only; put a sample file behind each.
const uploads = world?.demo ? await uploadDemoFiles(emulator.url, world.demo) : [];
const failed = uploads.filter((u) => !u.ok);
for (const f of failed) console.warn(`  Could not upload demo file ${f.path}: ${f.detail}`);

console.log(`\nLocal backend ready (${emulator.db.migrations.length} migrations applied) at ${emulator.url}`);
console.log(`Demo files uploaded: ${uploads.length - failed.length} of ${uploads.length}`);
console.log(`\nDemo logins — password for all: ${PASSWORD}`);
for (const p of Object.values(PERSONAS)) console.log(`  ${p.email.padEnd(24)} ${p.label}`);
console.log(`\nEmails the app "sends" (sign-up / reset links): ${emulator.url}/__emulator/outbox\n`);

// Bind IPv4 explicitly — Chrome often resolves localhost to 127.0.0.1 first,
// and Vite's default (::1 only on some hosts) causes ERR_CONNECTION_REFUSED.
// Keep the emulator on 127.0.0.1 (see startEmulator) so unauthenticated
// /__emulator/* stays loopback-only — never bind it to 0.0.0.0.
const vite = spawn(
  "pnpm",
  ["exec", "vite", "--host", "127.0.0.1", "--port", String(DEV_APP_PORT), "--strictPort"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      VITE_SUPABASE_URL: emulator.url,
      VITE_SUPABASE_ANON_KEY: ANON_KEY,
      // Staging tools (quick sign-in + pink ribbon) — ADR-0006 / build plan 3.7.
      VITE_APP_ENV: "local",
      VITE_DEMO_PASSWORD: PASSWORD,
      VITE_BUILD_ID: "local",
    },
  },
);

const stop = () => {
  vite.kill();
  void emulator.close().finally(() => process.exit(0));
};
vite.on("exit", stop);
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
