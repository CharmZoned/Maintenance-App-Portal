-- Phase 1 follow-up: enforce account_status === 'approved' in private helpers.
-- Pending/rejected/suspended users no longer receive a role from current_role(),
-- so existing RLS that keys off current_role()/is_admin() denies portfolio access.
-- user_roles_select_own remains so the client can read status for the blocked UI.

CREATE OR REPLACE FUNCTION private.current_role()
RETURNS app_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  select role
  from public.user_roles
  where user_id = (select auth.uid())
    and account_status = 'approved'
$function$;

CREATE OR REPLACE FUNCTION private.current_landlord_id()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  select landlord_id
  from public.user_roles
  where user_id = (select auth.uid())
    and account_status = 'approved'
$function$;

CREATE OR REPLACE FUNCTION private.current_tenant_id()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  select tenant_id
  from public.user_roles
  where user_id = (select auth.uid())
    and account_status = 'approved'
$function$;

CREATE OR REPLACE FUNCTION private.current_staff_id()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  select staff_id
  from public.user_roles
  where user_id = (select auth.uid())
    and account_status = 'approved'
$function$;

CREATE OR REPLACE FUNCTION private.is_admin()
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
      AND role = 'admin'::public.app_role
      AND account_status = 'approved'
  );
$function$;

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
      AND role IN ('admin'::public.app_role, 'maintenance'::public.app_role)
      AND account_status = 'approved'
  );
$function$;

COMMENT ON FUNCTION private.current_role() IS
  'Returns app_role only when account_status is approved; otherwise NULL (RLS deny).';
