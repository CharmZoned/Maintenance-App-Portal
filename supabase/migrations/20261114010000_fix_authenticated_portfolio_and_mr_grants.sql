-- WS-A / B3+B5: restore authenticated DML that RLS already allows.
-- Live (and emulator baseline 20261012184126) left Landlords/Properties/Units/Tenants
-- SELECT-only and MaintenanceRequests without DELETE. Leases and PropertyDocuments
-- already have full DML — leave them alone.
-- Policies (admin write / admin delete WO / non-admin deny) are unchanged.

GRANT INSERT, UPDATE, DELETE ON TABLE
  public."Landlords",
  public."Properties",
  public."Units",
  public."Tenants"
TO authenticated;

GRANT DELETE ON TABLE public."MaintenanceRequests" TO authenticated;

DO $$
DECLARE
  identity_sequence regclass;
  qualified_table text;
BEGIN
  FOREACH qualified_table IN ARRAY ARRAY[
    'public."Landlords"',
    'public."Properties"',
    'public."Units"',
    'public."Tenants"'
  ]
  LOOP
    SELECT pg_get_serial_sequence(qualified_table, 'id')::regclass
      INTO identity_sequence;
    IF identity_sequence IS NOT NULL THEN
      EXECUTE format(
        'GRANT USAGE, SELECT ON SEQUENCE %s TO authenticated',
        identity_sequence
      );
    END IF;
  END LOOP;
END $$;
