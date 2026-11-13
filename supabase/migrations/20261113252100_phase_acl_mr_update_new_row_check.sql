-- LGA-19 follow-up: WO UPDATE USING stays on can_update_maintenance_request
-- (comments/photos share it). WITH CHECK uses NEW-row columns so reassignment
-- cannot slip past a helper that SELECTs by id (defense in depth vs
-- protect_maintenance_request). Version 20261113252100 avoids clash with
-- sibling PRs that also claimed 20261113240000.

DROP POLICY IF EXISTS maintenance_requests_update ON public."MaintenanceRequests";
CREATE POLICY maintenance_requests_update ON public."MaintenanceRequests"
  FOR UPDATE
  TO authenticated
  USING (private.can_update_maintenance_request(id))
  WITH CHECK (
    (SELECT private.current_role()) = 'admin'::public.app_role
    OR (
      (SELECT private.current_role()) = 'maintenance'::public.app_role
      AND assigned_staff_id = (SELECT private.current_staff_id())
    )
  );
