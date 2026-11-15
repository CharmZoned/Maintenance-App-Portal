-- Align production PropertyDocuments table grants with staging:
-- anon must not have SELECT/INSERT/UPDATE/DELETE. Staging already lacks
-- those privileges; this REVOKE is idempotent (no-op when already revoked).
-- Leave REFERENCES/TRIGGER/TRUNCATE as-is (present on staging too).
-- RLS policies remain authenticated-only; portal uses the anon key only as
-- the client publishable key and accesses this table under authenticated JWTs.

REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLE public."PropertyDocuments"
  FROM anon;
