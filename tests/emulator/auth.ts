/**
 * A small GoTrue: the Supabase Auth endpoints the portal uses (sign up, sign in,
 * refresh, get/update user, sign out, password recovery, email verification),
 * plus the service-role admin API used by test fixtures.
 *
 * Users live in auth.users inside the emulator database, so the project's own
 * `on_auth_user_created` trigger and `custom_access_token_hook` run for real.
 */
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import type { EmulatorDb, PgError } from "./db";
import { signJwt, type JwtClaims } from "./jwt";

export interface AuthResponse {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

export interface Mail {
  to: string;
  type: "signup" | "recovery";
  link: string;
  sent_at: string;
}

interface UserRow {
  id: string;
  aud: string;
  role: string;
  email: string;
  encrypted_password: string | null;
  email_confirmed_at: string | null;
  last_sign_in_at: string | null;
  raw_app_meta_data: Record<string, unknown>;
  raw_user_meta_data: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

const ACCESS_TOKEN_TTL = 3600;

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${scryptSync(password, salt, 32).toString("hex")}`;
}

function checkPassword(password: string, stored: string | null): boolean {
  if (!stored) return false;
  const [saltHex, hashHex] = stored.split(":");
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(actual, expected);
}

function err(status: number, error_code: string, msg: string): AuthResponse {
  return { status, body: { code: status, error_code, msg } };
}

function publicUser(u: UserRow) {
  return {
    id: u.id,
    aud: u.aud,
    role: u.role,
    email: u.email,
    email_confirmed_at: u.email_confirmed_at,
    confirmed_at: u.email_confirmed_at,
    last_sign_in_at: u.last_sign_in_at,
    phone: "",
    app_metadata: u.raw_app_meta_data,
    user_metadata: u.raw_user_meta_data,
    identities: [],
    created_at: u.created_at,
    updated_at: u.updated_at,
    is_anonymous: false,
  };
}

export class AuthApi {
  /** When false (default, like production) sign-up needs the emailed link before sign-in works. */
  autoconfirm = false;
  readonly outbox: Mail[] = [];
  private refreshTokens = new Map<string, string>(); // token -> user id
  private oneTimeTokens = new Map<string, { userId: string; type: Mail["type"] }>();

  constructor(
    private readonly db: EmulatorDb,
    private readonly publicUrl: () => string,
  ) {}

  reset(): void {
    this.outbox.length = 0;
    this.refreshTokens.clear();
    this.oneTimeTokens.clear();
    this.autoconfirm = false;
  }

  private async byEmail(email: string): Promise<UserRow | null> {
    const rows = await this.db.admin<UserRow>(`select * from auth.users where lower(email) = lower($1)`, [email]);
    return rows[0] ?? null;
  }

  private async byId(id: string): Promise<UserRow | null> {
    const rows = await this.db.admin<UserRow>(`select * from auth.users where id = $1`, [id]);
    return rows[0] ?? null;
  }

  /** Insert into auth.users; fires the project's on_auth_user_created trigger. */
  async createUser(input: {
    email: string;
    password: string;
    confirmed: boolean;
    metadata?: Record<string, unknown>;
  }): Promise<UserRow> {
    const rows = await this.db.admin<UserRow>(
      `insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data)
       values ($1, $2, $3, case when $4::boolean then now() end, $5::jsonb)
       returning *`,
      [randomUUID(), input.email.trim().toLowerCase(), hashPassword(input.password), input.confirmed, JSON.stringify(input.metadata ?? {})],
    );
    return rows[0];
  }

  private async session(user: UserRow) {
    const now = Math.floor(Date.now() / 1000);
    let claims: JwtClaims = {
      iss: `${this.publicUrl()}/auth/v1`,
      aud: "authenticated",
      role: "authenticated",
      sub: user.id,
      email: user.email,
      phone: "",
      app_metadata: user.raw_app_meta_data,
      user_metadata: user.raw_user_meta_data,
      aal: "aal1",
      amr: [{ method: "password", timestamp: now }],
      session_id: randomUUID(),
      is_anonymous: false,
      iat: now,
      exp: now + ACCESS_TOKEN_TTL,
    };
    // Same contract as Supabase's Custom Access Token hook.
    const hook = await this.db.admin<{ event: { claims?: JwtClaims } | null }>(
      `select case when to_regprocedure('public.custom_access_token_hook(jsonb)') is not null
                   then public.custom_access_token_hook($1::jsonb) end as event`,
      [JSON.stringify({ user_id: user.id, claims, authentication_method: "password" })],
    );
    if (hook[0]?.event?.claims) claims = hook[0].event.claims;
    const refresh_token = randomBytes(12).toString("base64url");
    this.refreshTokens.set(refresh_token, user.id);
    return {
      access_token: signJwt(claims),
      token_type: "bearer",
      expires_in: ACCESS_TOKEN_TTL,
      expires_at: now + ACCESS_TOKEN_TTL,
      refresh_token,
      user: publicUser(user),
    };
  }

  private mail(user: UserRow, type: Mail["type"], redirectTo: string | null): void {
    const token = randomBytes(16).toString("hex");
    this.oneTimeTokens.set(token, { userId: user.id, type });
    const link =
      `${this.publicUrl()}/auth/v1/verify?token=${token}&type=${type}` +
      (redirectTo ? `&redirect_to=${encodeURIComponent(redirectTo)}` : "");
    this.outbox.push({ to: user.email, type, link, sent_at: new Date().toISOString() });
  }

  async handle(req: {
    method: string;
    path: string; // after /auth/v1
    params: URLSearchParams;
    body: Record<string, unknown>;
    claims: JwtClaims | null;
  }): Promise<AuthResponse> {
    const { method, path, params, body } = req;
    const role = req.claims?.role;

    if (method === "POST" && path === "/signup") {
      const email = String(body.email ?? "").trim();
      const password = String(body.password ?? "");
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        return err(400, "validation_failed", "Unable to validate email address: invalid format");
      }
      if (password.length < 6) {
        return err(422, "weak_password", "Password should be at least 6 characters.");
      }
      const existing = await this.byEmail(email);
      if (existing) {
        if (this.autoconfirm) return err(422, "user_already_exists", "User already registered");
        // With confirmations on, GoTrue answers as if it worked (no account enumeration).
        return { status: 200, body: { ...publicUser(existing), id: randomUUID(), identities: [] } };
      }
      let user: UserRow;
      try {
        user = await this.createUser({
          email,
          password,
          confirmed: this.autoconfirm,
          metadata: (body.data as Record<string, unknown>) ?? {},
        });
      } catch (e) {
        // What GoTrue returns when the auth.users trigger raises.
        return {
          status: 500,
          body: {
            code: 500,
            error_code: "unexpected_failure",
            msg: "Database error saving new user",
            emulator_detail: (e as PgError).message,
          },
        };
      }
      if (this.autoconfirm) return { status: 200, body: await this.session(user) };
      this.mail(user, "signup", params.get("redirect_to"));
      return { status: 200, body: { ...publicUser(user), confirmation_sent_at: new Date().toISOString() } };
    }

    if (method === "POST" && path === "/token") {
      const grant = params.get("grant_type");
      if (grant === "password") {
        const user = await this.byEmail(String(body.email ?? ""));
        if (!user || !checkPassword(String(body.password ?? ""), user.encrypted_password)) {
          return err(400, "invalid_credentials", "Invalid login credentials");
        }
        if (!user.email_confirmed_at) return err(400, "email_not_confirmed", "Email not confirmed");
        await this.db.admin(`update auth.users set last_sign_in_at = now() where id = $1`, [user.id]);
        return { status: 200, body: await this.session(user) };
      }
      if (grant === "refresh_token") {
        const token = String(body.refresh_token ?? "");
        const userId = this.refreshTokens.get(token);
        const user = userId ? await this.byId(userId) : null;
        if (!user) return err(400, "refresh_token_not_found", "Invalid Refresh Token: Refresh Token Not Found");
        this.refreshTokens.delete(token);
        return { status: 200, body: await this.session(user) };
      }
      return err(400, "invalid_request", `unsupported grant_type: ${grant}`);
    }

    if (method === "POST" && path === "/recover") {
      const user = await this.byEmail(String(body.email ?? ""));
      if (user) this.mail(user, "recovery", params.get("redirect_to"));
      return { status: 200, body: {} };
    }

    if (method === "GET" && path === "/verify") {
      const entry = this.oneTimeTokens.get(params.get("token") ?? "");
      const redirect = params.get("redirect_to") ?? this.publicUrl();
      if (!entry) {
        return {
          status: 303,
          body: null,
          headers: {
            location: `${redirect}#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired`,
          },
        };
      }
      this.oneTimeTokens.delete(params.get("token")!);
      await this.db.admin(
        `update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now()) where id = $1`,
        [entry.userId],
      );
      const user = (await this.byId(entry.userId))!;
      const s = await this.session(user);
      const hash = new URLSearchParams({
        access_token: s.access_token,
        expires_at: String(s.expires_at),
        expires_in: String(s.expires_in),
        refresh_token: s.refresh_token,
        token_type: "bearer",
        type: entry.type,
      });
      return { status: 303, body: null, headers: { location: `${redirect}#${hash.toString()}` } };
    }

    // ── Service-role admin API (test fixtures) ───────────────────────
    if (path === "/admin/users" || path.startsWith("/admin/users/")) {
      if (role !== "service_role") return err(403, "not_admin", "User not allowed");
      const id = path.split("/")[3];
      if (method === "POST" && !id) {
        if (await this.byEmail(String(body.email ?? ""))) {
          return err(422, "email_exists", "A user with this email address has already been registered");
        }
        try {
          const user = await this.createUser({
            email: String(body.email),
            password: String(body.password ?? randomBytes(9).toString("base64url")),
            confirmed: body.email_confirm === true,
            metadata: (body.user_metadata as Record<string, unknown>) ?? {},
          });
          return { status: 200, body: publicUser(user) };
        } catch (e) {
          return {
            status: 500,
            body: { code: 500, error_code: "unexpected_failure", msg: "Database error creating new user", emulator_detail: (e as PgError).message },
          };
        }
      }
      if (method === "GET" && !id) {
        const users = await this.db.admin<UserRow>(`select * from auth.users order by created_at`);
        return { status: 200, body: { users: users.map(publicUser), aud: "authenticated" } };
      }
      if (method === "DELETE" && id) {
        await this.db.admin(`delete from auth.users where id = $1`, [id]);
        return { status: 200, body: {} };
      }
      return err(404, "not_found", "Unknown admin route");
    }

    // ── Everything below needs a signed-in user ──────────────────────
    const userId = role === "authenticated" && typeof req.claims?.sub === "string" ? req.claims.sub : null;
    const user = userId ? await this.byId(userId) : null;

    if (path === "/user") {
      if (!user) return err(401, "no_authorization", "This endpoint requires a valid Bearer token");
      if (method === "GET") return { status: 200, body: publicUser(user) };
      if (method === "PUT") {
        if (typeof body.password === "string") {
          if (body.password.length < 6) {
            return err(422, "weak_password", "Password should be at least 6 characters.");
          }
          await this.db.admin(
            `update auth.users set encrypted_password = $2, updated_at = now() where id = $1`,
            [user.id, hashPassword(body.password)],
          );
        }
        if (body.data && typeof body.data === "object") {
          await this.db.admin(
            `update auth.users set raw_user_meta_data = raw_user_meta_data || $2::jsonb, updated_at = now() where id = $1`,
            [user.id, JSON.stringify(body.data)],
          );
        }
        return { status: 200, body: publicUser((await this.byId(user.id))!) };
      }
    }

    if (method === "POST" && path === "/logout") {
      if (user) {
        for (const [token, id] of this.refreshTokens) if (id === user.id) this.refreshTokens.delete(token);
      }
      return { status: 204, body: null };
    }

    return err(404, "not_found", `Auth route not supported by the test emulator: ${method} ${path}`);
  }
}
