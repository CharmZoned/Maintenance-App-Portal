-- WS-E AuthZ leftovers (R7):
-- 1) Route landlord_owns_* / landlord_can_see_* through hardened current_landlord_id()
--    (approved + role = landlord) so pending/re-roled users cannot use a stale link id.
-- 2) Move MaintenanceRequests.notes into a staff-only table (row RLS; landlords/tenants
--    cannot read internal notes via PostgREST on the request row).
-- 3) Codify private.can_upload_maintenance_photo into repo migrations (was live/baseline-only).
-- Does not alter inquiries. No R6. No landlord self-serve writes.

-- ── Landlord ownership helpers → current_landlord_id() ────────────

CREATE OR REPLACE FUNCTION private.landlord_owns_unit(target_unit bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public."Units" AS unit
    JOIN public."Properties" AS property ON property.id = unit.property_id
    WHERE unit.id = target_unit
      AND property.landlord_id = (SELECT private.current_landlord_id())
  );
$function$;

CREATE OR REPLACE FUNCTION private.landlord_can_see_tenant(target_tenant bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public."Tenants" AS tenant
    JOIN public."Units" AS unit ON unit.id = tenant.unit_id
    JOIN public."Properties" AS property ON property.id = unit.property_id
    WHERE tenant.id = target_tenant
      AND property.landlord_id = (SELECT private.current_landlord_id())
  );
$function$;

CREATE OR REPLACE FUNCTION private.landlord_can_see_staff(target_staff bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public."MaintenanceRequests" AS request
    JOIN public."Units" AS unit ON unit.id = request.unit_id
    JOIN public."Properties" AS property ON property.id = unit.property_id
    WHERE request.assigned_staff_id = target_staff
      AND property.landlord_id = (SELECT private.current_landlord_id())
  );
$function$;

COMMENT ON FUNCTION private.landlord_owns_unit(bigint) IS
  'True when an approved landlord owns the property for the unit (via current_landlord_id).';
COMMENT ON FUNCTION private.landlord_can_see_tenant(bigint) IS
  'True when an approved landlord owns the tenant''s unit property (via current_landlord_id).';
COMMENT ON FUNCTION private.landlord_can_see_staff(bigint) IS
  'True when an approved landlord owns a unit with a request assigned to that staff (via current_landlord_id).';

-- ── Codify can_upload_maintenance_photo (parity with live / baseline) ─

CREATE OR REPLACE FUNCTION private.can_upload_maintenance_photo(target_request bigint)
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
        (SELECT private.can_update_maintenance_request(target_request))
        OR (
          (SELECT private.current_role()) = 'tenant'::public.app_role
          AND request.submitted_by_tenant_id = (SELECT private.current_tenant_id())
        )
      )
  );
$function$;

COMMENT ON FUNCTION private.can_upload_maintenance_photo(bigint) IS
  'True when caller may upload a photo: can_update_maintenance_request, or submitting tenant.';

REVOKE ALL ON FUNCTION private.can_upload_maintenance_photo(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.can_upload_maintenance_photo(bigint) TO authenticated, service_role;

-- ── Staff-only internal notes (strip from MaintenanceRequests row) ─

CREATE TABLE IF NOT EXISTS public."MaintenanceRequestStaffNotes" (
  maintenance_request_id bigint PRIMARY KEY
    REFERENCES public."MaintenanceRequests"(id) ON DELETE CASCADE,
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public."MaintenanceRequestStaffNotes" IS
  'Internal staff notes for a work order. SELECT/write: admin or maintenance only (not landlord/tenant).';

-- Migrate existing notes before dropping the column.
INSERT INTO public."MaintenanceRequestStaffNotes" (maintenance_request_id, notes)
SELECT id, notes
FROM public."MaintenanceRequests"
WHERE notes IS NOT NULL
  AND length(trim(notes)) > 0
ON CONFLICT (maintenance_request_id) DO UPDATE
  SET notes = EXCLUDED.notes,
      updated_at = now();

-- Tenant INSERT policy referenced notes IS NULL — recreate without that column check.
DROP POLICY IF EXISTS maintenance_requests_insert_tenant ON public."MaintenanceRequests";
CREATE POLICY maintenance_requests_insert_tenant
  ON public."MaintenanceRequests"
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT private.current_role()) = 'tenant'::public.app_role
    AND submitted_by_tenant_id = (SELECT private.current_tenant_id())
    AND unit_id = (SELECT private.current_tenant_unit_id())
    AND property_id IS NOT DISTINCT FROM (SELECT private.current_tenant_property_id())
    AND status = 'Open'::text
    AND assigned_staff_id IS NULL
    AND started_at IS NULL
    AND closed_at IS NULL
    AND scheduled_for IS NULL
    AND hold_reason IS NULL
    AND next_follow_up_date IS NULL
    AND resolution_notes IS NULL
    AND vendor_id IS NULL
    AND cost IS NULL
    AND is_test_data = false
  );

ALTER TABLE public."MaintenanceRequests" DROP COLUMN IF EXISTS notes;

ALTER TABLE public."MaintenanceRequestStaffNotes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."MaintenanceRequestStaffNotes" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS maintenance_staff_notes_select ON public."MaintenanceRequestStaffNotes";
CREATE POLICY maintenance_staff_notes_select
  ON public."MaintenanceRequestStaffNotes"
  FOR SELECT
  TO authenticated
  USING (
    (SELECT private.can_select_maintenance_request(maintenance_request_id))
    AND (SELECT private.current_role()) = ANY (
      ARRAY['admin'::public.app_role, 'maintenance'::public.app_role]
    )
  );

DROP POLICY IF EXISTS maintenance_staff_notes_insert ON public."MaintenanceRequestStaffNotes";
CREATE POLICY maintenance_staff_notes_insert
  ON public."MaintenanceRequestStaffNotes"
  FOR INSERT
  TO authenticated
  WITH CHECK (private.can_update_maintenance_request(maintenance_request_id));

DROP POLICY IF EXISTS maintenance_staff_notes_update ON public."MaintenanceRequestStaffNotes";
CREATE POLICY maintenance_staff_notes_update
  ON public."MaintenanceRequestStaffNotes"
  FOR UPDATE
  TO authenticated
  USING (private.can_update_maintenance_request(maintenance_request_id))
  WITH CHECK (private.can_update_maintenance_request(maintenance_request_id));

DROP POLICY IF EXISTS maintenance_staff_notes_delete ON public."MaintenanceRequestStaffNotes";
CREATE POLICY maintenance_staff_notes_delete
  ON public."MaintenanceRequestStaffNotes"
  FOR DELETE
  TO authenticated
  USING (private.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."MaintenanceRequestStaffNotes" TO authenticated;
GRANT ALL ON TABLE public."MaintenanceRequestStaffNotes" TO service_role;

COMMENT ON TABLE public."MaintenanceRequests" IS
  'Work orders. SELECT: admin / submitter tenant / assigned staff / owning landlord. INSERT: admin or scoped tenant. UPDATE: admin or assigned maintenance (landlords read-only). DELETE: admin. Internal notes live in MaintenanceRequestStaffNotes (staff/admin only).';
