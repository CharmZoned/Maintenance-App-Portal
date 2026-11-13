-- Phase 1: account_status + RLS for portfolio tables + admin write policies
-- Additive only. Does not alter inquiries policies (website service-role flow).
--
-- account_status choice:
--   - New user_roles rows default to 'pending' (Phase 2 will enforce).
--   - Phase 1 app gate does NOT block pending; bootstrap admin should be set to
--     'approved' after private.assign_admin(email). Missing/NULL treated as
--     allowed for Phase 1 bootstrap only.
--
-- Also: Tenants.unit_id made nullable so staff can create tenants before lease.

-- ── account_status on user_roles ──────────────────────────────────
ALTER TABLE public.user_roles
  ADD COLUMN IF NOT EXISTS account_status text NOT NULL DEFAULT 'pending';

ALTER TABLE public.user_roles
  DROP CONSTRAINT IF EXISTS user_roles_account_status_check;

ALTER TABLE public.user_roles
  ADD CONSTRAINT user_roles_account_status_check
  CHECK (account_status IN ('pending', 'approved', 'rejected', 'suspended'));

COMMENT ON COLUMN public.user_roles.account_status IS
  'User account approval: pending|approved|rejected|suspended. Phase 2 enforces; Phase 1 bootstrap admin set approved manually.';

-- Mark existing admins approved (bootstrap-friendly)
UPDATE public.user_roles
SET account_status = 'approved'
WHERE role = 'admin'::public.app_role
  AND account_status = 'pending';

-- Update assign_admin to also set approved
CREATE OR REPLACE FUNCTION private.assign_admin(admin_email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
  target uuid;
begin
  select id into target
  from auth.users
  where lower(email) = lower(admin_email);

  if target is null then
    raise exception 'No Auth user with that email';
  end if;

  insert into public.user_roles (user_id, role, account_status)
  values (target, 'admin', 'approved')
  on conflict (user_id) do update
    set role = 'admin',
        landlord_id = null,
        tenant_id = null,
        staff_id = null,
        account_status = 'approved';
end;
$function$;

-- ── Tenants.unit_id nullable (create before lease) ────────────────
ALTER TABLE public."Tenants"
  ALTER COLUMN unit_id DROP NOT NULL;

-- Defaults for required booleans when inserting from portal
ALTER TABLE public."Tenants"
  ALTER COLUMN primary_on_lease SET DEFAULT false;
ALTER TABLE public."Tenants"
  ALTER COLUMN invite_to_app SET DEFAULT false;
ALTER TABLE public."Staff"
  ALTER COLUMN gets_request_alerts SET DEFAULT true;

-- ── Helper: is_admin / is_staff_or_admin ──────────────────────────
CREATE OR REPLACE FUNCTION private.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT (SELECT private.current_role()) = 'admin'::public.app_role;
$function$;

CREATE OR REPLACE FUNCTION private.is_staff_or_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT (SELECT private.current_role()) IN ('admin'::public.app_role, 'maintenance'::public.app_role);
$function$;

-- ── Admin write policies on core tables (were select-only) ────────

-- Landlords
DROP POLICY IF EXISTS landlords_admin_insert ON public."Landlords";
CREATE POLICY landlords_admin_insert ON public."Landlords"
  FOR INSERT TO authenticated
  WITH CHECK (private.is_admin());

DROP POLICY IF EXISTS landlords_admin_update ON public."Landlords";
CREATE POLICY landlords_admin_update ON public."Landlords"
  FOR UPDATE TO authenticated
  USING (private.is_admin())
  WITH CHECK (private.is_admin());

DROP POLICY IF EXISTS landlords_admin_delete ON public."Landlords";
CREATE POLICY landlords_admin_delete ON public."Landlords"
  FOR DELETE TO authenticated
  USING (private.is_admin());

-- Properties
DROP POLICY IF EXISTS properties_admin_insert ON public."Properties";
CREATE POLICY properties_admin_insert ON public."Properties"
  FOR INSERT TO authenticated
  WITH CHECK (private.is_admin());

DROP POLICY IF EXISTS properties_admin_update ON public."Properties";
CREATE POLICY properties_admin_update ON public."Properties"
  FOR UPDATE TO authenticated
  USING (private.is_admin())
  WITH CHECK (private.is_admin());

DROP POLICY IF EXISTS properties_admin_delete ON public."Properties";
CREATE POLICY properties_admin_delete ON public."Properties"
  FOR DELETE TO authenticated
  USING (private.is_admin());

DROP POLICY IF EXISTS properties_landlord_insert ON public."Properties";
CREATE POLICY properties_landlord_insert ON public."Properties"
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT private.current_role()) = 'landlord'::public.app_role
    AND landlord_id = (SELECT private.current_landlord_id())
  );

