/**
 * The demo world seeds PropertyDocuments and MaintenanceRequestPhotos rows only.
 * Staging puts a sample file at each row's storage path (scripts/staging/seed.ts);
 * this does the same on the local emulator, so `pnpm dev:local` shows the demo
 * photos and documents instead of placeholders.
 */
import {
  statelessClient,
  uploadDemoDocuments,
  uploadDemoPhotos,
  type UploadResult,
} from "../../scripts/staging/supabase";
import { SERVICE_ROLE_KEY } from "./jwt";
import type { DemoWorld } from "./seed";

/** Upload the sample PDFs and PNGs for `demo` to the emulator at `url`, as the service role. */
export async function uploadDemoFiles(url: string, demo: DemoWorld): Promise<UploadResult[]> {
  const admin = statelessClient(url, SERVICE_ROLE_KEY);
  const documents = await uploadDemoDocuments(admin, demo.documents);
  const photos = await uploadDemoPhotos(admin, demo.photos);
  return [...documents, ...photos];
}
