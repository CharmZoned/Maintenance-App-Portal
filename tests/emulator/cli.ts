/**
 * Run the Supabase emulator as a standalone process.
 *
 *   tsx tests/emulator/cli.ts --port 54332          (used by the browser tests)
 *   tsx tests/emulator/cli.ts --port 54330 --seed   (used by `pnpm dev:local`)
 */
import { PASSWORD, PERSONAS } from "./seed";
import { startEmulator } from "./server";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};

const emulator = await startEmulator({ port: Number(value("port") ?? 54330) });
if (flag("seed")) await emulator.reset({ seed: true });

console.log(`\nSupabase emulator ready at ${emulator.url}`);
console.log(`  ${emulator.db.migrations.length} migrations applied (baseline + supabase/migrations)`);
if (flag("seed")) {
  console.log(`\n  Demo logins (password: ${PASSWORD})`);
  for (const p of Object.values(PERSONAS)) console.log(`    ${p.email.padEnd(24)} ${p.label}`);
}
console.log("");

const stop = () => {
  void emulator.close().finally(() => process.exit(0));
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
