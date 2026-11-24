-- Landlord wave A1: a landlord can file a maintenance request.
--
-- Owner decisions (2026-11-24, docs/landlord-wave-plan.md §2):
--   D1  Landlords can submit requests.
--   D2  They can file common-area requests (no unit) on a property they own.
--   D3  (changed by the owner 2026-11-24) The current tenant of the unit DOES
--       see a landlord-filed request on that unit, view only; common-area
--       requests stay hidden from tenants. This file leaves tenant visibility
--       at "requests I submitted"; 20261124120000_tenant_sees_landlord_requests
--       adds the unit tenant's read path.
--       The landlord form offers "Permission to enter"; the column already
--       defaults to false, so a landlord who leaves it alone files "No".
--
-- What this adds:
--   * MaintenanceRequests.submitted_by_landlord_id, and a CHECK that a request
--     has at most one reporter (a tenant or a landlord, never both).
--   * Policy maintenance_requests_insert_landlord, with the same "fresh request"
--     guards as maintenance_requests_insert_tenant (20261118190000).
--   * Landlord visibility for common-area requests (unit_id NULL) on a property
--     they own. Before this, landlord visibility went only through the unit, so
--     a common-area request was invisible to its own landlord (and an INSERT ...
--     RETURNING would fail). The same gap is closed in the helpers that follow a
--     request to its property: the landlord's price, the assigned worker's name,
--     and the worker's view of the property address.
--   * Photos: a landlord can add photos to a request they filed on their own
--     property, within the existing 5-photo reporter cap. Landlords stay
--     read-only on requests their tenants filed (r4 "a landlord can view photos
--     ... but cannot upload"). A landlord can remove only the photos they
--     uploaded (the upload flow rolls back its own row if the file fails).
--   * submitted_by_landlord_id cannot be changed after the fact except by admins.
--
-- Status history: private.log_maintenance_status_change() (20261118190000)
-- already writes the INSERT row with auth.uid() and private.current_role(), so a
-- landlord-created request starts its trail as (NULL -> Open, landlord, the
-- landlord's user id, 'Created'). No change needed; covered by r4 tests.

-- ── Column and reporter check ───────────────────────────────────────

ALTER TABLE public."MaintenanceRequests"
  ADD COLUMN IF NOT EXISTS submitted_by_landlord_id bigint
    REFERENCES public."Landlords"(id) ON DELETE SET NULL;

COMMENT ON COLUMN public."MaintenanceRequests".submitted_by_landlord_id IS
  'Landlord who reported this request from the portal. NULL for tenant- or office-filed requests. At most one of submitted_by_tenant_id / submitted_by_landlord_id is set.';

CREATE INDEX IF NOT EXISTS maintenance_requests_submitted_by_landlord_idx
  ON public."MaintenanceRequests" (submitted_by_landlord_id);

ALTER TABLE public."MaintenanceRequests"
  DROP CONSTRAINT IF EXISTS requests_single_reporter;
ALTER TABLE public."MaintenanceRequests"
  ADD CONSTRAINT requests_single_reporter CHECK (
    num_nonnulls(submitted_by_tenant_id, submitted_by_landlord_id) <= 1
  );

-- ── Helpers ─────────────────────────────────────────────────────────

-- The calling (approved) landlord owns this property.
CREATE OR REPLACE FUNCTION private.landlord_owns_property(target_property bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public."Properties" AS property
    WHERE property.id = target_property
      AND property.landlord_id = (SELECT private.current_landlord_id())
  )
$function$;

COMMENT ON FUNCTION private.landlord_owns_property(bigint) IS
  'True when an approved landlord owns the property (via current_landlord_id).';

REVOKE ALL ON FUNCTION private.landlord_owns_property(bigint) FROM public, anon;
GRANT EXECUTE ON FUNCTION private.landlord_owns_property(bigint) TO authenticated, service_role;

-- The landlord owns this request: its unit, or (common area) its property.
CREATE OR REPLACE FUNCTION private.landlord_owns_request(target_request bigint)
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
        private.landlord_owns_unit(request.unit_id)
        OR (request.unit_id IS NULL AND private.landlord_owns_property(request.property_id))
      )
  )
$function$;

COMMENT ON FUNCTION private.landlord_owns_request(bigint) IS
  'True when an approved landlord owns the request''s unit, or its property for a common-area request (unit_id NULL).';

-- Comments, photos and status history follow this helper.
CREATE OR REPLACE FUNCTION private.can_select_maintenance_request(target_request bigint)
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
        OR request.submitted_by_tenant_id = (SELECT private.current_tenant_id())
        OR request.assigned_staff_id = (SELECT private.current_staff_id())
        OR (SELECT private.landlord_owns_unit(request.unit_id))
        OR (
          request.unit_id IS NULL
          AND (SELECT private.landlord_owns_property(request.property_id))
        )
      )
  );
