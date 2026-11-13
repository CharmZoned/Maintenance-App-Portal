-- WS-B (Wave 1): fix unmatched signup + admin reject/suspend (B1 + B2).
--
-- B1: user_roles_subject_matches_role required maintenance.staff_id NOT NULL,
--     but private.handle_new_user inserts unmatched signups as pending
--     maintenance with staff_id NULL → CHECK fails / no queue row.
-- B2: set_account_status non-approve path used INSERT…ON CONFLICT; Postgres
--     validates the INSERT candidate against CHECKs before applying the
--     conflict UPDATE, so reject/suspend of existing tenant/landlord/worker
--     rows (and inventing a queue row for no-role users) failed.
--
-- Latest set_account_status / approve gates: 20261113241000 (LGA-18).
-- handle_new_user body unchanged (already correct once the CHECK allows it).

-- ── B1: allow unlinked maintenance only while not approved ────────

ALTER TABLE public.user_roles
  DROP CONSTRAINT IF EXISTS user_roles_subject_matches_role;

ALTER TABLE public.user_roles
  ADD CONSTRAINT user_roles_subject_matches_role CHECK (
    (
      role = 'admin'::public.app_role
      AND landlord_id IS NULL
      AND tenant_id IS NULL
      AND staff_id IS NULL
    )
    OR (
      role = 'landlord'::public.app_role
      AND landlord_id IS NOT NULL
      AND tenant_id IS NULL
      AND staff_id IS NULL
    )
    OR (
      role = 'tenant'::public.app_role
      AND tenant_id IS NOT NULL
      AND landlord_id IS NULL
      AND staff_id IS NULL
    )
    OR (
      role = 'maintenance'::public.app_role
      AND landlord_id IS NULL
      AND tenant_id IS NULL
      AND (
        staff_id IS NOT NULL
        OR account_status IN ('pending', 'rejected', 'suspended')
      )
    )
  );

COMMENT ON CONSTRAINT user_roles_subject_matches_role ON public.user_roles IS
  'Role↔link shape. Maintenance may omit staff_id only when account_status is pending/rejected/suspended (approval queue); approved maintenance still requires staff_id.';

-- ── B2: UPDATE existing; INSERT only when missing ─────────────────
-- Preserve LGA-18 approve gates (admin / maint+staff / tenant+tenant / landlord+landlord).

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
  'Admin-only account_status change. Approve requires admin, maintenance+staff_id, tenant+tenant_id, or landlord+landlord_id. Non-approve UPDATEs existing rows; INSERTs unlinked maintenance only when no row exists.';
