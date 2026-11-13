-- ACL tighten (LGA-19):
-- - Landlords: read-only on Properties (drop insert/update policies)
-- - Landlords: no UPDATE on MaintenanceRequests (cannot close/edit WOs; SELECT kept)
-- - Applications: admin-only CRUD (maintenance staff must not read income/PII)
-- Does not alter inquiries, use-auth gate, or landlord portal shell (LGA-18).
-- Version 20261113252000 avoids clash with sibling PRs that also claimed 20261113240000.
-- Follow-up 20261113252100 sets UPDATE USING → helper + WITH CHECK on NEW-row columns.

-- ── Properties: landlord write → drop ─────────────────────────────
DROP POLICY IF EXISTS properties_landlord_insert ON public."Properties";
DROP POLICY IF EXISTS properties_landlord_update ON public."Properties";

COMMENT ON TABLE public."Properties" IS
  'Portfolio properties. SELECT: admin / owning landlord / tenant property / assigned staff. WRITE: admin only (landlords read-only).';

-- ── MaintenanceRequests: landlord update → drop ───────────────────
DROP POLICY IF EXISTS maintenance_requests_update ON public."MaintenanceRequests";
CREATE POLICY maintenance_requests_update ON public."MaintenanceRequests"
  FOR UPDATE
  TO authenticated
  USING (
    (SELECT private.current_role()) = 'admin'::public.app_role
    OR (
      (SELECT private.current_role()) = 'maintenance'::public.app_role
      AND assigned_staff_id = (SELECT private.current_staff_id())
    )
  )
  WITH CHECK (
    (SELECT private.current_role()) = 'admin'::public.app_role
    OR (
      (SELECT private.current_role()) = 'maintenance'::public.app_role
      AND assigned_staff_id = (SELECT private.current_staff_id())
    )
  );

COMMENT ON TABLE public."MaintenanceRequests" IS
  'Work orders. SELECT: admin / submitter tenant / assigned staff / owning landlord. INSERT: admin or scoped tenant. UPDATE: admin or assigned maintenance (landlords read-only; cannot close). DELETE: admin.';

-- Keep comment/photo helpers aligned with UPDATE policy (no landlord write).
CREATE OR REPLACE FUNCTION private.can_update_maintenance_request(target_request bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public."MaintenanceRequests" AS request
    WHERE request.id = target_request
      AND (
        (SELECT private.current_role()) = 'admin'::public.app_role
        OR (
          (SELECT private.current_role()) = 'maintenance'::public.app_role
          AND request.assigned_staff_id = (SELECT private.current_staff_id())
        )
      )
  );
$function$;

COMMENT ON FUNCTION private.can_update_maintenance_request(bigint) IS
  'True when caller may UPDATE the request (admin or assigned maintenance). Landlords are read-only.';

-- ── Applications: admin-only (no maintenance staff) ───────────────
DROP POLICY IF EXISTS applications_select ON public."Applications";
CREATE POLICY applications_select ON public."Applications"
  FOR SELECT
  TO authenticated
  USING (private.is_admin());

DROP POLICY IF EXISTS applications_insert ON public."Applications";
CREATE POLICY applications_insert ON public."Applications"
  FOR INSERT
  TO authenticated
  WITH CHECK (private.is_admin());

DROP POLICY IF EXISTS applications_update ON public."Applications";
CREATE POLICY applications_update ON public."Applications"
  FOR UPDATE
  TO authenticated
  USING (private.is_admin())
  WITH CHECK (private.is_admin());

-- applications_delete already admin-only

COMMENT ON TABLE public."Applications" IS
  'Rental applicants (not account approval). PII includes monthly_income (and future DOB). Admin-only SELECT/INSERT/UPDATE/DELETE; FORCE RLS. Maintenance staff denied.';
