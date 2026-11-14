-- WS-S S2 hygiene #5: require auth.users.email_confirmed_at before Approve.
-- Server gate in set_account_status; list_user_accounts_for_admin exposes the
-- timestamp so the Users UI can badge/disable Approve for unverified emails.
-- One concern: email confirmation before approval (no last-admin / photo / Settings).

-- ── list RPC: add email_confirmed_at (return type change → DROP + CREATE) ──

DROP FUNCTION IF EXISTS public.list_user_accounts_for_admin();

CREATE FUNCTION public.list_user_accounts_for_admin()
RETURNS TABLE (
  user_id uuid,
  email text,
  role public.app_role,
  landlord_id bigint,
  tenant_id bigint,
  staff_id bigint,
  account_status text,
  created_at timestamptz,
  email_confirmed_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF NOT private.is_admin() THEN
    RAISE EXCEPTION 'Only admins can list user accounts';
  END IF;

  RETURN QUERY
  SELECT
    u.id AS user_id,
    u.email::text,
    ur.role,
    ur.landlord_id,
    ur.tenant_id,
    ur.staff_id,
    COALESCE(ur.account_status, 'pending') AS account_status,
    COALESCE(ur.created_at, u.created_at) AS created_at,
    u.email_confirmed_at
  FROM auth.users u
  LEFT JOIN public.user_roles ur ON ur.user_id = u.id
  ORDER BY
    CASE COALESCE(ur.account_status, 'pending')
      WHEN 'pending' THEN 0
      WHEN 'approved' THEN 1
      WHEN 'suspended' THEN 2
      WHEN 'rejected' THEN 3
      ELSE 4
    END,
    u.created_at DESC;
END;
$function$;

REVOKE ALL ON FUNCTION public.list_user_accounts_for_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_user_accounts_for_admin() FROM anon;
GRANT EXECUTE ON FUNCTION public.list_user_accounts_for_admin() TO authenticated;

COMMENT ON FUNCTION public.list_user_accounts_for_admin IS
  'Admin-only: auth users + user_roles + email + email_confirmed_at for the approval queue.';

-- ── set_account_status: refuse Approve when email is unconfirmed ──
-- Body from 20261114020000 + email_confirmed_at gate on approve path.

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
  'Admin-only account_status change. Approve requires email_confirmed_at and admin/maintenance+staff/tenant+tenant/landlord+landlord. Non-approve UPDATEs existing rows; INSERTs unlinked maintenance only when no row exists.';
