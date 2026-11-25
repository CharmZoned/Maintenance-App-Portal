/**
 * Staging reset and stored files (review must-fix on the Phase 2 pull request).
 *
 * Uploaded photos belong to logins. Deleting auth.users while files are still
 * stored left a later reset unable to finish, so the reset now empties storage
 * first and the database wipe refuses while any file remains. These checks run
 * the real wipe (scripts/staging/database.ts) on a fresh PGlite database with
 * every migration applied and the demo world seeded - not on the shared
 * emulator, so nothing here disturbs other test files.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { resetDatabase, type Queryable } from "../../scripts/staging/database";
import { emptyStorageBuckets, uploadDemoFiles, type StorageAdmin, type StorageUploader } from "../../scripts/staging/supabase";
import { DEMO_FILE_SOURCES, demoStorageFiles, type DemoStorageFile } from "../emulator/demo-files";
import { EmulatorDb } from "../emulator/db";
import { seedWorld, type SeedAuth, type World } from "../emulator/seed";

let db: EmulatorDb;

/** The wipe's view of the database. */
const client: Queryable = {
  async query(sql, values) {
    const rows = await db.admin(sql, values ?? []);
    return { rows, rowCount: rows.length };
  },
};

/** Creates logins the way Auth does: a row in auth.users, which fires on_auth_user_created. */
const auth: SeedAuth = {
  async createUser({ email }) {
    const [row] = await db.admin<{ id: string }>(
      `insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id`,
      [email],
    );
    return { id: row.id, email };
  },
};

const count = async (sql: string) => (await db.admin<{ n: number }>(sql))[0].n;

/** What the Storage API leaves behind after a worker uploads a photo: an object owned by their login. */
async function uploadPhotos(world: World): Promise<void> {
  for (const photo of world.demo?.photos ?? []) {
    const [{ uploaded_by_user_id: owner }] = await db.admin<{ uploaded_by_user_id: string }>(
      `select uploaded_by_user_id from public."MaintenanceRequestPhotos" where id = $1`,
      [photo.id],
    );
    await db.admin(
      `insert into storage.objects (bucket_id, name, owner, owner_id) values ('maintenance-photos', $1, $2, $3)`,
      [photo.storage_path, owner, owner],
    );
  }
}

/** The Storage API's emptyBucket, on the emulator's tables. */
const emptyAllBuckets = () => db.admin(`delete from storage.objects`);

beforeAll(async () => {
  db = await EmulatorDb.create();
});

afterAll(async () => {
  await db.close();
});

describe("staging reset: storage is emptied before the logins are deleted", () => {
  test("the demo world seeds job photos, including a worker's completion photo", async () => {
    const world = await seedWorld(db, auth, { demo: true });
    const photos = world.demo?.photos ?? [];
    expect(photos.length).toBeGreaterThanOrEqual(3);
    expect(photos.some((p) => p.request === "closed" && p.uploaded_by_role === "maintenance")).toBe(true);
    for (const photo of photos) expect(photo.storage_path).toMatch(/^[0-9]+\/[^/]+\.png$/);
    expect(await count(`select count(*)::int as n from public."MaintenanceRequestPhotos"`)).toBe(photos.length);
  });

  test("the wipe refuses while files are stored, and changes nothing", async () => {
    await resetBetweenTests();
    const world = await seedWorld(db, auth, { demo: true });
    await uploadPhotos(world);
    const users = await count(`select count(*)::int as n from auth.users`);
    const requests = await count(`select count(*)::int as n from public."MaintenanceRequests"`);

    await expect(resetDatabase(client)).rejects.toThrow(/storage still holds \d+ file\(s\)/);

    expect(await count(`select count(*)::int as n from auth.users`)).toBe(users);
    expect(await count(`select count(*)::int as n from public."MaintenanceRequests"`)).toBe(requests);
  });

  test("with storage emptied first, a reset after photo uploads succeeds, twice in a row", async () => {
    for (let round = 1; round <= 2; round++) {
      expect(await count(`select count(*)::int as n from auth.users`), `round ${round}: logins to delete`).toBeGreaterThan(0);
      await emptyAllBuckets();
      await resetDatabase(client);
      expect(await count(`select count(*)::int as n from auth.users`)).toBe(0);

      const world = await seedWorld(db, auth, { demo: true });
      await uploadPhotos(world);
      expect(await count(`select count(*)::int as n from storage.objects`)).toBe(world.demo!.photos.length);
    }
  });
});

