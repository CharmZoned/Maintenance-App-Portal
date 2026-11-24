/**
 * Supabase HTTP side of the staging reset: creating the demo logins through
 * the Auth admin API, emptying storage buckets, uploading the demo files, and
 * the sign-in check that runs after seeding. Database work is in ./database.ts.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { PERSONAS, type PersonaKey, type SeedAuth } from "../../tests/emulator/seed";
import type { DemoStorageFile } from "../../tests/emulator/demo-files";

const NO_SESSION = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

/** A stateless client: nothing is stored, nothing refreshes in the background. */
export function statelessClient(apiUrl: string, key: string): SupabaseClient {
  return createClient(apiUrl, key, NO_SESSION);
}

/**
 * `SeedAuth` over the Auth admin API (service-role key). Users are created
 * through Auth itself, so the password is hashed there and the project's
 * `on_auth_user_created` trigger runs as it does for a real sign-up.
 */
export function seedAuthOver(admin: SupabaseClient): SeedAuth {
  return {
    async createUser({ email, password, confirmed }) {
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: confirmed });
      if (error || !data.user) {
        throw new Error(`Could not create the login ${email}: ${error?.message ?? "no user returned"}`);
      }
      return { id: data.user.id, email: data.user.email ?? email };
    },
  };
}

