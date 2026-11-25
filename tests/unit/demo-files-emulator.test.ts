/**
 * `pnpm dev:local` serves the same demo files the staging reset uploads
 * (tests/emulator/demo-files.ts): after a demo reset, each seeded photo and
 * document downloads from the emulator's storage with its committed bytes.
 */
import { afterAll, expect, test } from "vitest";
import { EMULATOR_URL } from "../support/ports";
import { resetWorld, serviceClient } from "../support/harness";
import { demoStorageFiles } from "../emulator/demo-files";
import type { World } from "../emulator/seed";

afterAll(async () => {
  await resetWorld();
});

test("a demo reset stores every seeded photo and document with its committed bytes", async () => {
  const res = await fetch(`${EMULATOR_URL}/__emulator/reset`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ seed: true, demo: true }),
  });
  expect(res.ok).toBe(true);
  const { world } = (await res.json()) as { world: World };
  const files = demoStorageFiles(world.demo!);
  expect(new Set(files.map((f) => f.bucket))).toEqual(new Set(["maintenance-photos", "property-documents"]));

  const service = serviceClient();
  for (const file of files) {
    const { data, error } = await service.storage.from(file.bucket).createSignedUrl(file.path, 60);
    expect(error, `${file.bucket}/${file.path}`).toBeNull();
    const download = await fetch(new URL(data!.signedUrl, EMULATOR_URL));
    expect(download.status, `${file.bucket}/${file.path}`).toBe(200);
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(file.bytes);
  }
});
