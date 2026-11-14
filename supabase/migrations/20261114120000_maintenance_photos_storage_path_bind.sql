-- Bind maintenance-photos storage INSERT/UPDATE/DELETE to an existing
-- MaintenanceRequestPhotos.storage_path (same pattern as property-documents
-- path-bind). FE must insert the metadata row first, then upload
-- (see uploadMaintenancePhoto). Compatible with delete-while-row-exists.

DROP POLICY IF EXISTS maintenance_photos_storage_insert ON storage.objects;
CREATE POLICY maintenance_photos_storage_insert
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'maintenance-photos'
    AND name ~ '^[0-9]+/[^/]+$'
    AND (SELECT private.can_upload_maintenance_photo(
      (NULLIF(split_part(name, '/', 1), ''))::bigint
    ))
    AND EXISTS (
      SELECT 1
      FROM public."MaintenanceRequestPhotos" AS photo
      WHERE photo.storage_path = name
    )
  );

DROP POLICY IF EXISTS maintenance_photos_storage_update ON storage.objects;
CREATE POLICY maintenance_photos_storage_update
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'maintenance-photos'
    AND EXISTS (
      SELECT 1
      FROM public."MaintenanceRequestPhotos" AS photo
      WHERE photo.storage_path = name
    )
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
    AND name ~ '^[0-9]+/[^/]+$'
    AND EXISTS (
      SELECT 1
      FROM public."MaintenanceRequestPhotos" AS photo
      WHERE photo.storage_path = name
    )
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
    AND EXISTS (
      SELECT 1
      FROM public."MaintenanceRequestPhotos" AS photo
      WHERE photo.storage_path = name
        AND (
          (SELECT private.current_role()) = 'admin'::public.app_role
          OR (
            (SELECT private.current_role()) = 'tenant'::public.app_role
            AND photo.uploaded_by_user_id = auth.uid()
            AND (SELECT private.can_upload_maintenance_photo(photo.maintenance_request_id))
          )
          OR (
            (SELECT private.current_role()) IN (
              'landlord'::public.app_role,
              'maintenance'::public.app_role
            )
            AND (SELECT private.can_upload_maintenance_photo(photo.maintenance_request_id))
          )
        )
    )
  );
