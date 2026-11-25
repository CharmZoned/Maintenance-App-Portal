/**
 * The files behind the demo world's storage rows, shared by `pnpm dev:local`
 * (the emulator's storage) and the staging reset (Supabase Storage), so both
 * serve the same bytes at the same paths.
 *
 * The seed (./seed.ts) only inserts rows. Every row it seeds with a
 * `storage_path` is listed in `DemoWorld`, and each one has a committed file,
 * looked up by the last segment of its path:
 *
 *   MaintenanceRequestPhotos  bucket maintenance-photos  ./demo-photos/     (PNG drawings, a few KB)
 *   PropertyDocuments         bucket property-documents  ./demo-documents/  (one-page PDFs, under 1 KB)
 *
 * None of them is a real photograph or record. A row without its file is an
 * error (`demoStorageFiles` throws), never a silently missing object.
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { DemoWorld } from "./seed";

/** A seeded table whose rows point at a stored file. Both carry `uploaded_by_user_id`. */
export type DemoFileTable = "MaintenanceRequestPhotos" | "PropertyDocuments";

/** Where each seeded table's files live: bucket and committed folder. */
export const DEMO_FILE_SOURCES: Record<DemoFileTable, { bucket: string; dir: string }> = {
  MaintenanceRequestPhotos: { bucket: "maintenance-photos", dir: "demo-photos" },
  PropertyDocuments: { bucket: "property-documents", dir: "demo-documents" },
};

/** One object to put into storage for a seeded row. */
export interface DemoStorageFile {
  table: DemoFileTable;
  rowId: number;
  bucket: string;
  path: string;
  contentType: string;
  bytes: Uint8Array;
}

/** The committed file for a storage path, from the table's folder; null when none is committed. */
export function committedDemoFile(table: DemoFileTable, storagePath: string): Uint8Array | null {
  const file = storagePath.split("/").pop() ?? "";
  if (!/^[a-z0-9-]+\.[a-z0-9]+$/.test(file)) return null;
  const path = fileURLToPath(new URL(`./${DEMO_FILE_SOURCES[table].dir}/${file}`, import.meta.url));
  return existsSync(path) ? new Uint8Array(readFileSync(path)) : null;
}

/**
 * Every object the demo world's rows expect, with its bytes. Throws, naming
 * each one, if any row has no committed file.
 */
export function demoStorageFiles(demo: Pick<DemoWorld, "photos" | "documents">): DemoStorageFile[] {
  const rows: Array<{ table: DemoFileTable; id: number; storage_path: string; content_type: string }> = [
    ...demo.photos.map((p) => ({ table: "MaintenanceRequestPhotos" as const, ...p })),
    ...demo.documents.map((d) => ({ table: "PropertyDocuments" as const, ...d })),
  ];
  const files: DemoStorageFile[] = [];
  const missing: string[] = [];
  for (const row of rows) {
    const { bucket, dir } = DEMO_FILE_SOURCES[row.table];
    const bytes = committedDemoFile(row.table, row.storage_path);
    if (!bytes) {
      missing.push(`${bucket}/${row.storage_path} (expected tests/emulator/${dir}/${row.storage_path.split("/").pop()})`);
      continue;
    }
    files.push({ table: row.table, rowId: row.id, bucket, path: row.storage_path, contentType: row.content_type, bytes });
  }
  if (missing.length > 0) {
    throw new Error(`No committed demo file for ${missing.length} seeded row(s): ${missing.join("; ")}`);
  }
  return files;
}
