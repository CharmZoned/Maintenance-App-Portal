-- WS-S S2 hygiene #10: Settings admin-only RLS.
-- Before: settings_select used private.is_staff_or_admin(); DML already required is_admin().
-- After: SELECT + DML all require private.is_admin() so maintenance staff JWT
-- cannot read or mutate Settings via PostgREST.
-- Re-assert DML policies (unchanged predicates) so this file is the full intended ACL.

DROP POLICY IF EXISTS settings_select ON public."Settings";
DROP POLICY IF EXISTS settings_admin_select ON public."Settings";
CREATE POLICY settings_admin_select ON public."Settings"
  FOR SELECT TO authenticated
  USING (private.is_admin());

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
