/**
 * Supabase HTTP side of the staging reset: creating the demo logins through
 * the Auth admin API, emptying storage buckets, and the sign-in check that
 * runs after seeding. Database work is in ./database.ts.
 */
import { deflateSync } from "node:zlib";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { PERSONAS, type DemoWorld, type PersonaKey, type SeedAuth } from "../../tests/emulator/seed";

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

/** The bucket `DemoWorld.documents[].storage_path` refers to. */
const DOCUMENTS_BUCKET = "property-documents";

/** A one-page PDF with a single heading: enough for a seeded document to open when downloaded. */
export function samplePdf(title: string): Uint8Array {
  const text = title.replace(/[^\x20-\x7e]/g, "?").replace(/([\\()])/g, "\\$1");
  const content =
    `BT /F1 18 Tf 72 720 Td (${text}) Tj ` +
    `/F1 11 Tf 0 -28 Td (Sample document for the staging demo. Not a real record.) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefAt = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

export interface UploadResult {
  path: string;
  ok: boolean;
  detail: string;
}

/**
 * The world definition seeds PropertyDocuments rows only. Put a small sample
 * file at each row's storage path so Download works on staging.
 */
export async function uploadDemoDocuments(
  admin: SupabaseClient,
  documents: DemoWorld["documents"],
): Promise<UploadResult[]> {
  const results: UploadResult[] = [];
  for (const doc of documents) {
    if (doc.content_type !== "application/pdf") {
      results.push({ path: doc.storage_path, ok: false, detail: `no sample file for ${doc.content_type}` });
      continue;
    }
    const { error } = await admin.storage
      .from(DOCUMENTS_BUCKET)
      .upload(doc.storage_path, samplePdf(doc.title), { contentType: doc.content_type, upsert: true });
    results.push({ path: doc.storage_path, ok: !error, detail: error ? error.message : "uploaded" });
  }
  return results;
}

/** The bucket `DemoWorld.photos[].storage_path` refers to. */
const PHOTOS_BUCKET = "maintenance-photos";

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/**
 * A small placeholder photo (PNG, 320x240): a diagonal two-tone gradient whose
 * colours come from `seed`, so each demo photo looks different. Not a real
 * picture - enough for the photo strips and the lightbox to show something.
 */
export function samplePng(seed: string, width = 320, height = 240): Uint8Array {
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const a = [64 + (hash & 0x7f), 64 + ((hash >>> 7) & 0x7f), 64 + ((hash >>> 14) & 0x7f)];
  const b = [255 - a[0] / 2, 255 - a[1] / 2, 255 - a[2] / 2];
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const t = (x / width + y / height) / 2;
      for (let c = 0; c < 3; c++) raw[row + 1 + x * 3 + c] = Math.round(a[c] * (1 - t) + b[c] * t);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", new Uint8Array()),
  ]);
}

/**
 * The world definition seeds MaintenanceRequestPhotos rows only. Put a
 * placeholder image at each row's storage path so the photos show on staging.
 */
export async function uploadDemoPhotos(admin: SupabaseClient, photos: DemoWorld["photos"]): Promise<UploadResult[]> {
  const results: UploadResult[] = [];
  for (const photo of photos) {
    const { error } = await admin.storage
      .from(PHOTOS_BUCKET)
      .upload(photo.storage_path, samplePng(photo.storage_path), { contentType: photo.content_type, upsert: true });
    results.push({ path: photo.storage_path, ok: !error, detail: error ? error.message : "uploaded" });
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
