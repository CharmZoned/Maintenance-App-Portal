-- Account approval, fixed as one step (audit P0 "sign-ups can't be approved").
--
-- Before this file a public sign-up with no email match landed in user_roles as
-- role 'maintenance', account_status 'pending', no link. To approve them as a
-- tenant or owner the admin had to call admin_set_user_role('tenant') first,
-- which the user_roles_subject_matches_role CHECK refuses without a tenant_id,
-- while the Tenant picker only appeared once the role already was 'tenant'.
-- Deadlock. The person's own choice (tenant / owner), name and address were
-- saved as auth metadata the client cannot read for other users.
--
-- This file adds:
--   * list_user_accounts_for_admin(): + full_name, intent_role, signup_address,
--     phone from auth.users.raw_user_meta_data (admin-only, as before).
--   * admin_assign_account_role(): admin-only. Sets role + link (an existing
--     Tenant / Landlord / Staff row, or a new one created from the sign-up) and,
--     when p_approve, account_status = 'approved' — all in one statement, so the
--     CHECK only ever sees a finished row. Same gates as admin_set_user_role and
--     set_account_status: admin caller, auth user exists, email confirmed before
--     approve, last approved admin cannot be demoted, links cannot be cleared on
--     an approved account. Also refuses linking a record that another login
--     already holds (the user_roles_one_* unique indexes would otherwise answer
--     with a raw constraint error).
--
-- admin_set_user_role / set_account_status are unchanged and still used for
-- reject, suspend and re-approve.

-- ── list RPC: sign-up details (return type change → DROP + CREATE) ──

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
  email_confirmed_at timestamptz,
  full_name text,
  intent_role text,
  signup_address text,
  phone text
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
    u.email_confirmed_at,
    -- Client-writable metadata: clamp and allowlist, never trust for authz.
    left(nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''), 120) AS full_name,
    CASE
      WHEN u.raw_user_meta_data ->> 'intent_role' IN ('tenant', 'landlord')
        THEN u.raw_user_meta_data ->> 'intent_role'
      ELSE NULL
    END AS intent_role,
    left(nullif(btrim(u.raw_user_meta_data ->> 'signup_address'), ''), 300) AS signup_address,
    left(nullif(btrim(u.raw_user_meta_data ->> 'phone'), ''), 40) AS phone
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
  'Admin-only: auth users + user_roles + email_confirmed_at + sign-up name, chosen role (tenant/landlord), address and phone from auth metadata.';

-- ── admin_assign_account_role ───────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_assign_account_role(
  p_user_id uuid,
  p_role public.app_role,
  p_link_id bigint DEFAULT NULL,
  p_create jsonb DEFAULT NULL,
  p_approve boolean DEFAULT true
)
RETURNS public.user_roles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  result public.user_roles;
  v_found boolean;
  v_prev_role public.app_role;
  v_status text;
  v_new_status text;
  v_link bigint;
  v_label text;
  v_other_email text;
  v_first text;
  v_last text;
  v_email text;
  v_phone text;
  v_company text;
  v_title text;
  v_notes text;
  v_services text[];