$function$;

-- Landlord sees the worker on any request on their property (unit or common area).
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
    LEFT JOIN public."Units" AS unit ON unit.id = request.unit_id
    JOIN public."Properties" AS property
      ON property.id = COALESCE(unit.property_id, request.property_id)
    WHERE request.assigned_staff_id = target_staff
      AND property.landlord_id = (SELECT private.current_landlord_id())
  )
$function$;

-- The assigned worker can read the property row of a common-area job too.
CREATE OR REPLACE FUNCTION private.staff_assigned_to_property(target_property bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public."MaintenanceRequests" AS request
    LEFT JOIN public."Units" AS unit ON unit.id = request.unit_id
    WHERE COALESCE(unit.property_id, request.property_id) = target_property
      AND request.assigned_staff_id = (SELECT private.current_staff_id())
  )
$function$;

-- ── Who reads a request ─────────────────────────────────────────────
-- Unchanged from 20261118190000 except the common-area landlord branch.
-- Tenants see only what they submitted here; 20261124120000 adds landlord-filed
-- requests on the tenant's current unit (D3, changed 2026-11-24).

DROP POLICY IF EXISTS maintenance_requests_select ON public."MaintenanceRequests";
CREATE POLICY maintenance_requests_select ON public."MaintenanceRequests"
  FOR SELECT TO authenticated
  USING (
    ((SELECT private.current_role()) = 'admin'::public.app_role)
    OR (submitted_by_tenant_id = (SELECT private.current_tenant_id()))
    OR (assigned_staff_id = (SELECT private.current_staff_id()))
    OR (SELECT private.landlord_owns_unit("MaintenanceRequests".unit_id))
    OR (
      "MaintenanceRequests".unit_id IS NULL
      AND (SELECT private.landlord_owns_property("MaintenanceRequests".property_id))
    )
    OR (
      status = 'Open'
      AND offered_at IS NOT NULL
      AND assigned_staff_id IS NULL
      AND (SELECT private.job_available_to_me("MaintenanceRequests".id))
    )
  );

-- ── Landlord files a request ────────────────────────────────────────
-- Unit requests: the property_id is filled (or checked) from the unit by the
-- maintenance_request_property_matches_unit BEFORE trigger, which runs before
-- this check.

DROP POLICY IF EXISTS maintenance_requests_insert_landlord ON public."MaintenanceRequests";
CREATE POLICY maintenance_requests_insert_landlord ON public."MaintenanceRequests"
  FOR INSERT TO authenticated
  WITH CHECK (
    ((SELECT private.current_role()) = 'landlord'::public.app_role)
    AND (submitted_by_landlord_id = (SELECT private.current_landlord_id()))
    AND (submitted_by_tenant_id IS NULL)
    AND (
      (SELECT private.landlord_owns_unit(unit_id))
      OR (unit_id IS NULL AND (SELECT private.landlord_owns_property(property_id)))
    )
    -- Same fresh-request guards as maintenance_requests_insert_tenant.
    AND (status = 'Open'::text)
    AND (assigned_staff_id IS NULL)
    AND (started_at IS NULL)
    AND (closed_at IS NULL)
    AND (scheduled_for IS NULL)
    AND (hold_reason IS NULL)
    AND (next_follow_up_date IS NULL)
    AND (resolution_notes IS NULL)
    AND (vendor_id IS NULL)
    AND (offered_at IS NULL)
    AND (offered_by_user_id IS NULL)
    AND (accepted_at IS NULL)
    AND (released_at IS NULL)
    AND (released_by_staff_id IS NULL)
    AND (tenant_fix_response IS NULL)
    AND (is_test_data = false)
  );

COMMENT ON TABLE public."MaintenanceRequests" IS
  'Work orders. SELECT: admin / submitter tenant / assigned staff / owning landlord (unit, or property for common-area rows) / pooled-job workers. INSERT: admin, scoped tenant, or owning landlord (fresh Open rows only). UPDATE: admin or assigned maintenance (landlords read-only; cannot close). DELETE: admin.';

-- Only admins re-point who reported a request (tenants are covered by
-- private.protect_maintenance_request; this is the landlord column).
CREATE OR REPLACE FUNCTION private.protect_submitted_by_landlord()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF auth.uid() IS NULL OR private.current_role() = 'admin'::public.app_role THEN
    RETURN NEW;
  END IF;
  IF NEW.submitted_by_landlord_id IS DISTINCT FROM OLD.submitted_by_landlord_id THEN
    RAISE EXCEPTION 'These request fields cannot be changed from this account';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS maintenance_requests_protect_landlord_reporter ON public."MaintenanceRequests";
