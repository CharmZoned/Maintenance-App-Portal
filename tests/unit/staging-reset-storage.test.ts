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
import { emptyStorageBuckets, samplePng, type StorageAdmin } from "../../scripts/staging/supabase";
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

describe("samplePng", () => {
  test("is a PNG", () => {
    const png = Buffer.from(samplePng("1/demo.png"));
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(png.subarray(12, 16).toString("latin1")).toBe("IHDR");
    expect(png.readUInt32BE(16)).toBe(320);
  });
});
