# Auth password policy (WS-S S3 / hygiene #7)

## UI minimum length (repo)

Signup and reset-confirm share `PASSWORD_MIN_LENGTH` (**8**) from
[`src/client/lib/password-policy.ts`](../../src/client/lib/password-policy.ts).
**Login** does **not** enforce this constant (HTML `minLength` or JS) so existing
Auth-valid 6–7 character passwords can still sign in until users reset. Keep
signup + reset-confirm aligned when changing the constant.

## Owner: enable leaked-password protection (dashboard)

Agents **cannot** flip Supabase Auth settings. A project owner/admin must enable
**leaked password protection** in the live Auth project (`bgjkjtfgrfiszbzatriq`):

1. Open the [Supabase Dashboard](https://supabase.com/dashboard) → project **`bgjkjtfgrfiszbzatriq`**.
2. Go to **Authentication → Providers → Email** (or **Authentication → Settings**, depending on dashboard layout).
3. Under password / security options, enable **Leaked password protection**  
   (Have I Been Pwned check — rejects known-compromised passwords on signup / password update).
4. Confirm **Minimum password length** is **at least 8** (match the portal UI constant).
5. Save.

Until that toggle is on, the portal UI still enforces length ≥8, but Auth will not
reject passwords that appear in breach corpora.

## Account password change stub

`/account` asks for the current password, then calls `signInWithPassword` before
`updateUser({ password })`. That is a **client stub**, not Auth
`reauthenticate()` / AAL2 nonce enforcement:

- Only `invalid_credentials` is mapped to “Current password is incorrect.”; other
  Auth errors surface their real message (rate limit, captcha, etc.).
- A live session can still call `updateUser({ password })` without proving the
  old password. Secure change with a nonce when the session is older than 24h
  needs `supabase.auth.reauthenticate()` plus the dashboard secure-password-
  change setting — not implemented here.

## Related owner clicks

- Mark CI check required: [`docs/ops/ci-required-checks.md`](./ci-required-checks.md)
- Migration history / staging: [`docs/ops/schema-migrations.md`](./schema-migrations.md)
