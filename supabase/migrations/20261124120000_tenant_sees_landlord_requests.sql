-- Landlord wave A3: the tenant of a unit sees requests their landlord filed on it.
--
-- Owner decision D3, changed 2026-11-24 (docs/landlord-wave-plan.md §2): the
-- CURRENT tenant of a unit sees a landlord-filed request on that unit, view
-- only, labelled "Reported by <landlord name>". Common-area requests
-- (unit_id NULL) stay hidden from tenants. Replying and confirming the fix stay
-- with the reporter. The tenant learns the landlord's name and nothing else
-- about them: never their email, phone or notes.
--
-- "Current tenant" is private.current_tenant_unit_id() (approved tenant login,
-- Tenants.unit_id). A tenant who moves out or to another unit stops seeing the
-- old unit's landlord-filed requests at once. Requests the tenant filed
-- themselves keep following submitted_by_tenant_id, as before.
--
-- Read paths that now include these rows:
--   * MaintenanceRequests (maintenance_requests_select)
--   * private.can_select_maintenance_request, which gates photos (rows and
--     storage files), status history, tenant-visible comments, and the
--     tenant's own read markers (MaintenanceThreadReads)
--   * the assigned worker's Staff row (private.tenant_can_see_staff)
--   * the landlord's display name, through public.list_request_reporter_names()
--
-- Unchanged on purpose:
--   * Prices: a tenant reads neither the worker nor the landlord price
--     (worker_prices_select / landlord_prices_select never had a tenant path).
--   * Staff notes and internal comments: admin and maintenance only.
--   * Every tenant write path. Photo upload (can_upload_maintenance_photo),
--     the fix confirmation (confirm_maintenance_request_fixed and
--     protect_maintenance_request) and UPDATE (can_update_maintenance_request)
--     already key off submitted_by_tenant_id or staff roles. The two policies
--     whose tenant branch used can_select_maintenance_request are restated
--     below so they keep requiring the tenant to be the reporter:
--     maintenance_comments_insert, and the request link on office_messages_insert.
--
-- Landlords table: before this file a tenant could SELECT their landlord's
-- whole Landlords row (email, mobile phone, notes) through
-- private.tenant_can_see_landlord. The portal never read it for tenants. That
-- branch is removed here, the same way 20261119090000 closed it for workers;
-- the reporter name comes from the narrow RPC instead.

-- ── Helpers ─────────────────────────────────────────────────────────

-- The calling tenant is the one who reported this request. Tenant write paths
-- (comments, the office-message link) use this instead of the wider read helper.
CREATE OR REPLACE FUNCTION private.tenant_reported_request(target_request bigint)
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
      AND request.submitted_by_tenant_id = (SELECT private.current_tenant_id())
  )
$function$;

COMMENT ON FUNCTION private.tenant_reported_request(bigint) IS
  'True when the calling approved tenant submitted this request (submitted_by_tenant_id = current_tenant_id()).';

REVOKE ALL ON FUNCTION private.tenant_reported_request(bigint) FROM public, anon;
GRANT EXECUTE ON FUNCTION private.tenant_reported_request(bigint) TO authenticated, service_role;

-- Comments, photos, status history and thread reads follow this helper.
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
        OR (
          request.submitted_by_landlord_id IS NOT NULL
          AND request.unit_id = (SELECT private.current_tenant_unit_id())
        )
        OR request.assigned_staff_id = (SELECT private.current_staff_id())
        OR (SELECT private.landlord_owns_unit(request.unit_id))
        OR (
          request.unit_id IS NULL
          AND (SELECT private.landlord_owns_property(request.property_id))
        )
      )
  );
$function$;

-- The tenant sees the worker on a request they reported, or on a
-- landlord-filed request on their current unit.
CREATE OR REPLACE FUNCTION private.tenant_can_see_staff(target_staff bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public."MaintenanceRequests" AS request
    WHERE request.assigned_staff_id = target_staff
      AND (
        request.submitted_by_tenant_id = (SELECT private.current_tenant_id())
        OR (
          request.submitted_by_landlord_id IS NOT NULL
          AND request.unit_id = (SELECT private.current_tenant_unit_id())
        )
      )
  )
$function$;

COMMENT ON FUNCTION private.tenant_can_see_staff(bigint) IS
  'True when an approved tenant can see a work order assigned to that staff: one they submitted, or a landlord-filed one on their current unit.';

-- ── Who reads a request ─────────────────────────────────────────────
-- As 20261124100000, plus the landlord-filed branch for the unit's tenant.

