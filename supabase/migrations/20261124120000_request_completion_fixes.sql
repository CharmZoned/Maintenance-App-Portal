-- Request completion fixes (UX audit workstream A, 2026-11-24).
--
-- 1. A completion photo must be a real file. The worker's proof photo is a
--    MaintenanceRequestPhotos row plus a file in the maintenance-photos
--    bucket. The client writes the row first (the storage path-bind policy
--    needs it) and rolls the row back when the upload fails, but workers could
--    not delete photo rows, so the rollback silently did nothing and the
--    broken row still let the job be completed. Now:
--      * protect_maintenance_request() only counts a photo whose file exists
--        (one lookup on the storage.objects (bucket_id, name) unique index);
--      * the uploader may delete their own photo row while it has no file
--        (orphan cleanup only: a photo with a stored file stays protected).
--
-- 2. Tenant "Still a problem": reopen_maintenance_request_not_fixed() lets the
--    reporting tenant reopen their completed request with a short note. It
--    goes back to the assigned worker (Scheduled) or to New (Open) when nobody
--    is assigned, the same as the admin Reopen. The note is saved as a
--    tenant-visible request message and the history row reads
--    'Tenant says it is not fixed', so the timeline shows both. Reopening
--    clears tenant_fix_* (reset_tenant_fix_on_reopen), and the worker needs a
--    new photo to complete again (the reopen time is part of the photo rule).

-- ── Helper: does the photo's file exist? ───────────────────────────
-- SECURITY DEFINER: the function owner (postgres on hosted Supabase, which
-- bypasses RLS) reads storage.objects, so the answer does not depend on the
-- caller's storage read rules.
CREATE OR REPLACE FUNCTION private.maintenance_photo_stored(p_storage_path text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM storage.objects AS object
    WHERE object.bucket_id = 'maintenance-photos'
      AND object.name = p_storage_path
  )
$function$;

COMMENT ON FUNCTION private.maintenance_photo_stored(text) IS
  'True when the maintenance-photos bucket holds a file at this path. Used by the completion-photo rule and the orphan-row delete policy.';

