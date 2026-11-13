-- Phase 3 follow-up: tighten tenant insert WITH CHECK + photo path/author binding
-- Additive. Does not alter inquiries.

-- Tenant insert: pin property_id to tenant unit; forbid staff fields on create
DROP POLICY IF EXISTS maintenance_requests_insert_tenant ON public."MaintenanceRequests";
CREATE POLICY maintenance_requests_insert_tenant
  ON public."MaintenanceRequests"
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT private.current_role()) = 'tenant'::public.app_role
    AND submitted_by_tenant_id = (SELECT private.current_tenant_id())
    AND unit_id = (SELECT private.current_tenant_unit_id())
    AND property_id IS NOT DISTINCT FROM (SELECT private.current_tenant_property_id())
    AND status = 'Open'::text
    AND assigned_staff_id IS NULL
    AND started_at IS NULL
    AND closed_at IS NULL
    AND scheduled_for IS NULL
    AND hold_reason IS NULL
    AND next_follow_up_date IS NULL
    AND resolution_notes IS NULL
    AND vendor_id IS NULL
    AND cost IS NULL
    AND notes IS NULL
    AND is_test_data = false
  );

-- Photo insert: path must be under request id; author must be caller
DROP POLICY IF EXISTS maintenance_photos_insert ON public."MaintenanceRequestPhotos";
CREATE POLICY maintenance_photos_insert
  ON public."MaintenanceRequestPhotos"
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT private.can_upload_maintenance_photo(maintenance_request_id))
    AND uploaded_by_user_id = auth.uid()
    AND storage_path LIKE (maintenance_request_id::text || '/%')
  );

-- Comments: force author to caller (staff/admin/landlord who can update)
DROP POLICY IF EXISTS maintenance_comments_insert ON public."MaintenanceRequestComments";
CREATE POLICY maintenance_comments_insert
  ON public."MaintenanceRequestComments"
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT private.can_update_maintenance_request(maintenance_request_id))
    AND visibility = ANY (ARRAY['tenant_visible'::text, 'internal'::text])
    AND author_user_id = auth.uid()
    AND author_role IS NOT DISTINCT FROM (SELECT private.current_role())
  );