DROP POLICY IF EXISTS maintenance_requests_select ON public."MaintenanceRequests";
CREATE POLICY maintenance_requests_select ON public."MaintenanceRequests"
  FOR SELECT TO authenticated
  USING (
    ((SELECT private.current_role()) = 'admin'::public.app_role)
    OR (submitted_by_tenant_id = (SELECT private.current_tenant_id()))
    OR (
      submitted_by_landlord_id IS NOT NULL
      AND unit_id = (SELECT private.current_tenant_unit_id())
    )
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

COMMENT ON TABLE public."MaintenanceRequests" IS
  'Work orders. SELECT: admin / submitter tenant / the unit''s current tenant for landlord-filed unit requests / assigned staff / owning landlord (unit, or property for common-area rows) / pooled-job workers. INSERT: admin, scoped tenant, or owning landlord (fresh Open rows only). UPDATE: admin or assigned maintenance (landlords and tenants read-only; cannot close). DELETE: admin.';

-- ── Tenant writes stay with the reporter ────────────────────────────

-- Comments: unchanged from 20261113220000 except the tenant branch, which
-- now names the reporter instead of "can see the request".
DROP POLICY IF EXISTS maintenance_comments_insert ON public."MaintenanceRequestComments";
CREATE POLICY maintenance_comments_insert ON public."MaintenanceRequestComments"
  FOR INSERT TO authenticated
  WITH CHECK (
    (visibility = ANY (ARRAY['tenant_visible'::text, 'internal'::text]))
    AND (author_user_id = (SELECT auth.uid()))
    AND NOT (author_role IS DISTINCT FROM (SELECT private.current_role()))
    AND NOT (author_staff_id IS DISTINCT FROM (SELECT private.current_staff_id()))
    AND NOT (author_tenant_id IS DISTINCT FROM (SELECT private.current_tenant_id()))
    AND (
      (SELECT private.can_update_maintenance_request("MaintenanceRequestComments".maintenance_request_id))
      OR (
        ((SELECT private.current_role()) = 'tenant'::public.app_role)
        AND (visibility = 'tenant_visible'::text)
        AND (SELECT private.tenant_reported_request("MaintenanceRequestComments".maintenance_request_id))
      )
    )
  );

-- Office messages: as 20261124110000, but a tenant links only a request they
-- reported (a landlord-filed request on their unit is view only).
DROP POLICY IF EXISTS office_messages_insert ON public."OfficeMessages";
CREATE POLICY office_messages_insert ON public."OfficeMessages"
  FOR INSERT TO authenticated
  WITH CHECK (
    author_user_id = (SELECT auth.uid())
    AND NOT (author_role IS DISTINCT FROM (SELECT private.current_role()))
    AND (
      (
        (SELECT private.is_admin())
        AND (SELECT private.is_office_thread_user(thread_user_id))
      )
      OR (
        (SELECT private.current_role()) <> 'admin'::public.app_role
        AND thread_user_id = (SELECT auth.uid())
      )
    )
    AND (
      request_id IS NULL
      OR (SELECT private.is_admin())
      OR (
        (SELECT private.can_select_maintenance_request(request_id))
        AND (
          (SELECT private.current_role()) IS DISTINCT FROM 'tenant'::public.app_role
          OR (SELECT private.tenant_reported_request(request_id))
        )
      )
    )
  );

-- ── Landlord contact record: closed to tenants ──────────────────────

DROP POLICY IF EXISTS landlords_select ON public."Landlords";
CREATE POLICY landlords_select ON public."Landlords"
  FOR SELECT TO authenticated
  USING (
    ((SELECT private.current_role()) = 'admin'::public.app_role)
    OR (id = (SELECT private.current_landlord_id()))
  );

COMMENT ON FUNCTION private.tenant_can_see_landlord(bigint) IS
  'Unused since 20261124120000: tenants no longer read Landlords rows. Reporter names come from public.list_request_reporter_names().';

-- ── "Reported by <landlord name>" ───────────────────────────────────
-- Returns the reporting landlord's display name (company name, else first and
-- last name) for each given request the caller can see and a landlord filed.
-- Nothing else about the landlord leaves this function. Requests the caller
-- cannot see, and requests not filed by a landlord, are simply left out.

CREATE OR REPLACE FUNCTION public.list_request_reporter_names(p_request_ids bigint[])
RETURNS TABLE (request_id bigint, landlord_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT
    request.id AS request_id,
    COALESCE(
      NULLIF(btrim(landlord.company_name), ''),
      NULLIF(btrim(concat_ws(' ', btrim(landlord.first_name), btrim(landlord.last_name))), '')
    ) AS landlord_name
  FROM public."MaintenanceRequests" AS request
  JOIN public."Landlords" AS landlord ON landlord.id = request.submitted_by_landlord_id
  WHERE request.id = ANY (COALESCE(p_request_ids, ARRAY[]::bigint[]))
    AND (SELECT private.current_role()) IS NOT NULL
    AND private.can_select_maintenance_request(request.id)
$function$;

COMMENT ON FUNCTION public.list_request_reporter_names(bigint[]) IS
  'Display name of the landlord who filed each given request, for requests the caller can see. Name only; never email, phone or notes.';

REVOKE ALL ON FUNCTION public.list_request_reporter_names(bigint[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.list_request_reporter_names(bigint[]) TO authenticated, service_role;
