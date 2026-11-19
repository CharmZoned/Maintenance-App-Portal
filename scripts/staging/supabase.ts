/**
 * Supabase HTTP side of the staging reset: creating the demo logins through
 * the Auth admin API, emptying storage buckets, and the sign-in check that
 * runs after seeding. Database work is in ./database.ts.
 */
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

/**
 * Remove every object from every storage bucket through the Storage API. The
 * buckets themselves stay. Problems are reported, not thrown: leftover files
 * are unreachable once the rows that pointed at them are gone.
 */
export async function emptyStorageBuckets(admin: SupabaseClient): Promise<BucketResult[]> {
  const { data: buckets, error } = await admin.storage.listBuckets();
  if (error || !buckets) {
    return [{ bucket: "(all)", emptied: false, detail: error?.message ?? "could not list buckets" }];
  }
  const results: BucketResult[] = [];
  for (const bucket of buckets) {
    const { data, error: emptyError } = await admin.storage.emptyBucket(bucket.id);
    results.push({
      bucket: bucket.id,
      emptied: !emptyError,
      detail: emptyError ? emptyError.message : (data?.message ?? "emptied"),
    });
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