REVOKE ALL ON FUNCTION private.maintenance_photo_stored(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION private.maintenance_photo_stored(text) TO authenticated, service_role;

-- ── Photo rows: the uploader may remove their own row that has no file ──
DROP POLICY IF EXISTS maintenance_photos_delete ON public."MaintenanceRequestPhotos";
CREATE POLICY maintenance_photos_delete ON public."MaintenanceRequestPhotos"
  FOR DELETE
  TO authenticated
  USING (
    ((SELECT private.current_role()) = 'admin'::public.app_role)
    OR (
      ((SELECT private.current_role()) = 'tenant'::public.app_role)
      AND uploaded_by_user_id = (SELECT auth.uid())
      AND (SELECT private.can_upload_maintenance_photo("MaintenanceRequestPhotos".maintenance_request_id))
    )
    OR (
      -- Failed upload: the row was written but the file never arrived.
      uploaded_by_user_id = (SELECT auth.uid())
      AND (SELECT private.can_upload_maintenance_photo("MaintenanceRequestPhotos".maintenance_request_id))
      AND NOT private.maintenance_photo_stored("MaintenanceRequestPhotos".storage_path)
    )
  );

-- ── Field protection: tenant reopen flow + stored-file photo rule ──
-- Same as 20261118190000_worker_job_pool.sql, plus:
--   * the 'tenant_reopen' flow (reopen_maintenance_request_not_fixed below);
--   * the completion photo must have its file in storage.

CREATE OR REPLACE FUNCTION private.protect_maintenance_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_role public.app_role;
  v_flow text;
  v_photo_since timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  v_role := private.current_role();

  IF v_role = 'admin'::public.app_role THEN
    RETURN NEW;
  END IF;

  v_flow := current_setting('lg.mr_flow', true);

  -- accept_maintenance_request(): claim a pooled job for the calling worker.
  IF v_flow = 'accept'
    AND v_role = 'maintenance'::public.app_role
    AND OLD.status = 'Open'
    AND OLD.offered_at IS NOT NULL
    AND OLD.assigned_staff_id IS NULL
    AND NEW.assigned_staff_id = private.current_staff_id()
    AND NEW.status = 'Scheduled'
    AND NEW.scheduled_for IS NOT DISTINCT FROM OLD.scheduled_for
  THEN
    RETURN NEW;
  END IF;

  -- release_maintenance_request(): the assigned worker hands the job back.
  IF v_flow = 'release'
    AND v_role = 'maintenance'::public.app_role
    AND OLD.assigned_staff_id = private.current_staff_id()
    AND OLD.status <> 'Closed'
    AND NEW.assigned_staff_id IS NULL
    AND NEW.status = 'Open'
    AND NEW.offered_at IS NULL
    AND NEW.scheduled_for IS NOT DISTINCT FROM OLD.scheduled_for
  THEN
    RETURN NEW;
  END IF;

  -- confirm_maintenance_request_fixed(): the reporting tenant answers.
  IF v_flow = 'tenant_fix'
    AND v_role = 'tenant'::public.app_role
    AND OLD.submitted_by_tenant_id = private.current_tenant_id()
    AND OLD.status = 'Closed'
    AND NEW.status = 'Closed'
    AND NEW.assigned_staff_id IS NOT DISTINCT FROM OLD.assigned_staff_id
    AND NEW.scheduled_for IS NOT DISTINCT FROM OLD.scheduled_for
    AND NEW.offered_at IS NOT DISTINCT FROM OLD.offered_at
  THEN
    RETURN NEW;
  END IF;

  -- reopen_maintenance_request_not_fixed(): the reporting tenant reopens a
  -- completed request. Only the status (and closed_at) moves; it goes back to
  -- the same worker and date, or to New when nobody is assigned.
  IF v_flow = 'tenant_reopen'
    AND v_role = 'tenant'::public.app_role
    AND OLD.submitted_by_tenant_id = private.current_tenant_id()
    AND OLD.status = 'Closed'
    -- (Parenthesised: an IF condition otherwise ends at the CASE's THEN.)
    AND NEW.status = (CASE
      WHEN OLD.assigned_staff_id IS NOT NULL AND OLD.scheduled_for IS NOT NULL THEN 'Scheduled'
      ELSE 'Open'
    END)
    AND NEW.closed_at IS NULL
    AND NEW.assigned_staff_id IS NOT DISTINCT FROM OLD.assigned_staff_id
    AND NEW.scheduled_for IS NOT DISTINCT FROM OLD.scheduled_for
    AND NEW.offered_at IS NOT DISTINCT FROM OLD.offered_at
    AND NEW.accepted_at IS NOT DISTINCT FROM OLD.accepted_at
    AND NEW.released_at IS NOT DISTINCT FROM OLD.released_at
    AND NEW.title IS NOT DISTINCT FROM OLD.title
    AND NEW.description IS NOT DISTINCT FROM OLD.description
    AND NEW.resolution_notes IS NOT DISTINCT FROM OLD.resolution_notes
  THEN
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.request_number IS DISTINCT FROM OLD.request_number
    OR NEW.unit_id IS DISTINCT FROM OLD.unit_id
    OR NEW.submitted_by_tenant_id IS DISTINCT FROM OLD.submitted_by_tenant_id
    OR NEW.title IS DISTINCT FROM OLD.title
    OR NEW.description IS DISTINCT FROM OLD.description
    OR NEW.category IS DISTINCT FROM OLD.category
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.is_test_data IS DISTINCT FROM OLD.is_test_data
    OR NEW.location IS DISTINCT FROM OLD.location
    OR NEW.permission_to_enter IS DISTINCT FROM OLD.permission_to_enter
    OR NEW.client_submission_id IS DISTINCT FROM OLD.client_submission_id
  THEN
    RAISE EXCEPTION 'These request fields cannot be changed from this account';
  END IF;

  IF v_role = 'maintenance'::public.app_role
    AND NEW.assigned_staff_id IS DISTINCT FROM OLD.assigned_staff_id
  THEN
    RAISE EXCEPTION 'Assigned staff cannot be changed from this account';
  END IF;

  IF NEW.offered_at IS DISTINCT FROM OLD.offered_at
    OR NEW.offered_by_user_id IS DISTINCT FROM OLD.offered_by_user_id
    OR NEW.accepted_at IS DISTINCT FROM OLD.accepted_at
    OR NEW.released_at IS DISTINCT FROM OLD.released_at
    OR NEW.released_by_staff_id IS DISTINCT FROM OLD.released_by_staff_id
  THEN
    RAISE EXCEPTION 'Jobs are offered, accepted and released through the job actions, not by editing the request';
  END IF;

  IF NEW.tenant_fix_response IS DISTINCT FROM OLD.tenant_fix_response
    OR NEW.tenant_fix_responded_at IS DISTINCT FROM OLD.tenant_fix_responded_at
    OR NEW.tenant_fix_note IS DISTINCT FROM OLD.tenant_fix_note
  THEN
    RAISE EXCEPTION 'Only the tenant who reported the request can confirm the fix';
  END IF;

  -- Date and time are admin-only; workers get a schedule by accepting a pooled job.
  IF NEW.scheduled_for IS DISTINCT FROM OLD.scheduled_for
    OR (
      NEW.status IS DISTINCT FROM OLD.status
      AND NEW.status = 'Scheduled'
    )
  THEN
    RAISE EXCEPTION 'Only admins can Accept & schedule maintenance requests';
  END IF;

  -- A worker proves the fix with a photo before completing: their own photo,
  -- uploaded since they took the job and since it was last reopened, whose
  -- file actually reached storage. A previous worker's photo, one from before
  -- a reopen, or a row whose upload failed does not count.
  IF v_role = 'maintenance'::public.app_role
    AND NEW.status = 'Closed'
    AND OLD.status IS DISTINCT FROM 'Closed'
  THEN
    SELECT GREATEST(
      COALESCE(OLD.accepted_at, '-infinity'::timestamptz),
      COALESCE(OLD.released_at, '-infinity'::timestamptz),
      COALESCE(
        (
          SELECT max(history.created_at)
          FROM public."MaintenanceRequestStatusHistory" AS history
          WHERE history.maintenance_request_id = NEW.id
            AND history.from_status = 'Closed'
            AND history.to_status <> 'Closed'
        ),
        '-infinity'::timestamptz
      )
    ) INTO v_photo_since;

    IF NOT EXISTS (
      SELECT 1
      FROM public."MaintenanceRequestPhotos" AS photo
      WHERE photo.maintenance_request_id = NEW.id
        AND photo.uploaded_by_role = 'maintenance'::public.app_role
        AND photo.uploaded_by_user_id = auth.uid()
        AND photo.created_at > v_photo_since
        AND private.maintenance_photo_stored(photo.storage_path)
    ) THEN
      RAISE EXCEPTION 'Add at least one photo of the finished work before completing this job';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION private.protect_maintenance_request() IS
  'Non-admins cannot rewrite submission fields, schedule, pool or tenant-confirmation fields; maintenance cannot reassign and needs a stored work photo to complete. accept/release/tenant_fix/tenant_reopen RPCs pass through shape-checked.';

-- ── Tenant: "Still a problem" reopens the request ───────────────────
CREATE OR REPLACE FUNCTION public.reopen_maintenance_request_not_fixed(
  p_request_id bigint,
  p_note text
)
RETURNS public."MaintenanceRequests"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_tenant bigint;
  v_note text;
  v_next_status text;
  v_request public."MaintenanceRequests";
BEGIN
  v_tenant := private.current_tenant_id();
  IF v_tenant IS NULL OR private.current_role() IS DISTINCT FROM 'tenant'::public.app_role THEN
    RAISE EXCEPTION 'Only the tenant who reported the request can reopen it' USING ERRCODE = '42501';
  END IF;

  v_note := NULLIF(btrim(COALESCE(p_note, '')), '');
  IF v_note IS NULL THEN
    RAISE EXCEPTION 'Say what is still wrong';
  END IF;
  IF char_length(v_note) > 1000 THEN
    RAISE EXCEPTION 'The note must be at most 1000 characters';
  END IF;

  SELECT * INTO v_request
  FROM public."MaintenanceRequests"
  WHERE id = p_request_id
  FOR UPDATE;
  IF NOT FOUND OR v_request.submitted_by_tenant_id IS DISTINCT FROM v_tenant THEN
    RAISE EXCEPTION 'Only the tenant who reported the request can reopen it' USING ERRCODE = '42501';
  END IF;
  IF v_request.status <> 'Closed' THEN
    RAISE EXCEPTION 'This request is not completed yet';
  END IF;
  IF v_request.tenant_fix_response = 'confirmed' THEN
    RAISE EXCEPTION 'You already confirmed this is fixed. Report a new problem instead';
  END IF;

  -- The note is a normal request message: the worker, the office and the
  -- tenant see it in the timeline.
  INSERT INTO public."MaintenanceRequestComments" (
    maintenance_request_id, author_user_id, author_role, author_tenant_id, body, visibility
  ) VALUES (
    p_request_id, auth.uid(), 'tenant'::public.app_role, v_tenant,
    'Still a problem: ' || v_note, 'tenant_visible'
  );

  v_next_status := CASE
    WHEN v_request.assigned_staff_id IS NOT NULL AND v_request.scheduled_for IS NOT NULL THEN 'Scheduled'
    ELSE 'Open'
  END;

  PERFORM set_config('lg.mr_flow', 'tenant_reopen', true);
  PERFORM set_config('lg.mr_history_note', 'Tenant says it is not fixed', true);
  UPDATE public."MaintenanceRequests"
  SET status = v_next_status,
      closed_at = NULL
  WHERE id = p_request_id
  RETURNING * INTO v_request;
  PERFORM set_config('lg.mr_flow', '', true);
  PERFORM set_config('lg.mr_history_note', '', true);

  RETURN v_request;
END;
$function$;

COMMENT ON FUNCTION public.reopen_maintenance_request_not_fixed(bigint, text) IS
  'Reporting tenant: the completed fix did not hold. Saves the note as a request message and reopens the request (Scheduled with its worker, or Open).';

REVOKE ALL ON FUNCTION public.reopen_maintenance_request_not_fixed(bigint, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.reopen_maintenance_request_not_fixed(bigint, text) TO authenticated, service_role;
