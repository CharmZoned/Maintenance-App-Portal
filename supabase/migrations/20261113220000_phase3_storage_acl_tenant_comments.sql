-- Phase 3 follow-up: storage ACL parity, tenant comments, author binding, tenant_id helper
-- Additive. Does not alter inquiries.

-- ── current_tenant_id: require tenant role (match unit/property helpers) ──

CREATE OR REPLACE FUNCTION private.current_tenant_id()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT tenant_id
  FROM public.user_roles
  WHERE user_id = (SELECT auth.uid())
    AND account_status = 'approved'
    AND role = 'tenant'::public.app_role
$function$;

-- ── Photo table: bind uploaded_by_role + single-segment path ───────

DROP POLICY IF EXISTS maintenance_photos_insert ON public."MaintenanceRequestPhotos";
CREATE POLICY maintenance_photos_insert
  ON public."MaintenanceRequestPhotos"
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT private.can_upload_maintenance_photo(maintenance_request_id))
    AND uploaded_by_user_id = auth.uid()
    AND uploaded_by_role IS NOT DISTINCT FROM (SELECT private.current_role())
    AND storage_path ~ ('^' || maintenance_request_id::text || '/[^/]+$')
  );

-- ── Storage: staff/admin may UPDATE; tenants may only DELETE own objects ──

DROP POLICY IF EXISTS maintenance_photos_storage_update ON storage.objects;
CREATE POLICY maintenance_photos_storage_update
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'maintenance-photos'
    AND (
      (SELECT private.current_role()) = 'admin'::public.app_role
      OR (
        (SELECT private.current_role()) IN (
          'landlord'::public.app_role,
          'maintenance'::public.app_role
        )
        AND (SELECT private.can_upload_maintenance_photo(
          (NULLIF(split_part(name, '/', 1), ''))::bigint
        ))
      )
    )
  )
  WITH CHECK (
    bucket_id = 'maintenance-photos'
    AND (
      (SELECT private.current_role()) = 'admin'::public.app_role
      OR (
        (SELECT private.current_role()) IN (
          'landlord'::public.app_role,
          'maintenance'::public.app_role
        )
        AND (SELECT private.can_upload_maintenance_photo(
          (NULLIF(split_part(name, '/', 1), ''))::bigint
        ))
      )
    )
  );

DROP POLICY IF EXISTS maintenance_photos_storage_delete ON storage.objects;
CREATE POLICY maintenance_photos_storage_delete
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'maintenance-photos'
    AND (
      (SELECT private.current_role()) = 'admin'::public.app_role
      OR (
        (SELECT private.current_role()) = 'tenant'::public.app_role
        AND EXISTS (
          SELECT 1
          FROM public."MaintenanceRequestPhotos" AS photo
          WHERE photo.storage_path = name
            AND photo.uploaded_by_user_id = auth.uid()
            AND (SELECT private.can_upload_maintenance_photo(photo.maintenance_request_id))
        )
      )
      OR (
        (SELECT private.current_role()) IN (
          'landlord'::public.app_role,
          'maintenance'::public.app_role
        )
        AND (SELECT private.can_upload_maintenance_photo(
          (NULLIF(split_part(name, '/', 1), ''))::bigint
        ))
      )
    )
  );

DROP POLICY IF EXISTS maintenance_photos_storage_insert ON storage.objects;
CREATE POLICY maintenance_photos_storage_insert
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'maintenance-photos'
    AND (SELECT private.can_upload_maintenance_photo(
      (NULLIF(split_part(name, '/', 1), ''))::bigint
    ))
    AND name ~ '^[0-9]+/[^/]+$'
  );

-- ── Comments: bind author link ids; allow tenant_visible replies ──

DROP POLICY IF EXISTS maintenance_comments_insert ON public."MaintenanceRequestComments";
CREATE POLICY maintenance_comments_insert
  ON public."MaintenanceRequestComments"
  FOR INSERT
  TO authenticated
  WITH CHECK (
    visibility = ANY (ARRAY['tenant_visible'::text, 'internal'::text])
    AND author_user_id = auth.uid()
    AND author_role IS NOT DISTINCT FROM (SELECT private.current_role())
    AND author_staff_id IS NOT DISTINCT FROM (SELECT private.current_staff_id())
    AND author_tenant_id IS NOT DISTINCT FROM (SELECT private.current_tenant_id())
    AND (
      (SELECT private.can_update_maintenance_request(maintenance_request_id))
      OR (
        (SELECT private.current_role()) = 'tenant'::public.app_role
        AND visibility = 'tenant_visible'
        AND (SELECT private.can_select_maintenance_request(maintenance_request_id))
      )
    )
  );