BEGIN
  IF NOT private.is_admin() THEN
    RAISE EXCEPTION 'Only admins can assign or approve accounts' USING ERRCODE = '42501';
  END IF;

  IF p_role IS NULL THEN
    RAISE EXCEPTION 'Choose a role for this account';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'Auth user % not found', p_user_id;
  END IF;

  IF p_link_id IS NOT NULL AND p_create IS NOT NULL THEN
    RAISE EXCEPTION 'Link an existing record or create a new one, not both';
  END IF;

  v_label := CASE p_role
    WHEN 'tenant'::public.app_role THEN 'Tenant'
    WHEN 'landlord'::public.app_role THEN 'Landlord'
    WHEN 'maintenance'::public.app_role THEN 'Staff'
    ELSE NULL
  END;

  IF p_role = 'admin'::public.app_role AND (p_link_id IS NOT NULL OR p_create IS NOT NULL) THEN
    RAISE EXCEPTION 'Admin accounts are not linked to a Tenant, Landlord or Staff record';
  END IF;

  SELECT role, account_status INTO v_prev_role, v_status
  FROM public.user_roles
  WHERE user_id = p_user_id;
  v_found := FOUND;

  IF v_found
     AND v_prev_role = 'admin'::public.app_role
     AND COALESCE(v_status, 'pending') = 'approved'
     AND p_role IS DISTINCT FROM 'admin'::public.app_role THEN
    PERFORM private.assert_not_removing_last_approved_admin(p_user_id);
  END IF;

  IF p_approve AND NOT EXISTS (
    SELECT 1 FROM auth.users WHERE id = p_user_id AND email_confirmed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Email must be confirmed before approving';
  END IF;

  -- ── Resolve the subject record ──
  IF p_create IS NOT NULL THEN
    IF jsonb_typeof(p_create) <> 'object' THEN
      RAISE EXCEPTION 'Invalid new record details';
    END IF;
    v_first := left(nullif(btrim(p_create ->> 'first_name'), ''), 80);
    v_last := left(nullif(btrim(p_create ->> 'last_name'), ''), 80);
    v_email := lower(nullif(btrim(p_create ->> 'email'), ''));
    v_phone := left(nullif(btrim(p_create ->> 'phone'), ''), 40);
    v_company := left(nullif(btrim(p_create ->> 'company_name'), ''), 120);
    v_title := left(nullif(btrim(p_create ->> 'job_title'), ''), 120);
    v_notes := left(nullif(btrim(p_create ->> 'notes'), ''), 2000);

    IF v_first IS NULL OR v_last IS NULL THEN
      RAISE EXCEPTION 'First and last name are required to create a % record', v_label;
    END IF;
    IF v_email IS NULL OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
      RAISE EXCEPTION 'A valid email is required to create a % record', v_label;
    END IF;

    IF p_role = 'tenant'::public.app_role THEN
      IF EXISTS (SELECT 1 FROM private.tenants WHERE lower(email) = v_email) THEN
        RAISE EXCEPTION 'A Tenant record with this email already exists; link it instead'
          USING ERRCODE = '23505';
      END IF;
      -- Through the view so the INSTEAD OF trigger applies its defaults and gates.
      INSERT INTO public."Tenants" (first_name, last_name, email, mobile_phone, notes)
      VALUES (v_first, v_last, v_email, v_phone, v_notes)
      RETURNING id INTO v_link;
    ELSIF p_role = 'landlord'::public.app_role THEN
      IF EXISTS (SELECT 1 FROM public."Landlords" WHERE lower(email) = v_email) THEN
        RAISE EXCEPTION 'A Landlord record with this email already exists; link it instead'
          USING ERRCODE = '23505';
      END IF;
      INSERT INTO public."Landlords" (first_name, last_name, email, mobile_phone, company_name, notes)
      VALUES (v_first, v_last, v_email, v_phone, v_company, v_notes)
      RETURNING id INTO v_link;
    ELSIF p_role = 'maintenance'::public.app_role THEN
      IF EXISTS (SELECT 1 FROM public."Staff" WHERE lower(email) = v_email) THEN
        RAISE EXCEPTION 'A Staff record with this email already exists; link it instead'
          USING ERRCODE = '23505';
      END IF;
      IF p_create ? 'services' AND jsonb_typeof(p_create -> 'services') = 'array' THEN
        SELECT COALESCE(array_agg(value), '{}'::text[]) INTO v_services
        FROM jsonb_array_elements_text(p_create -> 'services');
      ELSE
        v_services := '{}'::text[];
      END IF;
      INSERT INTO public."Staff" (first_name, last_name, email, phone, company_name, job_title, services)
      VALUES (v_first, v_last, v_email, v_phone, v_company, v_title, v_services)
      RETURNING id INTO v_link;
    END IF;
  ELSE
    v_link := p_link_id;
    IF v_link IS NOT NULL THEN
      IF p_role = 'tenant'::public.app_role
         AND NOT EXISTS (SELECT 1 FROM private.tenants WHERE id = v_link) THEN
        RAISE EXCEPTION 'That Tenant record no longer exists';
      ELSIF p_role = 'landlord'::public.app_role
         AND NOT EXISTS (SELECT 1 FROM public."Landlords" WHERE id = v_link) THEN
        RAISE EXCEPTION 'That Landlord record no longer exists';
      ELSIF p_role = 'maintenance'::public.app_role
         AND NOT EXISTS (SELECT 1 FROM public."Staff" WHERE id = v_link) THEN
        RAISE EXCEPTION 'That Staff record no longer exists';
      END IF;
    END IF;
  END IF;

  -- ── Shape checks (plain-language versions of the CHECK constraint) ──
  v_new_status := CASE WHEN p_approve THEN 'approved' ELSE COALESCE(v_status, 'pending') END;

  IF v_label IS NOT NULL AND v_link IS NULL THEN
    IF v_new_status = 'approved' THEN
      RAISE EXCEPTION 'Choose a % record to link, or create one from this sign-up', v_label;
    END IF;
    IF p_role IN ('tenant'::public.app_role, 'landlord'::public.app_role) THEN
      RAISE EXCEPTION 'A % account needs a linked % record', lower(v_label), v_label;
    END IF;
  END IF;

  -- One login per record (user_roles_one_* unique indexes).
  IF v_link IS NOT NULL THEN
    SELECT u.email::text INTO v_other_email
    FROM public.user_roles ur
    JOIN auth.users u ON u.id = ur.user_id
    WHERE ur.user_id <> p_user_id
      AND (
        (p_role = 'tenant'::public.app_role AND ur.tenant_id = v_link)
        OR (p_role = 'landlord'::public.app_role AND ur.landlord_id = v_link)
        OR (p_role = 'maintenance'::public.app_role AND ur.staff_id = v_link)
      )
    LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'That % record is already linked to another login (%)', v_label, v_other_email
        USING ERRCODE = '23505';
    END IF;
  END IF;

  INSERT INTO public.user_roles (user_id, role, landlord_id, tenant_id, staff_id, account_status)
  VALUES (
    p_user_id,
    p_role,
    CASE WHEN p_role = 'landlord'::public.app_role THEN v_link END,
    CASE WHEN p_role = 'tenant'::public.app_role THEN v_link END,
    CASE WHEN p_role = 'maintenance'::public.app_role THEN v_link END,
    v_new_status
  )
  ON CONFLICT (user_id) DO UPDATE
    SET role = EXCLUDED.role,
        landlord_id = EXCLUDED.landlord_id,
        tenant_id = EXCLUDED.tenant_id,
        staff_id = EXCLUDED.staff_id,
        account_status = EXCLUDED.account_status
  RETURNING * INTO result;

  RETURN result;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_assign_account_role(uuid, public.app_role, bigint, jsonb, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_assign_account_role(uuid, public.app_role, bigint, jsonb, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_assign_account_role(uuid, public.app_role, bigint, jsonb, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_assign_account_role(uuid, public.app_role, bigint, jsonb, boolean) TO service_role;

COMMENT ON FUNCTION public.admin_assign_account_role(uuid, public.app_role, bigint, jsonb, boolean) IS
  'Admin-only. Sets role + link (existing id, or p_create {first_name,last_name,email,phone,company_name,job_title,notes,services} makes a new Tenant/Landlord/Staff row) and, when p_approve, approves — atomically. Same gates as admin_set_user_role + set_account_status (email confirmed, last admin, no clearing links while approved); refuses a record already linked to another login.';

-- ── Staff.active (Add team member) ──────────────────────────────────
-- Office flag only: inactive team members stay on old jobs but are shown as
-- inactive. Does not change access (that is account_status on user_roles).

ALTER TABLE public."Staff"
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public."Staff".active IS
  'Office flag: false = no longer takes new work. Portal access is still governed by user_roles.account_status.';

-- Staff was left SELECT-only for authenticated (like Landlords/Tenants before
-- 20261114010000), so the admin-only RLS policies staff_admin_insert /
-- staff_admin_update could never be reached from the portal. Grant the DML
-- those policies already gate; DELETE stays off (Staff rows anchor job history).
GRANT INSERT, UPDATE ON TABLE public."Staff" TO authenticated;

DO $$
DECLARE
  identity_sequence regclass;
BEGIN
  SELECT pg_get_serial_sequence('public."Staff"', 'id')::regclass INTO identity_sequence;
  IF identity_sequence IS NOT NULL THEN
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO authenticated', identity_sequence);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
