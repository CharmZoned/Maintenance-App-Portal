-- Owner decision (2026-11-24): property owners (landlord role) must not receive
-- tenant screening data. Before this file public."Tenants" returned
-- date_of_birth, employer, monthly_income, notes and emergency_contact to any
-- landlord whose property the tenant lives in.
--
-- Same mechanism as workers (20261114210000, 20261119090000): the
-- security_invoker view masks columns per caller; RLS on private.tenants still
-- decides which rows. After this file a landlord reads, for their own tenants:
--   id, created_at, source_id, first_name, last_name, email, mobile_phone,
--   unit_id, primary_on_lease, invite_to_app, is_test_data
-- (lease / move-in dates come from public."Leases", unchanged), and NULL for
--   notes, date_of_birth, employer, monthly_income, emergency_contact.
-- Admin, the tenant themselves, service_role and ops sessions are unchanged.
-- Workers are unchanged (contact columns only while they hold an open job).
--
-- The column list, order and types are unchanged, so existing client reads
-- (select * or narrower) keep working; the INSTEAD OF triggers and grants on
-- the view are kept by CREATE OR REPLACE VIEW.

-- Full record: admin / the tenant / service_role / ops. Landlord removed.
-- Also used by the INSTEAD OF triggers to re-mask RETURNING rows.
CREATE OR REPLACE FUNCTION private.can_read_tenant_pii()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  -- Do not use current_user here: SECURITY DEFINER makes it the owner and
  -- would fail-open for every caller.
  SELECT
    coalesce(auth.jwt() ->> 'role', '') = 'service_role'
    OR (SELECT private.current_role()) IN (
      'admin'::public.app_role,
      'tenant'::public.app_role
    )
    -- DB/SQL-editor sessions (no JWT subject): allow full row for ops.
    OR (
      (SELECT auth.uid()) IS NULL
      AND coalesce(auth.jwt() ->> 'role', '') = ''
    );
$function$;

COMMENT ON FUNCTION private.can_read_tenant_pii() IS
  'Full tenant record (screening fields, notes, emergency contact): admin, the tenant, service_role, ops sessions. Not landlords, not workers.';

-- Name / email / phone for the owner of the tenant's unit. RLS already limits
-- a landlord to their own tenants' rows; this only gates the columns.
CREATE OR REPLACE FUNCTION private.can_read_tenant_contact()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT private.can_read_tenant_pii()
      OR (SELECT private.current_role()) = 'landlord'::public.app_role;
$function$;

REVOKE ALL ON FUNCTION private.can_read_tenant_contact() FROM public, anon;
GRANT EXECUTE ON FUNCTION private.can_read_tenant_contact() TO authenticated, service_role;

COMMENT ON FUNCTION private.can_read_tenant_contact() IS
  'Tenant email + mobile phone: everyone in can_read_tenant_pii() plus approved landlords (rows still limited by RLS).';

CREATE OR REPLACE VIEW public."Tenants"
WITH (security_invoker = true) AS
SELECT
  t.id,
  t.created_at,
  t.source_id,
  t.first_name,
  t.last_name,
  CASE WHEN private.can_read_tenant_contact() OR private.worker_has_open_job_for_tenant(t.id)
       THEN t.email ELSE NULL END AS email,
  CASE WHEN private.can_read_tenant_contact() OR private.worker_has_open_job_for_tenant(t.id)
       THEN t.mobile_phone ELSE NULL END AS mobile_phone,
  t.unit_id,
  t.primary_on_lease,
  t.invite_to_app,
  CASE WHEN private.can_read_tenant_pii() THEN t.notes ELSE NULL END AS notes,
  t.is_test_data,
  CASE WHEN private.can_read_tenant_pii() THEN t.date_of_birth ELSE NULL END AS date_of_birth,
  CASE WHEN private.can_read_tenant_pii() OR private.worker_has_open_job_for_tenant(t.id)
       THEN t.emergency_contact ELSE NULL END AS emergency_contact,
  CASE WHEN private.can_read_tenant_pii() THEN t.employer ELSE NULL END AS employer,
  CASE WHEN private.can_read_tenant_pii() THEN t.monthly_income ELSE NULL END AS monthly_income
FROM private.tenants t;

COMMENT ON VIEW public."Tenants" IS
  'Tenant rows. Full record (DOB, employer, income, notes, emergency contact) only for admin / the tenant / service_role. Landlords: name, email, phone, unit link. Workers: name always; email/phone/emergency contact only while they hold an open job in the tenant''s unit.';

NOTIFY pgrst, 'reload schema';
