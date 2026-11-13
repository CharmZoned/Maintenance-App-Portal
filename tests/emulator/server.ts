/**
 * Local Supabase emulator: one HTTP server exposing the three APIs the portal
 * talks to (/rest/v1, /auth/v1, /storage/v1) on top of an in-process Postgres
 * that carries the project's real schema, RLS policies and triggers.
 *
 * Extra /__emulator/* routes exist for tests only (reset, seed, SQL, outbox).
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { AuthApi } from "./auth";
import { EmulatorDb, type DbRole } from "./db";
import { ANON_KEY, SERVICE_ROLE_KEY, verifyJwt, type JwtClaims } from "./jwt";
import { RestApi } from "./rest";
import { seedWorld, type World } from "./seed";
import { StorageApi } from "./storage";

export interface Emulator {
  url: string;
  port: number;
  anonKey: string;
  serviceRoleKey: string;
  db: EmulatorDb;
  auth: AuthApi;
  /** Wipe all data; optionally load the standard test world. */
  reset(opts?: { seed?: boolean }): Promise<World | null>;
  close(): Promise<void>;
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS",
  "access-control-allow-headers": "*",
  "access-control-expose-headers": "*",
  "access-control-max-age": "86400",
};

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function send(
  res: ServerResponse,
  status: number,
  body: string | Uint8Array | null,
  headers: Record<string, string> = {},
): void {
  res.writeHead(status, { ...CORS, ...headers });
  res.end(body ?? undefined);
}

function sendJson(res: ServerResponse, status: number, payload: unknown, headers: Record<string, string> = {}): void {
  if (payload === null || payload === undefined) return send(res, status, null, headers);
  send(res, status, JSON.stringify(payload), { "content-type": "application/json; charset=utf-8", ...headers });
}

type Caller =
  | { ok: true; role: DbRole; claims: JwtClaims }
  | { ok: false; message: string };

/** Resolve the caller the way Supabase does: Bearer token, falling back to the apikey. */
function identify(headers: Headers): Caller {
  const bearer = headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const token = bearer || headers.get("apikey");
  if (!token) return { ok: false, message: "No API key found in request" };
  const v = verifyJwt(token);
  if (!v.ok) return { ok: false, message: v.reason === "expired" ? "JWT expired" : "Invalid JWT" };
  const role = v.claims.role;
  if (role !== "anon" && role !== "authenticated" && role !== "service_role") {
    return { ok: false, message: `Unknown role in JWT: ${String(role)}` };
  }
  return { ok: true, role, claims: v.claims };
}

export async function startEmulator(opts: { port?: number; quiet?: boolean } = {}): Promise<Emulator> {
  const db = await EmulatorDb.create();
  let url = "";
  const auth = new AuthApi(db, () => url);
  const rest = new RestApi(db);
  const storage = new StorageApi(db);

  const reset = async (o: { seed?: boolean } = {}): Promise<World | null> => {
    await db.reset();
    auth.reset();
    storage.reset();
    return o.seed ? seedWorld(db, auth) : null;
  };

  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const u = new URL(req.url ?? "/", url || "http://127.0.0.1");
    const method = (req.method ?? "GET").toUpperCase();
    if (method === "OPTIONS") return send(res, 204, null);

    const raw = await readBody(req);
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v === "string") headers.set(k, v);
      else if (Array.isArray(v)) headers.set(k, v.join(", "));
    }
    const jsonBody = (): unknown => {
      if (raw.length === 0) return null;
      try {
        return JSON.parse(raw.toString("utf8"));
      } catch {
        return null;
      }
    };

    // ── Test-only control plane ────────────────────────────────────
    if (u.pathname.startsWith("/__emulator/")) {
      const route = u.pathname.slice("/__emulator".length);
      if (route === "/health") {
        return sendJson(res, 200, { ok: true, migrations: db.migrations });
      }
      if (route === "/reset" && method === "POST") {
        const body = (jsonBody() ?? {}) as { seed?: boolean };
        return sendJson(res, 200, { world: await reset(body) });
      }
      if (route === "/sql" && method === "POST") {
        const body = jsonBody() as { query: string; params?: unknown[] };
        try {
          return sendJson(res, 200, { rows: await db.admin(body.query, body.params ?? []) });
        } catch (e) {
          const pg = e as { code?: string; message: string };
          return sendJson(res, 400, { code: pg.code ?? null, message: pg.message });
        }
      }
      if (route === "/outbox") {
        if (method === "DELETE") auth.outbox.length = 0;
        return sendJson(res, 200, { mail: auth.outbox });
      }
      if (route === "/config" && method === "POST") {
        const body = (jsonBody() ?? {}) as { autoconfirm?: boolean };
        if (typeof body.autoconfirm === "boolean") auth.autoconfirm = body.autoconfirm;
        return sendJson(res, 200, { autoconfirm: auth.autoconfirm });
      }
      return sendJson(res, 404, { message: "Unknown emulator route" });
    }

    // ── Auth ───────────────────────────────────────────────────────
    if (u.pathname.startsWith("/auth/v1/")) {
      const caller = identify(headers);
      const out = await auth.handle({
        method,
        path: u.pathname.slice("/auth/v1".length),
        params: u.searchParams,
        body: (jsonBody() ?? {}) as Record<string, unknown>,
        claims: caller.ok ? caller.claims : null,
      });
      return sendJson(res, out.status, out.body, out.headers);
    }

    // ── REST + Storage need a valid key/JWT ────────────────────────
    const caller = identify(headers);
    const isSignedDownload = method === "GET" && u.pathname.startsWith("/storage/v1/object/sign/");
    if (!caller.ok && !isSignedDownload) {
      return sendJson(res, 401, { code: "PGRST301", details: null, hint: null, message: caller.message });
    }
    const role: DbRole = caller.ok ? caller.role : "anon";
    const claims: JwtClaims = caller.ok ? caller.claims : { role: "anon" };

    if (u.pathname.startsWith("/rest/v1")) {
      const out = await rest.handle({
        method,
        path: u.pathname.slice("/rest/v1".length),
        params: u.searchParams,
        headers,
        body: jsonBody(),
        role,
        claims,
      });
      return send(res, out.status, out.body, {
        "content-type": "application/json; charset=utf-8",
        ...out.headers,
      });
    }

    if (u.pathname.startsWith("/storage/v1/")) {
      const request = new Request(u, {
        method,
        headers,
        body: method === "GET" || method === "HEAD" || raw.length === 0 ? undefined : new Uint8Array(raw),
      });
      const out = await storage.handle({
        method,
        path: u.pathname.slice("/storage/v1".length),
        params: u.searchParams,
        request,
        role,
        claims,
      });
      if (out.raw) return send(res, out.status, out.raw.bytes, { "content-type": out.raw.contentType });
      return sendJson(res, out.status, out.body);
    }

    return sendJson(res, 404, { message: `Not part of the emulator: ${u.pathname}` });
  };

  const server: Server = createServer((req, res) => {
    handler(req, res).catch((e: Error) => {
      if (!opts.quiet) console.error("[emulator] unhandled", e);
      if (!res.headersSent) sendJson(res, 500, { code: "EMU500", message: e.message });
      else res.end();
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : (opts.port ?? 0);
  url = `http://127.0.0.1:${port}`;

  return {
    url,
    port,
    anonKey: ANON_KEY,
    serviceRoleKey: SERVICE_ROLE_KEY,
    db,
    auth,
    reset,
    close: async () => {
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await db.close();
    },
  };
}
