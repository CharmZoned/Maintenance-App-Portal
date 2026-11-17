-- LD-30 (partial): Tenant document upload RPC + storage ACL for own metadata rows.
-- Forces visibility=tenant and unit/property scope. Does not alter inquiries.

-- Allow tenant self-upload to set visibility=tenant (admin-only gate otherwise).
CREATE OR REPLACE FUNCTION private.protect_property_document_visibility()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_admin boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  v_admin := private.is_admin();

  IF TG_OP = 'INSERT' THEN
    IF v_admin OR coalesce(auth.jwt() ->> 'role', '') = 'service_role' THEN
      RETURN NEW;
    END IF;

    -- Tenant self-serve upload: visibility must stay tenant-scoped to own unit.
    IF private.current_role() = 'tenant'::public.app_role
       AND NEW.visibility = 'tenant'
       AND NEW.property_id IS NOT DISTINCT FROM private.current_tenant_property_id()
       AND NEW.unit_id IS NOT DISTINCT FROM private.current_tenant_unit_id()
    THEN
      RETURN NEW;
    END IF;

    IF NEW.visibility IS DISTINCT FROM 'staff' THEN
      RAISE EXCEPTION 'Only admins can set document visibility';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.visibility IS DISTINCT FROM OLD.visibility AND NOT v_admin THEN
    RAISE EXCEPTION 'Only admins can change document visibility';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.submit_tenant_property_document(
  p_title text,
  p_file_name text,
  p_storage_path text,
  p_category text DEFAULT 'other',
  p_content_type text DEFAULT NULL,
  p_byte_size bigint DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS public."PropertyDocuments"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_property_id bigint;
  v_unit_id bigint;
  v_category text;
  v_title text;
  v_file text;
  v_path text;
  doc public."PropertyDocuments";
BEGIN
  IF private.current_tenant_id() IS NULL THEN
    RAISE EXCEPTION 'Only approved tenants can upload documents'
      USING ERRCODE = '42501';
  END IF;

  v_property_id := private.current_tenant_property_id();
  v_unit_id := private.current_tenant_unit_id();
  IF v_property_id IS NULL OR v_unit_id IS NULL THEN
    RAISE EXCEPTION 'Tenant has no assigned unit/property';
  END IF;

  v_title := nullif(trim(coalesce(p_title, '')), '');
  v_file := nullif(trim(coalesce(p_file_name, '')), '');
  v_path := nullif(trim(coalesce(p_storage_path, '')), '');
  IF v_title IS NULL OR v_file IS NULL OR v_path IS NULL THEN
    RAISE EXCEPTION 'title, file_name, and storage_path are required';
  END IF;

  v_category := lower(trim(coalesce(p_category, 'other')));
  IF v_category NOT IN ('lease', 'addendum', 'notice', 'other') THEN
    RAISE EXCEPTION 'Invalid document category %', v_category;
  END IF;

  IF v_path !~ ('^' || v_property_id::text || '/[^/]+$') THEN
    RAISE EXCEPTION 'storage_path must be {property_id}/{filename} for property %', v_property_id;
  END IF;

  INSERT INTO public."PropertyDocuments" (
    property_id,
    unit_id,
    title,
    file_name,
    content_type,
    byte_size,
    storage_path,
    visibility,
    category,
    uploaded_by_user_id,
    uploaded_by_role,
    notes,
    is_test_data
  ) VALUES (
    v_property_id,
    v_unit_id,
    v_title,
    v_file,
    p_content_type,
    p_byte_size,
    v_path,
    'tenant',
    v_category,
    auth.uid(),
    'tenant'::public.app_role,
    nullif(trim(coalesce(p_notes, '')), ''),
    false
  )
  RETURNING * INTO doc;

  RETURN doc;
END;
$function$;

COMMENT ON FUNCTION public.submit_tenant_property_document(text, text, text, text, text, bigint, text) IS
  'LD-30: tenant metadata-first document insert; visibility forced to tenant for own unit.';

REVOKE ALL ON FUNCTION public.submit_tenant_property_document(text, text, text, text, text, bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_tenant_property_document(text, text, text, text, text, bigint, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.submit_tenant_property_document(text, text, text, text, text, bigint, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_tenant_property_document(text, text, text, text, text, bigint, text) TO service_role;

-- Storage: allow tenant upload when metadata row already exists and was uploaded by them.
DROP POLICY IF EXISTS property_documents_storage_insert ON storage.objects;
CREATE POLICY property_documents_storage_insert
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'property-documents'
    AND name ~ '^[0-9]+/[^/]+$'
    AND EXISTS (
      SELECT 1
      FROM public."PropertyDocuments" AS doc
      WHERE doc.storage_path = name
        AND (
          private.can_manage_property_documents()
          OR (
            private.current_role() = 'tenant'::public.app_role
            AND doc.uploaded_by_user_id = (SELECT auth.uid())
            AND doc.visibility = 'tenant'
            AND private.can_select_property_document(
              doc.property_id,
              doc.unit_id,
              doc.visibility
            )
          )
        )
    )
  );

NOTIFY pgrst, 'reload schema';
