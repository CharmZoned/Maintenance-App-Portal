import { startEmulator, type Emulator } from "../emulator/server";
import { EMULATOR_PORT } from "./ports";

let emulator: Emulator | undefined;

export async function setup(): Promise<void> {
  emulator = await startEmulator({ port: EMULATOR_PORT, quiet: true });
}

export async function teardown(): Promise<void> {
  await emulator?.close();
}
