/**
 * Sample images for the demo world's MaintenanceRequestPhotos rows.
 *
 * The seed (./seed.ts) only inserts rows; each row's `storage_path` is
 * `{request_id}/{file}`. The images for those files are committed in
 * ./demo-photos/ (small flat drawings, a few KB each, not real photographs).
 * `pnpm dev:local` puts them into the emulator's storage and the staging reset
 * uploads them, so the request page's photo card and lightbox have something
 * to show.
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DEMO_PHOTO_DIR = fileURLToPath(new URL("./demo-photos/", import.meta.url));

/** The committed image for a demo photo row, by its storage path; null when none is committed. */
export function demoPhotoBytes(storagePath: string): Uint8Array | null {
  const file = storagePath.split("/").pop() ?? "";
  if (!/^[a-z0-9-]+\.png$/.test(file)) return null;
  const path = `${DEMO_PHOTO_DIR}${file}`;
  return existsSync(path) ? new Uint8Array(readFileSync(path)) : null;
}