DROP POLICY IF EXISTS properties_landlord_update ON public."Properties";
CREATE POLICY properties_landlord_update ON public."Properties"
  FOR UPDATE TO authenticated
  USING (
    (SELECT private.current_role()) = 'landlord'::public.app_role
    AND landlord_id = (SELECT private.current_landlord_id())
  )
  WITH CHECK (
    (SELECT private.current_role()) = 'landlord'::public.app_role
    AND landlord_id = (SELECT private.current_landlord_id())
  );

-- Units
DROP POLICY IF EXISTS units_admin_write ON public."Units";
CREATE POLICY units_admin_insert ON public."Units"
  FOR INSERT TO authenticated
  WITH CHECK (private.is_admin());

DROP POLICY IF EXISTS units_admin_update ON public."Units";
CREATE POLICY units_admin_update ON public."Units"
  FOR UPDATE TO authenticated
  USING (private.is_admin())
  WITH CHECK (private.is_admin());

DROP POLICY IF EXISTS units_admin_delete ON public."Units";
CREATE POLICY units_admin_delete ON public."Units"
  FOR DELETE TO authenticated
  USING (private.is_admin());

-- Tenants
DROP POLICY IF EXISTS tenants_admin_insert ON public."Tenants";
CREATE POLICY tenants_admin_insert ON public."Tenants"
  FOR INSERT TO authenticated
  WITH CHECK (private.is_admin());

DROP POLICY IF EXISTS tenants_admin_update ON public."Tenants";
CREATE POLICY tenants_admin_update ON public."Tenants"
  FOR UPDATE TO authenticated
  USING (private.is_admin())
  WITH CHECK (private.is_admin());

DROP POLICY IF EXISTS tenants_admin_delete ON public."Tenants";
CREATE POLICY tenants_admin_delete ON public."Tenants"
  FOR DELETE TO authenticated
  USING (private.is_admin());

-- Staff
DROP POLICY IF EXISTS staff_admin_insert ON public."Staff";
CREATE POLICY staff_admin_insert ON public."Staff"
  FOR INSERT TO authenticated
  WITH CHECK (private.is_admin());

DROP POLICY IF EXISTS staff_admin_update ON public."Staff";
CREATE POLICY staff_admin_update ON public."Staff"
  FOR UPDATE TO authenticated
  USING (private.is_admin())
  WITH CHECK (private.is_admin());

DROP POLICY IF EXISTS staff_admin_delete ON public."Staff";
CREATE POLICY staff_admin_delete ON public."Staff"
  FOR DELETE TO authenticated
  USING (private.is_admin());

-- ── Leases ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS leases_select ON public."Leases";
CREATE POLICY leases_select ON public."Leases"
  FOR SELECT TO authenticated
  USING (
    private.is_admin()
    OR private.landlord_owns_unit(unit_id)
    OR unit_id = (SELECT private.current_tenant_unit_id())
    OR private.staff_assigned_to_unit(unit_id)
  );

DROP POLICY IF EXISTS leases_admin_insert ON public."Leases";
CREATE POLICY leases_admin_insert ON public."Leases"
  FOR INSERT TO authenticated
  WITH CHECK (private.is_admin());

DROP POLICY IF EXISTS leases_admin_update ON public."Leases";
CREATE POLICY leases_admin_update ON public."Leases"
  FOR UPDATE TO authenticated
  USING (private.is_admin())
  WITH CHECK (private.is_admin());

DROP POLICY IF EXISTS leases_admin_delete ON public."Leases";
CREATE POLICY leases_admin_delete ON public."Leases"
  FOR DELETE TO authenticated
  USING (private.is_admin());

-- ── LeaseTenants ──────────────────────────────────────────────────
DROP POLICY IF EXISTS lease_tenants_select ON public."LeaseTenants";
CREATE POLICY lease_tenants_select ON public."LeaseTenants"
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public."Leases" AS l
      WHERE l.id = lease_id
        AND (
          private.is_admin()
          OR private.landlord_owns_unit(l.unit_id)
          OR l.unit_id = (SELECT private.current_tenant_unit_id())
          OR private.staff_assigned_to_unit(l.unit_id)
        )
    )
  );

DROP POLICY IF EXISTS lease_tenants_admin_insert ON public."LeaseTenants";
CREATE POLICY lease_tenants_admin_insert ON public."LeaseTenants"
  FOR INSERT TO authenticated
  WITH CHECK (private.is_admin());

DROP POLICY IF EXISTS lease_tenants_admin_delete ON public."LeaseTenants";
CREATE POLICY lease_tenants_admin_delete ON public."LeaseTenants"
  FOR DELETE TO authenticated
  USING (private.is_admin());

