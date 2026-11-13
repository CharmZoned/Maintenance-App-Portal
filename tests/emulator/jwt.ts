import { createHmac, timingSafeEqual } from "node:crypto";

/** Signing secret for the local emulator only. Never used against a real project. */
export const JWT_SECRET = "local-emulator-secret-not-for-production";

export type JwtClaims = Record<string, unknown> & {
  role?: string;
  sub?: string;
  exp?: number;
};

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

export function signJwt(claims: JwtClaims): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify(claims));
  const sig = createHmac("sha256", JWT_SECRET).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}

export type VerifyResult =
  | { ok: true; claims: JwtClaims }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" };

export function verifyJwt(token: string): VerifyResult {
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };
  const [header, payload, sig] = parts;
  const expected = createHmac("sha256", JWT_SECRET).update(`${header}.${payload}`).digest();
  let given: Buffer;
  try {
    given = Buffer.from(sig, "base64url");
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: "bad_signature" };
  }
  let claims: JwtClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as JwtClaims;
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (typeof claims.exp === "number" && claims.exp * 1000 < Date.now()) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, claims };
}

const FAR_FUTURE = 4102444800; // 2100-01-01

/** Stand-in for the project's publishable/anon key. */
export const ANON_KEY = signJwt({ iss: "supabase-emulator", role: "anon", iat: 0, exp: FAR_FUTURE });

/** Stand-in for the service-role key. Tests use it to seed fixtures; the app never does. */
export const SERVICE_ROLE_KEY = signJwt({
  iss: "supabase-emulator",
  role: "service_role",
  iat: 0,
  exp: FAR_FUTURE,
});