/** Back to an empty database between tests that seed. */
async function resetBetweenTests(): Promise<void> {
  await emptyAllBuckets();
  await resetDatabase(client);
}

describe("emptyStorageBuckets", () => {
  /** A fake Storage API whose buckets empty `perCall` objects per emptyBucket call. */
  function fakeStorage(files: Record<string, number>, perCall: number, failOn?: string): StorageAdmin {
    return {
      async listBuckets() {
        return { data: Object.keys(files).map((id) => ({ id })), error: null };
      },
      async emptyBucket(id) {
        if (id === failOn) return { data: null, error: { message: "permission denied" } };
        files[id] = Math.max(0, files[id] - perCall);
        return { data: { message: "Successfully emptied" }, error: null };
      },
      from(id) {
        return {
          async list() {
            return { data: files[id] > 0 ? [{ name: "x" }] : [], error: null };
          },
        };
      },
    };
  }

  test("keeps emptying a large bucket until listing it comes back empty", async () => {
    const files = { "maintenance-photos": 2500, "property-documents": 0 };
    const results = await emptyStorageBuckets(fakeStorage(files, 1000));
    expect(results).toEqual([
      { bucket: "maintenance-photos", emptied: true, detail: "emptied" },
      { bucket: "property-documents", emptied: true, detail: "emptied" },
    ]);
    expect(files["maintenance-photos"]).toBe(0);
  });

  test("reports a bucket that will not empty, so the reset stops before the wipe", async () => {
    const results = await emptyStorageBuckets(fakeStorage({ a: 10_000, b: 1 }, 1000, "b"));
    expect(results).toEqual([
      { bucket: "a", emptied: false, detail: "still has files" },
      { bucket: "b", emptied: false, detail: "permission denied" },
    ]);
  });
});

describe("demo files: every seeded storage path has a committed file", () => {
  /** Magic bytes per content type the demo files use. */
  const MAGIC: Record<string, string> = { "image/png": "89504e470d0a1a0a", "application/pdf": "255044462d" };

  test("each row with a storage_path, in any table, maps to a committed file the bucket accepts", async () => {
    await resetBetweenTests();
    const world = await seedWorld(db, auth, { demo: true });
    const files = demoStorageFiles(world.demo!);

    // Every table with a storage_path column, so a newly seeded kind of file cannot be missed.
    const tables = await db.admin<{ table_name: string }>(
      `select table_name from information_schema.columns
        where table_schema = 'public' and column_name = 'storage_path' order by table_name`,
    );
    expect(tables.map((t) => t.table_name)).toEqual(expect.arrayContaining(Object.keys(DEMO_FILE_SOURCES)));
    const seeded: string[] = [];
    for (const { table_name } of tables) {
      const rows = await db.admin<{ storage_path: string }>(`select storage_path from public."${table_name}"`);
      seeded.push(...rows.map((r) => `${table_name}:${r.storage_path}`));
    }
    expect(seeded.length).toBe(14); // 9 job photos + 5 property documents
    expect(files.map((f) => `${f.table}:${f.path}`).sort()).toEqual(seeded.sort());

    // Each file fits its bucket: right bucket, an allowed type, under the size limit, and really that type.
    const buckets = await db.admin<{ id: string; file_size_limit: number | null; allowed_mime_types: string[] | null }>(
      `select id, file_size_limit::float8 as file_size_limit, allowed_mime_types from storage.buckets`,
    );
    for (const file of files) {
      expect(file.bucket).toBe(DEMO_FILE_SOURCES[file.table].bucket);
      const bucket = buckets.find((b) => b.id === file.bucket);
      expect(bucket, file.bucket).toBeDefined();
      if (bucket!.allowed_mime_types) expect(bucket!.allowed_mime_types).toContain(file.contentType);
      if (bucket!.file_size_limit != null) expect(file.bytes.byteLength).toBeLessThanOrEqual(bucket!.file_size_limit);
      expect(file.bytes.byteLength, `${file.path} stays small`).toBeLessThan(16 * 1024);
      const magic = MAGIC[file.contentType];
      expect(magic, `a known type for ${file.path}`).toBeDefined();
      expect(Buffer.from(file.bytes.subarray(0, magic.length / 2)).toString("hex")).toBe(magic);
    }
  });

  test("a row without a committed file is an error that names it", () => {
    const photo = { id: 1, request: "closed" as const, storage_path: "7/not-committed.png", content_type: "image/png" as const, caption: "", uploaded_by_role: "tenant" as const };
    expect(() => demoStorageFiles({ photos: [photo], documents: [] })).toThrow(
      /maintenance-photos\/7\/not-committed\.png \(expected tests\/emulator\/demo-photos\/not-committed\.png\)/,
    );
  });
});

