-- Staging rebuild gap (same class as 20261114203000 ledger grants):
-- Phase 5 created PropertyDocuments + storage policies that EXISTS on the
-- table, but never GRANT SELECT/INSERT/UPDATE/DELETE to authenticated.
-- Without those privileges:
--   1) Portal FE cannot list/upload/delete documents under RLS.
--   2) Evaluating property_documents_* storage policies fails with
--      "permission denied for table PropertyDocuments", which also poisons
--      authenticated SELECT/INSERT/UPDATE/DELETE on storage.objects for
--      other buckets (maintenance-photos / listing-photos) in the same query.
--
-- Comment on 20261114010000 assumed PropertyDocuments already had full DML;
-- that held on long-lived live DBs with default privileges, not on a clean
-- staging pack apply. Idempotent GRANT.

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."PropertyDocuments"
  TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."PropertyDocuments"
  TO service_role;

DO $$
DECLARE
  identity_sequence regclass;
BEGIN
  SELECT pg_get_serial_sequence('public."PropertyDocuments"', 'id')::regclass
    INTO identity_sequence;
  IF identity_sequence IS NOT NULL THEN
    EXECUTE format(
      'GRANT USAGE, SELECT ON SEQUENCE %s TO authenticated, service_role',
      identity_sequence
    );
  END IF;
END $$;
