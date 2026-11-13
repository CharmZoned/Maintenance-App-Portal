-- LGA-19 follow-up: MaintenanceRequests UPDATE policy calls
-- private.can_update_maintenance_request (single predicate with comments/photos).
-- Safe if already applied; no-op-equivalent when helper already matches.

DROP POLICY IF EXISTS maintenance_requests_update ON public."MaintenanceRequests";
CREATE POLICY maintenance_requests_update ON public."MaintenanceRequests"
  FOR UPDATE
  TO authenticated
  USING (private.can_update_maintenance_request(id))
  WITH CHECK (private.can_update_maintenance_request(id));