CREATE TRIGGER maintenance_requests_protect_landlord_reporter
  BEFORE UPDATE OF submitted_by_landlord_id ON public."MaintenanceRequests"
  FOR EACH ROW
  EXECUTE FUNCTION private.protect_submitted_by_landlord();

-- ── Photos ──────────────────────────────────────────────────────────

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
        OR (
          (SELECT private.current_role()) = 'landlord'::public.app_role
          AND request.submitted_by_landlord_id = (SELECT private.current_landlord_id())
          AND (
            private.landlord_owns_unit(request.unit_id)
            OR (request.unit_id IS NULL AND private.landlord_owns_property(request.property_id))
          )
        )
      )
  );
$function$;

COMMENT ON FUNCTION private.can_upload_maintenance_photo(bigint) IS
  'True when caller may upload a photo: can_update_maintenance_request, the submitting tenant, or the submitting landlord while they still own the property.';

-- A landlord removes only their own photo rows (upload rollback), like a tenant.
DROP POLICY IF EXISTS maintenance_photos_delete ON public."MaintenanceRequestPhotos";
CREATE POLICY maintenance_photos_delete ON public."MaintenanceRequestPhotos"
  FOR DELETE
  TO authenticated
  USING (
    ((SELECT private.current_role()) = 'admin'::public.app_role)
    OR (
      ((SELECT private.current_role()) IN ('tenant'::public.app_role, 'landlord'::public.app_role))
      AND uploaded_by_user_id = (SELECT auth.uid())
      AND (SELECT private.can_upload_maintenance_photo("MaintenanceRequestPhotos".maintenance_request_id))
    )
  );

-- Storage overwrite/delete: landlords touch only files they uploaded (so a
-- landlord cannot replace or remove a worker's completion photo on a request
-- they filed). Admin and maintenance branches are unchanged from 20261114120000.
DROP POLICY IF EXISTS maintenance_photos_storage_update ON storage.objects;
CREATE POLICY maintenance_photos_storage_update
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'maintenance-photos'
    AND EXISTS (
      SELECT 1
      FROM public."MaintenanceRequestPhotos" AS photo
      WHERE photo.storage_path = name
    )
    AND (
      (SELECT private.current_role()) = 'admin'::public.app_role
      OR (
        (SELECT private.current_role()) = 'maintenance'::public.app_role
        AND (SELECT private.can_upload_maintenance_photo(
          (NULLIF(split_part(name, '/', 1), ''))::bigint
        ))
      )
      OR (
        (SELECT private.current_role()) = 'landlord'::public.app_role
        AND (SELECT private.can_upload_maintenance_photo(
          (NULLIF(split_part(name, '/', 1), ''))::bigint
        ))
        AND EXISTS (
          SELECT 1
          FROM public."MaintenanceRequestPhotos" AS own
          WHERE own.storage_path = name
            AND own.uploaded_by_user_id = (SELECT auth.uid())
        )
      )
    )
  )
  WITH CHECK (
    bucket_id = 'maintenance-photos'
    AND name ~ '^[0-9]+/[^/]+$'
    AND EXISTS (
      SELECT 1
      FROM public."MaintenanceRequestPhotos" AS photo
      WHERE photo.storage_path = name
    )
    AND (
      (SELECT private.current_role()) = 'admin'::public.app_role
      OR (
        (SELECT private.current_role()) = 'maintenance'::public.app_role
        AND (SELECT private.can_upload_maintenance_photo(
          (NULLIF(split_part(name, '/', 1), ''))::bigint
        ))
      )
      OR (
        (SELECT private.current_role()) = 'landlord'::public.app_role
        AND (SELECT private.can_upload_maintenance_photo(
          (NULLIF(split_part(name, '/', 1), ''))::bigint
        ))
        AND EXISTS (
          SELECT 1
          FROM public."MaintenanceRequestPhotos" AS own
          WHERE own.storage_path = name
            AND own.uploaded_by_user_id = (SELECT auth.uid())
        )
      )
    )
  );

DROP POLICY IF EXISTS maintenance_photos_storage_delete ON storage.objects;
CREATE POLICY maintenance_photos_storage_delete
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'maintenance-photos'
    AND EXISTS (
      SELECT 1
      FROM public."MaintenanceRequestPhotos" AS photo
      WHERE photo.storage_path = name
        AND (
          (SELECT private.current_role()) = 'admin'::public.app_role
          OR (
            (SELECT private.current_role()) IN ('tenant'::public.app_role, 'landlord'::public.app_role)
            AND photo.uploaded_by_user_id = (SELECT auth.uid())
            AND (SELECT private.can_upload_maintenance_photo(photo.maintenance_request_id))
          )
          OR (
            (SELECT private.current_role()) = 'maintenance'::public.app_role
            AND (SELECT private.can_upload_maintenance_photo(photo.maintenance_request_id))
          )
        )
    )
  );