/** Prove the key can use the Auth admin API, before anything is wiped. Read-only. */
export async function assertAdminAccess(admin: SupabaseClient): Promise<void> {
  const { error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
  if (error) {
    throw new Error(
      `STAGING_SERVICE_ROLE_KEY was not accepted by the Auth admin API (${error.message}). ` +
        "It must be the service_role (or secret) key of the staging project, not the anon/publishable key.",
    );
  }
}

export interface BucketResult {
  bucket: string;
  emptied: boolean;
  detail: string;
}

/** The slice of the Storage API `emptyStorageBuckets` uses; lets tests supply a fake. */
export interface StorageAdmin {
  listBuckets(): Promise<{ data: Array<{ id: string }> | null; error: { message: string } | null }>;
  emptyBucket(id: string): Promise<{ data: { message?: string } | null; error: { message: string } | null }>;
  from(id: string): {
    list(path?: string, options?: { limit?: number }): Promise<{ data: unknown[] | null; error: { message: string } | null }>;
  };
}

/** How many times a bucket is emptied before giving up: the API removes large buckets in batches. */
const EMPTY_ATTEMPTS = 5;

/**
 * Remove every object from every storage bucket through the Storage API. The
 * buckets themselves stay. A bucket counts as emptied only once listing it
 * comes back empty. Problems are reported, not thrown; the reset refuses to
 * touch the database unless every bucket is emptied, because the logins those
 * files belong to are deleted next.
 */
export async function emptyStorageBuckets(admin: SupabaseClient | StorageAdmin): Promise<BucketResult[]> {
  const storage = (admin as SupabaseClient).storage ?? (admin as StorageAdmin);
  const { data: buckets, error } = await storage.listBuckets();
  if (error || !buckets) {
    return [{ bucket: "(all)", emptied: false, detail: error?.message ?? "could not list buckets" }];
  }
  const results: BucketResult[] = [];
  for (const bucket of buckets) {
    let detail = "still has files";
    let emptied = false;
    for (let attempt = 1; attempt <= EMPTY_ATTEMPTS && !emptied; attempt++) {
      const { error: emptyError } = await storage.emptyBucket(bucket.id);
      if (emptyError) {
        detail = emptyError.message;
        break;
      }
      const { data: left, error: listError } = await storage.from(bucket.id).list("", { limit: 1 });
      if (listError) {
        detail = `could not check it is empty: ${listError.message}`;
        break;
      }
      emptied = (left ?? []).length === 0;
    }
    results.push({ bucket: bucket.id, emptied, detail: emptied ? "emptied" : detail });
  }
  return results;
}

export interface UploadResult {
  bucket: string;
  path: string;
  ok: boolean;
  detail: string;
}

/** The slice of the Storage API `uploadDemoFiles` uses; lets tests supply a fake. */
export interface StorageUploader {
  from(bucket: string): {
    upload(
      path: string,
      body: Uint8Array,
      options: { contentType: string; upsert: boolean },
    ): Promise<{ error: { message: string } | null }>;
    download(path: string): Promise<{ data: Blob | null; error: { message: string } | null }>;
  };
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.byteLength === b.byteLength && a.every((byte, index) => byte === b[index]);
}

/**
 * Put each demo file (tests/emulator/demo-files.ts) at its bucket and path,
 * then read every one back and compare the bytes, so a file counts as done
 * only once Storage actually serves it. Problems are reported per file, not
 * thrown; the caller fails the reset if any result is not ok.
 */
export async function uploadDemoFiles(
  admin: SupabaseClient | StorageUploader,
  files: readonly DemoStorageFile[],
): Promise<UploadResult[]> {
  const storage = ((admin as SupabaseClient).storage ?? admin) as StorageUploader;
  const results: UploadResult[] = [];
  for (const file of files) {
    const bucket = storage.from(file.bucket);
    const result = { bucket: file.bucket, path: file.path, ok: false, detail: "" };
    results.push(result);

    const { error } = await bucket.upload(file.path, file.bytes, { contentType: file.contentType, upsert: true });
    if (error) {
      result.detail = `upload failed: ${error.message}`;
      continue;
    }
    const { data, error: readError } = await bucket.download(file.path);
    if (readError || !data) {
      result.detail = `uploaded, but reading it back failed: ${readError?.message ?? "no data"}`;
      continue;
    }
    const stored = new Uint8Array(await data.arrayBuffer());
    if (!sameBytes(stored, file.bytes)) {
      result.detail = `uploaded, but the stored file differs (${stored.byteLength} bytes, expected ${file.bytes.byteLength})`;
      continue;
    }
    result.ok = true;
    result.detail = "uploaded and verified";
  }
  return results;
}

/** The four personas behind the quick sign-in buttons, with the role each token must carry. */
export const PRIMARY_PERSONAS: ReadonlyArray<{ key: PersonaKey; role: string }> = [
  { key: "admin", role: "admin" },
  { key: "landlord", role: "landlord" },
  { key: "tenant", role: "tenant" },
  { key: "worker", role: "maintenance" },
];

export interface SignInResult {
  persona: PersonaKey;
  email: string;
  ok: boolean;
  detail: string;
}

function claimsOf(accessToken: string): Record<string, unknown> | null {
  try {
    return JSON.parse(Buffer.from(accessToken.split(".")[1] ?? "", "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

/**
 * Sign in as each primary persona the way the portal does (password grant with
 * the publishable key) and check the access token carries the expected
 * `user_role`, which is what the portal and every RLS policy rely on.
 */
export async function verifySignIns(apiUrl: string, anonKey: string, password: string): Promise<SignInResult[]> {
  const results: SignInResult[] = [];
  for (const { key, role } of PRIMARY_PERSONAS) {
    const email = PERSONAS[key].email;
    const client = statelessClient(apiUrl, anonKey);
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error || !data.session) {
      results.push({ persona: key, email, ok: false, detail: `sign-in failed: ${error?.message ?? "no session"}` });
      continue;
    }
    const actual = claimsOf(data.session.access_token)?.user_role;
    if (actual === role) {
      results.push({ persona: key, email, ok: true, detail: `signed in, user_role=${role}` });
    } else if (actual === undefined) {
      results.push({
        persona: key,
        email,
        ok: false,
        detail: "signed in, but the token has no user_role: the custom access token hook is not enabled on this project",
      });
    } else {
      results.push({
        persona: key,
        email,
        ok: false,
        detail: `signed in, but user_role is ${JSON.stringify(actual)} (expected "${role}")`,
      });
    }
  }
  return results;
}
