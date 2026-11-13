-- LGA-18: approve linked landlords; allow landlord portal access (thin read-only shell).
--
-- Read-only must hold at the database, not just in the UI: approving a landlord
-- would otherwise activate the Phase 1 landlord write policies. This migration
-- therefore includes the LGA-19 (#14) landlord write lockdown, identical SQL,
-- so it is safe whichever of the two lands first. All statements are idempotent.

-- ── Landlord write lockdown (same as LGA-19 #14) ──────────────────

DROP POLICY IF EXISTS properties_landlord_insert ON public."Properties";
DROP POLICY IF EXISTS properties_landlord_update ON public."Properties";

-- Single UPDATE predicate shared with comment/photo write paths: admin or assigned maintenance.
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

DROP POLICY IF EXISTS maintenance_requests_update ON public."MaintenanceRequests";
CREATE POLICY maintenance_requests_update ON public."MaintenanceRequests"
  FOR UPDATE
  TO authenticated
  USING (private.can_update_maintenance_request(id))
  -- NEW-row check (same as #14 20261113252100): the helper SELECTs by id, i.e. the old row.
  WITH CHECK (
    (SELECT private.current_role()) = 'admin'::public.app_role
    OR (
      (SELECT private.current_role()) = 'maintenance'::public.app_role
      AND assigned_staff_id = (SELECT private.current_staff_id())
    )
  );

-- ── Comments: landlords see tenant_visible only ───────────────────
-- Live policy let landlord read `internal` staff comments (only admin/maintenance should).

DROP POLICY IF EXISTS maintenance_comments_select ON public."MaintenanceRequestComments";
CREATE POLICY maintenance_comments_select ON public."MaintenanceRequestComments"
  FOR SELECT
  TO authenticated
  USING (
    (SELECT private.can_select_maintenance_request(maintenance_request_id))
    AND (
      visibility = 'tenant_visible'
      OR (SELECT private.current_role()) = ANY (
        ARRAY['admin'::public.app_role, 'maintenance'::public.app_role]
      )
    )
  );

-- ── Harden current_landlord_id (parity with tenant helpers) ───────

CREATE OR REPLACE FUNCTION private.current_landlord_id()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT landlord_id
  FROM public.user_roles
  WHERE user_id = (SELECT auth.uid())
    AND account_status = 'approved'
    AND role = 'landlord'::public.app_role
$function$;

-- ── Approve linked landlords ──────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_account_status(
  p_user_id uuid,
  p_status text
)
RETURNS public.user_roles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  result public.user_roles;
BEGIN
  IF NOT private.is_admin() THEN
    RAISE EXCEPTION 'Only admins can change account status';
  END IF;

  IF p_status IS NULL OR p_status NOT IN ('pending', 'approved', 'rejected', 'suspended') THEN
    RAISE EXCEPTION 'Invalid account_status: %', p_status;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'Auth user % not found', p_user_id;
  END IF;

  IF p_status = 'approved' THEN
    SELECT * INTO result FROM public.user_roles WHERE user_id = p_user_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Assign a role before approving';
    END IF;
    IF result.role = 'admin'::public.app_role THEN
      NULL;
    ELSIF result.role = 'maintenance'::public.app_role AND result.staff_id IS NOT NULL THEN
      NULL;
    ELSIF result.role = 'tenant'::public.app_role AND result.tenant_id IS NOT NULL THEN
      NULL;
    ELSIF result.role = 'landlord'::public.app_role AND result.landlord_id IS NOT NULL THEN
      NULL;
    ELSE
      RAISE EXCEPTION
        'Only admin, maintenance with Staff link, tenant with Tenant link, or landlord with Landlord link can be approved';
    END IF;

    UPDATE public.user_roles
    SET account_status = 'approved'
    WHERE user_id = p_user_id
    RETURNING * INTO result;

    RETURN result;
  END IF;

  INSERT INTO public.user_roles (user_id, role, account_status)
  VALUES (p_user_id, 'maintenance'::public.app_role, p_status)
  ON CONFLICT (user_id) DO UPDATE
    SET account_status = EXCLUDED.account_status
  RETURNING * INTO result;

  RETURN result;
END;
$function$;

COMMENT ON FUNCTION public.set_account_status IS
  'Admin-only account_status change. Approve requires admin, maintenance+staff_id, tenant+tenant_id, or landlord+landlord_id.';

CREATE OR REPLACE FUNCTION public.admin_set_user_role(
  p_user_id uuid,
  p_role public.app_role,
  p_landlord_id bigint DEFAULT NULL,
  p_tenant_id bigint DEFAULT NULL,
  p_staff_id bigint DEFAULT NULL
)
RETURNS public.user_roles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  result public.user_roles;
  v_landlord bigint;
  v_tenant bigint;
  v_staff bigint;
  v_status text;
BEGIN
  IF NOT private.is_admin() THEN
    RAISE EXCEPTION 'Only admins can assign user roles';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'Auth user % not found', p_user_id;
  END IF;

  v_landlord := NULL;
  v_tenant := NULL;
  v_staff := NULL;

  IF p_role = 'admin'::public.app_role THEN
    NULL;
  ELSIF p_role = 'landlord'::public.app_role THEN
    v_landlord := p_landlord_id;
  ELSIF p_role = 'tenant'::public.app_role THEN
    v_tenant := p_tenant_id;
  ELSIF p_role = 'maintenance'::public.app_role THEN
    v_staff := p_staff_id;
  ELSE
    RAISE EXCEPTION 'Unsupported role: %', p_role;
  END IF;

  SELECT account_status INTO v_status
  FROM public.user_roles
  WHERE user_id = p_user_id;

  IF COALESCE(v_status, 'pending') = 'approved' THEN
    IF p_role = 'maintenance'::public.app_role AND v_staff IS NULL THEN
      RAISE EXCEPTION
        'Cannot clear Staff link while approved; suspend or reject first, or keep a Staff link';
    END IF;
    IF p_role = 'tenant'::public.app_role AND v_tenant IS NULL THEN
      RAISE EXCEPTION
        'Cannot clear Tenant link while approved; suspend or reject first, or keep a Tenant link';
    END IF;
    IF p_role = 'landlord'::public.app_role AND v_landlord IS NULL THEN
      RAISE EXCEPTION
        'Cannot clear Landlord link while approved; suspend or reject first, or keep a Landlord link';
    END IF;
  END IF;

  INSERT INTO public.user_roles (
    user_id, role, landlord_id, tenant_id, staff_id, account_status
  )
  VALUES (
    p_user_id,
    p_role,
    v_landlord,
    v_tenant,
    v_staff,
    COALESCE(v_status, 'pending')
  )
  ON CONFLICT (user_id) DO UPDATE
    SET role = EXCLUDED.role,
        landlord_id = EXCLUDED.landlord_id,
        tenant_id = EXCLUDED.tenant_id,
        staff_id = EXCLUDED.staff_id
  RETURNING * INTO result;

  RETURN result;
END;
$function$;

COMMENT ON FUNCTION public.admin_set_user_role IS
  'Admin assigns role + link ids. Approved maintenance/tenant/landlord require their link id; clearing a link while approved is blocked.';
