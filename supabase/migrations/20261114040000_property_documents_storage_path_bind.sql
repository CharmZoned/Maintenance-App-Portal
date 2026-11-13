-- WS-E: bind property-documents storage UPDATE/DELETE to an existing
-- PropertyDocuments.storage_path (closes arbitrary-path overwrite/delete by staff).
-- SELECT already requires a readable row; INSERT remains path-shaped.
-- Compatible with FE delete order: storage.remove while the row still exists, then row delete.

DROP POLICY IF EXISTS property_documents_storage_update ON storage.objects;
CREATE POLICY property_documents_storage_update
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'property-documents'
    AND private.can_manage_property_documents()
    AND EXISTS (
      SELECT 1
      FROM public."PropertyDocuments" AS doc
      WHERE doc.storage_path = name
    )
  )
  WITH CHECK (
    bucket_id = 'property-documents'
    AND private.can_manage_property_documents()
    AND name ~ '^[0-9]+/[^/]+$'
    AND EXISTS (
      SELECT 1
      FROM public."PropertyDocuments" AS doc
      WHERE doc.storage_path = name
    )
  );

DROP POLICY IF EXISTS property_documents_storage_delete ON storage.objects;
CREATE POLICY property_documents_storage_delete
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'property-documents'
    AND private.can_manage_property_documents()
    AND EXISTS (
      SELECT 1
      FROM public."PropertyDocuments" AS doc
      WHERE doc.storage_path = name
    )
  );
