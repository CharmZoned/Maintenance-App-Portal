/**
 * A small Supabase Storage: upload, signed URLs, download and remove.
 *
 * Object rows go into storage.objects as the caller's role, so the project's
 * storage RLS policies decide who may upload, read and delete. File bytes are
 * kept in memory.
 */
import { randomUUID } from "node:crypto";
import type { DbRole, EmulatorDb, PgError } from "./db";
import { signJwt, verifyJwt, type JwtClaims } from "./jwt";

export interface StorageResponse {
  status: number;
  body: unknown;
  raw?: { bytes: Uint8Array; contentType: string };
}

interface Bucket {
  id: string;
  public: boolean;
  file_size_limit: number | null;
  allowed_mime_types: string[] | null;
}

function fail(status: number, error: string, message: string): StorageResponse {
  return { status, body: { statusCode: String(status), error, message } };
}

export class StorageApi {
  private blobs = new Map<string, { bytes: Uint8Array; contentType: string }>();

  constructor(private readonly db: EmulatorDb) {}

  reset(): void {
    this.blobs.clear();
  }

  private async bucket(id: string): Promise<Bucket | null> {
    const rows = await this.db.admin<Bucket>(
      `select id, public, file_size_limit::float8 as file_size_limit, allowed_mime_types from storage.buckets where id = $1`,
      [id],
    );
    return rows[0] ?? null;
  }

  private async visible(role: DbRole, claims: JwtClaims, bucket: string, name: string): Promise<boolean> {
    const res = await this.db.asRole(role, claims, (tx) =>
      tx.query(`select 1 from storage.objects where bucket_id = $1 and name = $2`, [bucket, name]),
    );
    return res.rows.length > 0;
  }

