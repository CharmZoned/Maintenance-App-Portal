-- WS-S S2 hygiene #4: refuse demote / suspend / reject that would leave zero
-- approved admins. Preserves email_confirmed_at Approve gate from 20261114070000.
-- One concern: last-admin lockout guard (no photo cap / MIME / Settings).

CREATE OR REPLACE FUNCTION private.count_approved_admins()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT count(*)::integer
  FROM public.user_roles
  WHERE role = 'admin'::public.app_role
    AND account_status = 'approved';
$function$;

COMMENT ON FUNCTION private.count_approved_admins IS
  'Count of approved admin role rows — used by last-admin lockout guards.';

CREATE OR REPLACE FUNCTION private.assert_not_removing_last_approved_admin(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_role public.app_role;
  v_status text;
BEGIN
  SELECT role, account_status INTO v_role, v_status
  FROM public.user_roles
  WHERE user_id = p_user_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_role = 'admin'::public.app_role
     AND v_status = 'approved'
     AND private.count_approved_admins() <= 1 THEN
    RAISE EXCEPTION 'Cannot remove the last approved admin';
  END IF;
END;
$function$;

COMMENT ON FUNCTION private.assert_not_removing_last_approved_admin IS
  'Raises when p_user_id is the sole approved admin (demote/suspend/reject would lock out).';

-- ── set_account_status: last-admin guard on non-approve transitions ──
-- Body from 20261114070000 + last-admin assert before leaving approved.

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
    IF NOT EXISTS (
      SELECT 1
      FROM auth.users
      WHERE id = p_user_id
        AND email_confirmed_at IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'Email must be confirmed before approving';
    END IF;

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

  -- Leaving approved (or inventing a non-approve row): block sole-admin lockout.
  PERFORM private.assert_not_removing_last_approved_admin(p_user_id);

  -- Non-approve: update in place when a role row exists (keeps landlord/tenant/staff links).
  -- INSERT only invents a pending/rejected/suspended maintenance queue row when missing.
  UPDATE public.user_roles
  SET account_status = p_status
  WHERE user_id = p_user_id
  RETURNING * INTO result;

  IF FOUND THEN
    RETURN result;
  END IF;

  INSERT INTO public.user_roles (user_id, role, account_status)
  VALUES (p_user_id, 'maintenance'::public.app_role, p_status)
  RETURNING * INTO result;

  RETURN result;
END;
$function$;

COMMENT ON FUNCTION public.set_account_status IS
  'Admin-only account_status change. Approve requires email_confirmed_at and admin/maintenance+staff/tenant+tenant/landlord+landlord. Non-approve refuses sole approved-admin lockout; UPDATEs existing rows; INSERTs unlinked maintenance only when no row exists.';

-- ── admin_set_user_role: refuse demoting the last approved admin ──

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
  v_prev_role public.app_role;
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

  SELECT role, account_status INTO v_prev_role, v_status
  FROM public.user_roles
  WHERE user_id = p_user_id;

  -- Demoting an approved admin away from admin would remove them from the admin pool.
  IF FOUND
     AND v_prev_role = 'admin'::public.app_role
     AND COALESCE(v_status, 'pending') = 'approved'
     AND p_role IS DISTINCT FROM 'admin'::public.app_role THEN
    PERFORM private.assert_not_removing_last_approved_admin(p_user_id);
  END IF;

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
  'Admin assigns role + link ids. Approved maintenance/tenant/landlord require their link id; clearing a link while approved is blocked. Demoting the last approved admin is refused.';
