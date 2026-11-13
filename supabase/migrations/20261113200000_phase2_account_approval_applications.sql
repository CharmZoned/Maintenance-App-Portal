-- Phase 2: account approval RPCs + Applications RLS
-- Additive only. Does not alter inquiries (website service-role flow).
--
-- - Signup with no Landlord/Tenant/Staff email match → pending maintenance row
-- - Admin lists Auth users + roles (email via SECURITY DEFINER; no service role in client)
-- - Admin-only set_account_status / admin_set_user_role (non-admins cannot self-approve)
-- - Applications: staff/admin read+write policies + FORCE RLS

-- ── handle_new_user: unmatched signup → pending maintenance ───────
CREATE OR REPLACE FUNCTION private.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
  matched_landlord bigint;
  matched_tenant bigint;
  matched_staff bigint;
  matches integer;
begin
  select id into matched_landlord
  from public."Landlords"
  where lower(email) = lower(new.email);

  select id into matched_tenant
  from public."Tenants"
  where lower(email) = lower(new.email);

  select id into matched_staff
  from public."Staff"
  where lower(email) = lower(new.email);

  matches := (matched_landlord is not null)::integer
    + (matched_tenant is not null)::integer
    + (matched_staff is not null)::integer;

  if matches = 1 then
    if matched_landlord is not null then
      insert into public.user_roles (user_id, role, landlord_id, account_status)
      values (new.id, 'landlord', matched_landlord, 'pending');
    elsif matched_tenant is not null then
      insert into public.user_roles (user_id, role, tenant_id, account_status)
      values (new.id, 'tenant', matched_tenant, 'pending');
    else
      insert into public.user_roles (user_id, role, staff_id, account_status)
      values (new.id, 'maintenance', matched_staff, 'pending');
    end if;
  elsif matches = 0 then
    -- Public signup with no portfolio match: queue for admin approval
    insert into public.user_roles (user_id, role, account_status)
    values (new.id, 'maintenance', 'pending');
  end if;
  -- matches > 1: ambiguous email — leave without a role (admin assigns manually)

  return new;
exception
  when unique_violation then
    return new;
end;
$function$;

COMMENT ON FUNCTION private.handle_new_user() IS
  'Auth trigger: match Landlord/Tenant/Staff email → pending role; unmatched → pending maintenance for approval queue.';

-- ── Admin list (email from auth.users; never expose via client service role) ──
CREATE OR REPLACE FUNCTION public.list_user_accounts_for_admin()
RETURNS TABLE (
  user_id uuid,
  email text,
  role public.app_role,
  landlord_id bigint,
  tenant_id bigint,
  staff_id bigint,
  account_status text,
  created_at timestamptz
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
    COALESCE(ur.created_at, u.created_at) AS created_at
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

-- ── set_account_status (upsert role row if missing) ───────────────
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

  -- Approve never invents an unlinked maintenance row (see also
  -- 20261113203000_phase2_authz_approve_staff_gate.sql for full gate).
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

  INSERT INTO public.user_roles (user_id, role, account_status)
  VALUES (p_user_id, 'maintenance'::public.app_role, p_status)
  ON CONFLICT (user_id) DO UPDATE
    SET account_status = EXCLUDED.account_status
  RETURNING * INTO result;

  RETURN result;
END;
$function$;

-- ── admin_set_user_role (role + link ids; clears irrelevant links) ─
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
    NULL; -- no link ids
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

REVOKE ALL ON FUNCTION public.list_user_accounts_for_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_user_accounts_for_admin() FROM anon;
REVOKE ALL ON FUNCTION public.set_account_status(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_account_status(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.admin_set_user_role(uuid, public.app_role, bigint, bigint, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_user_role(uuid, public.app_role, bigint, bigint, bigint) FROM anon;
GRANT EXECUTE ON FUNCTION public.list_user_accounts_for_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_account_status(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_user_role(uuid, public.app_role, bigint, bigint, bigint) TO authenticated;

COMMENT ON FUNCTION public.list_user_accounts_for_admin IS
  'Phase 2: admin-only Auth users + user_roles with email (SECURITY DEFINER).';
COMMENT ON FUNCTION public.set_account_status IS
  'Phase 2: admin-only pending|approved|rejected|suspended; upserts maintenance row if missing.';
COMMENT ON FUNCTION public.admin_set_user_role IS
  'Phase 2: admin-only role + link-id assignment; clears irrelevant link columns.';

-- ── Applications RLS (staff/admin) + FORCE ────────────────────────
ALTER TABLE public."Applications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Applications" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS applications_select ON public."Applications";
CREATE POLICY applications_select ON public."Applications"
  FOR SELECT TO authenticated
  USING (private.is_staff_or_admin());

DROP POLICY IF EXISTS applications_insert ON public."Applications";
CREATE POLICY applications_insert ON public."Applications"
  FOR INSERT TO authenticated
  WITH CHECK (private.is_staff_or_admin());

DROP POLICY IF EXISTS applications_update ON public."Applications";
CREATE POLICY applications_update ON public."Applications"
  FOR UPDATE TO authenticated
  USING (private.is_staff_or_admin())
  WITH CHECK (private.is_staff_or_admin());

DROP POLICY IF EXISTS applications_delete ON public."Applications";
CREATE POLICY applications_delete ON public."Applications"
  FOR DELETE TO authenticated
  USING (private.is_admin());

COMMENT ON TABLE public."Applications" IS
  'Rental applicants (not account approval). Phase 2: staff/admin CRUD; delete admin-only.';