-- ── RentCharges ───────────────────────────────────────────────────
DROP POLICY IF EXISTS rent_charges_select ON public."RentCharges";
CREATE POLICY rent_charges_select ON public."RentCharges"
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public."Leases" AS l
      WHERE l.id = lease_id
        AND (
          private.is_admin()
          OR private.landlord_owns_unit(l.unit_id)
          OR l.unit_id = (SELECT private.current_tenant_unit_id())
          OR private.staff_assigned_to_unit(l.unit_id)
        )
    )
  );

DROP POLICY IF EXISTS rent_charges_admin_insert ON public."RentCharges";
CREATE POLICY rent_charges_admin_insert ON public."RentCharges"
  FOR INSERT TO authenticated
  WITH CHECK (private.is_admin());

DROP POLICY IF EXISTS rent_charges_admin_update ON public."RentCharges";
CREATE POLICY rent_charges_admin_update ON public."RentCharges"
  FOR UPDATE TO authenticated
  USING (private.is_admin())
  WITH CHECK (private.is_admin());

DROP POLICY IF EXISTS rent_charges_admin_delete ON public."RentCharges";
CREATE POLICY rent_charges_admin_delete ON public."RentCharges"
  FOR DELETE TO authenticated
  USING (private.is_admin());

-- ── Payments ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS payments_select ON public."Payments";
CREATE POLICY payments_select ON public."Payments"
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public."RentCharges" AS c
      JOIN public."Leases" AS l ON l.id = c.lease_id
      WHERE c.id = charge_id
        AND (
          private.is_admin()
          OR private.landlord_owns_unit(l.unit_id)
          OR l.unit_id = (SELECT private.current_tenant_unit_id())
          OR private.staff_assigned_to_unit(l.unit_id)
        )
    )
  );

DROP POLICY IF EXISTS payments_admin_insert ON public."Payments";
CREATE POLICY payments_admin_insert ON public."Payments"
  FOR INSERT TO authenticated
  WITH CHECK (private.is_admin());

DROP POLICY IF EXISTS payments_admin_update ON public."Payments";
CREATE POLICY payments_admin_update ON public."Payments"
  FOR UPDATE TO authenticated
  USING (private.is_admin())
  WITH CHECK (private.is_admin());

DROP POLICY IF EXISTS payments_admin_delete ON public."Payments";
CREATE POLICY payments_admin_delete ON public."Payments"
  FOR DELETE TO authenticated
  USING (private.is_admin());

-- ── Vendors ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS vendors_select ON public."Vendors";
CREATE POLICY vendors_select ON public."Vendors"
  FOR SELECT TO authenticated
  USING (private.is_staff_or_admin() OR (SELECT private.current_role()) = 'landlord'::public.app_role);

DROP POLICY IF EXISTS vendors_admin_insert ON public."Vendors";
CREATE POLICY vendors_admin_insert ON public."Vendors"
  FOR INSERT TO authenticated
  WITH CHECK (private.is_admin());

DROP POLICY IF EXISTS vendors_admin_update ON public."Vendors";
CREATE POLICY vendors_admin_update ON public."Vendors"
  FOR UPDATE TO authenticated
  USING (private.is_admin())
  WITH CHECK (private.is_admin());

DROP POLICY IF EXISTS vendors_admin_delete ON public."Vendors";
CREATE POLICY vendors_admin_delete ON public."Vendors"
  FOR DELETE TO authenticated
  USING (private.is_admin());

-- ── Settings ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS settings_select ON public."Settings";
CREATE POLICY settings_select ON public."Settings"
  FOR SELECT TO authenticated
  USING (private.is_staff_or_admin());

DROP POLICY IF EXISTS settings_admin_insert ON public."Settings";
CREATE POLICY settings_admin_insert ON public."Settings"
  FOR INSERT TO authenticated
  WITH CHECK (private.is_admin());

DROP POLICY IF EXISTS settings_admin_update ON public."Settings";
CREATE POLICY settings_admin_update ON public."Settings"
  FOR UPDATE TO authenticated
  USING (private.is_admin())
  WITH CHECK (private.is_admin());

DROP POLICY IF EXISTS settings_admin_delete ON public."Settings";
CREATE POLICY settings_admin_delete ON public."Settings"
  FOR DELETE TO authenticated
  USING (private.is_admin());

-- MaintenanceRequests: allow admin delete for portal parity
DROP POLICY IF EXISTS maintenance_requests_admin_delete ON public."MaintenanceRequests";
CREATE POLICY maintenance_requests_admin_delete ON public."MaintenanceRequests"
  FOR DELETE TO authenticated
  USING (private.is_admin());
