-- Phase 2 follow-up (PR review): close AuthZ holes around approve / staff unlink.
-- - Never invent approved unlinked maintenance via set_account_status
-- - Refuse unlink/demote that leaves approved maintenance without staff_id
-- - Align is_staff_or_admin with portal gate (maintenance requires staff_id)

CREATE OR REPLACE FUNCTION private.is_staff_or_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = (SELECT auth.uid())
      AND account_status = 'approved'
      AND (
        role = 'admin'::public.app_role
        OR (
          role = 'maintenance'::public.app_role
          AND staff_id IS NOT NULL
        )
      )
  );
$function$;

COMMENT ON FUNCTION private.is_staff_or_admin() IS
  'Approved admin, or approved maintenance with staff_id (matches portal gate).';

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
    ELSE
      RAISE EXCEPTION
        'Only admin, or maintenance with a Staff link, can be approved for portal access';
    END IF;

    UPDATE public.user_roles
    SET account_status = 'approved'
    WHERE user_id = p_user_id
    RETURNING * INTO result;

    RETURN result;
  END IF;

  -- Non-approve: upsert is OK (pending/rejected/suspended) for orphan Auth users
  INSERT INTO public.user_roles (user_id, role, account_status)
  VALUES (p_user_id, 'maintenance'::public.app_role, p_status)
  ON CONFLICT (user_id) DO UPDATE
    SET account_status = EXCLUDED.account_status
  RETURNING * INTO result;

  RETURN result;
END;
$function$;

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

  -- While approved, keep portal-capable shape (admin or maintenance+staff)
  IF COALESCE(v_status, 'pending') = 'approved' THEN
    IF p_role = 'maintenance'::public.app_role AND v_staff IS NULL THEN
      RAISE EXCEPTION
        'Cannot clear Staff link while approved; suspend or reject first, or keep a Staff link';
    END IF;
    IF p_role IN ('landlord'::public.app_role, 'tenant'::public.app_role) THEN
      RAISE EXCEPTION
        'Cannot assign landlord/tenant while approved; suspend or reject first';
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

COMMENT ON FUNCTION public.set_account_status IS
  'Phase 2: admin-only status change. Approve requires existing admin or maintenance+staff_id row (never invents approved unlinked maintenance).';
COMMENT ON FUNCTION public.admin_set_user_role IS
  'Phase 2: admin-only role/link assignment; refuses approved→unlinked maintenance or landlord/tenant demote while approved.';