  async handle(req: {
    method: string;
    path: string; // after /storage/v1
    params: URLSearchParams;
    request: Request;
    role: DbRole;
    claims: JwtClaims;
  }): Promise<StorageResponse> {
    const seg = req.path.split("/").filter(Boolean).map(decodeURIComponent);
    if (seg[0] !== "object") return fail(404, "not_found", `Storage route not supported by the test emulator: ${req.path}`);

    try {
      // POST /object/sign/:bucket  { paths, expiresIn } → batch signed URLs
      // POST /object/sign/:bucket/*path → single signed URL
      if (req.method === "POST" && seg[1] === "sign") {
        const [bucketId, ...rest] = seg.slice(2);
        const body = (await req.request.json().catch(() => ({}))) as {
          expiresIn?: number;
          paths?: string[];
        };
        const expiresIn = body.expiresIn ?? 60;

        // Batch (supabase-js createSignedUrls): no object path in the URL.
        if (rest.length === 0 && Array.isArray(body.paths)) {
          const out: Array<{
            error: string | null;
            path: string;
            signedURL: string | null;
          }> = [];
          for (const name of body.paths) {
            if (!(await this.visible(req.role, req.claims, bucketId, name))) {
              out.push({ error: "Object not found", path: name, signedURL: null });
              continue;
            }
            const token = signJwt({
              url: `${bucketId}/${name}`,
              exp: Math.floor(Date.now() / 1000) + expiresIn,
            });
            const encoded = [bucketId, ...name.split("/")].map(encodeURIComponent).join("/");
            out.push({
              error: null,
              path: name,
              signedURL: `/object/sign/${encoded}?token=${token}`,
            });
          }
          return { status: 200, body: out };
        }

        const name = rest.join("/");
        if (!(await this.visible(req.role, req.claims, bucketId, name))) {
          return fail(400, "not_found", "Object not found");
        }
        const token = signJwt({
          url: `${bucketId}/${name}`,
          exp: Math.floor(Date.now() / 1000) + expiresIn,
        });
        const encoded = [bucketId, ...rest].map(encodeURIComponent).join("/");
        return { status: 200, body: { signedURL: `/object/sign/${encoded}?token=${token}` } };
      }

      // GET /object/sign/:bucket/*path?token= → bytes
      if (req.method === "GET" && seg[1] === "sign") {
        const key = seg.slice(2).join("/");
        const v = verifyJwt(req.params.get("token") ?? "");
        if (!v.ok || v.claims.url !== key) return fail(400, "InvalidJWT", "Invalid or expired signed URL");
        const blob = this.blobs.get(key);
        if (!blob) return fail(404, "not_found", "Object not found");
        return { status: 200, body: null, raw: blob };
      }

      // GET /object/authenticated/:bucket/*path → bytes (RLS-checked)
      if (req.method === "GET" && seg[1] === "authenticated") {
        const [bucketId, ...rest] = seg.slice(2);
        const name = rest.join("/");
        const blob = this.blobs.get(`${bucketId}/${name}`);
        if (!blob || !(await this.visible(req.role, req.claims, bucketId, name))) {
          return fail(400, "not_found", "Object not found");
        }
        return { status: 200, body: null, raw: blob };
      }

      // DELETE /object/:bucket  { prefixes: [...] }
      if (req.method === "DELETE" && seg.length === 2) {
        const bucketId = seg[1];
        const body = (await req.request.json().catch(() => ({}))) as { prefixes?: string[] };
        const names = body.prefixes ?? [];
        const res = await this.db.asRole(req.role, req.claims, (tx) =>
          tx.query<{ name: string; bucket_id: string; id: string }>(
            `delete from storage.objects
              where bucket_id = $1 and name = any($2::text[])
              returning id, name, bucket_id`,
            [bucketId, `{${names.map((n) => `"${n.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`],
          ),
        );
        for (const row of res.rows) this.blobs.delete(`${row.bucket_id}/${row.name}`);
        return { status: 200, body: res.rows };
      }

      // POST|PUT /object/:bucket/*path → upload
      if ((req.method === "POST" || req.method === "PUT") && seg.length >= 3) {
        const [bucketId, ...rest] = seg.slice(1);
        const name = rest.join("/");
        const bucket = await this.bucket(bucketId);
        if (!bucket) return fail(404, "Bucket not found", "Bucket not found");

        let bytes: Uint8Array;
        let contentType = req.request.headers.get("content-type") ?? "application/octet-stream";
        if (contentType.startsWith("multipart/form-data")) {
          const form = await req.request.formData();
          const file = [...form.values()].find((v): v is File => typeof v !== "string");
          if (!file) return fail(400, "invalid_request", "No file in multipart body");
          bytes = new Uint8Array(await file.arrayBuffer());
          contentType = file.type || "application/octet-stream";
        } else {
          bytes = new Uint8Array(await req.request.arrayBuffer());
        }
        contentType = contentType.split(";")[0].trim();

        if (bucket.file_size_limit != null && bytes.byteLength > bucket.file_size_limit) {
          return fail(413, "Payload too large", "The object exceeded the maximum allowed size");
        }
        if (
          bucket.allowed_mime_types &&
          bucket.allowed_mime_types.length > 0 &&
          !bucket.allowed_mime_types.includes(contentType)
        ) {
          return fail(415, "invalid_mime_type", `mime type ${contentType} is not supported`);
        }

        const upsert = req.method === "PUT" || req.request.headers.get("x-upsert") === "true";
        const meta = JSON.stringify({ size: bytes.byteLength, mimetype: contentType });
        const id = randomUUID();
        // Like Supabase Storage: a plain upload needs only the INSERT policy (no
        // RETURNING, so SELECT is not consulted); an upsert also needs SELECT + UPDATE.
        const res = await this.db.asRole(req.role, req.claims, (tx) =>
          tx.query<{ id: string }>(
            `insert into storage.objects (id, bucket_id, name, owner, owner_id, metadata)
             values ($1, $2, $3, auth.uid(), auth.uid()::text, $4::jsonb)` +
              (upsert
                ? ` on conflict (bucket_id, name) do update set metadata = excluded.metadata, updated_at = now() returning id`
                : ``),
            [id, bucketId, name, meta],
          ),
        );
        const objectId = res.rows[0]?.id ?? id;
        this.blobs.set(`${bucketId}/${name}`, { bytes, contentType });
        return { status: 200, body: { Id: objectId, Key: `${bucketId}/${name}` } };
      }
    } catch (e) {
      const pg = e as PgError;
      if (pg.code === "42501") return fail(403, "Unauthorized", "new row violates row-level security policy");
      if (pg.code === "23505") return fail(409, "Duplicate", "The resource already exists");
      return fail(500, "internal", `Emulator failure: ${pg.message}`);
    }

    return fail(404, "not_found", `Storage route not supported by the test emulator: ${req.method} ${req.path}`);
  }
}
