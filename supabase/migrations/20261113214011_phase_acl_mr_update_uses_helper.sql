-- LGA-19 follow-up: MaintenanceRequests UPDATE policy calls
-- private.can_update_maintenance_request (single predicate with comments/photos).
-- Applied live as 20261113214011. Superseded in effect by
-- 20261113252100_phase_acl_mr_update_new_row_check (NEW-row WITH CHECK).
-- Recovered into the portal repo so migration history matches production.
-- Safe if already applied; no-op-equivalent when helper already matches.

DROP POLICY IF EXISTS maintenance_requests_update ON public."MaintenanceRequests";
CREATE POLICY maintenance_requests_update ON public."MaintenanceRequests"
  FOR UPDATE
  TO authenticated
  USING (private.can_update_maintenance_request(id))
  WITH CHECK (private.can_update_maintenance_request(id));