describe("uploadDemoFiles", () => {
  /** A fake Storage API that keeps uploads in memory; `breakOn` makes one path misbehave. */
  function fakeStorage(breakOn?: { path: string; how: "upload" | "download" | "corrupt" }) {
    const stored = new Map<string, { bytes: Uint8Array; contentType: string; upsert: boolean }>();
    const storage: StorageUploader = {
      from(bucket) {
        return {
          async upload(path, body, options) {
            if (breakOn?.path === path && breakOn.how === "upload") return { error: { message: "mime type not supported" } };
            const bytes = breakOn?.path === path && breakOn.how === "corrupt" ? body.subarray(1) : body;
            stored.set(`${bucket}/${path}`, { bytes, ...options });
            return { error: null };
          },
          async download(path) {
            const object = stored.get(`${bucket}/${path}`);
            if (!object || (breakOn?.path === path && breakOn.how === "download")) return { data: null, error: { message: "Object not found" } };
            return { data: new Blob([Uint8Array.from(object.bytes)]), error: null };
          },
        };
      },
    };
    return { storage, stored };
  }

  const file = (table: DemoStorageFile["table"], path: string, contentType: string, text: string): DemoStorageFile => ({
    table,
    rowId: 1,
    bucket: DEMO_FILE_SOURCES[table].bucket,
    path,
    contentType,
    bytes: new TextEncoder().encode(text),
  });
  const files = [
    file("MaintenanceRequestPhotos", "12/demo-faucet-drip.png", "image/png", "png bytes"),
    file("PropertyDocuments", "3/demo-lease-unit-1a.pdf", "application/pdf", "%PDF bytes"),
  ];

  test("puts each file at its bucket and path with its content type, and verifies it", async () => {
    const { storage, stored } = fakeStorage();
    const results = await uploadDemoFiles(storage, files);
    expect(results).toEqual([
      { bucket: "maintenance-photos", path: "12/demo-faucet-drip.png", ok: true, detail: "uploaded and verified" },
      { bucket: "property-documents", path: "3/demo-lease-unit-1a.pdf", ok: true, detail: "uploaded and verified" },
    ]);
    expect([...stored.keys()]).toEqual(["maintenance-photos/12/demo-faucet-drip.png", "property-documents/3/demo-lease-unit-1a.pdf"]);
    expect(stored.get("property-documents/3/demo-lease-unit-1a.pdf")).toEqual({
      bytes: files[1].bytes,
      contentType: "application/pdf",
      upsert: true,
    });
  });

  test.each([
    ["upload", "upload failed: mime type not supported"],
    ["download", "uploaded, but reading it back failed: Object not found"],
    ["corrupt", "uploaded, but the stored file differs (9 bytes, expected 10)"],
  ] as const)("reports a file whose %s step fails, and still handles the others", async (how, detail) => {
    const { storage } = fakeStorage({ path: "3/demo-lease-unit-1a.pdf", how });
    const results = await uploadDemoFiles(storage, files);
    expect(results.map((r) => r.ok)).toEqual([true, false]);
    expect(results[1].detail).toBe(detail);
  });
});
