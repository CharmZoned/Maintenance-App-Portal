-- Work-photo cap counts the current visit only.
--
-- Completing a job needs a work photo taken after the job was accepted,
-- released or last reopened (private.protect_maintenance_request). The
-- 5-work-photo cap counted every work photo on the request, and workers cannot
-- delete a stored photo, so a job reopened with five work photos already on it
-- could never be completed again. The cap now counts only work photos from the
-- same window the completion rule uses. Older ones stay as history. Photos from
-- the reporter side keep their own cap of 5, unchanged.

-- When the current visit's work-photo window opens: the latest of accepted_at,
-- released_at and the last move out of Closed. -infinity when none is set.
-- Keep in step with the v_photo_since block in private.protect_maintenance_request.
CREATE OR REPLACE FUNCTION private.work_photo_since(p_request_id bigint)
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT GREATEST(
    COALESCE(request.accepted_at, '-infinity'::timestamptz),
    COALESCE(request.released_at, '-infinity'::timestamptz),
    COALESCE(
      (
        SELECT max(history.created_at)
        FROM public."MaintenanceRequestStatusHistory" AS history
        WHERE history.maintenance_request_id = p_request_id
          AND history.from_status = 'Closed'
          AND history.to_status <> 'Closed'
      ),
      '-infinity'::timestamptz
    )
  )
  FROM public."MaintenanceRequests" AS request
  WHERE request.id = p_request_id
$function$;

COMMENT ON FUNCTION private.work_photo_since(bigint) IS
  'Start of the current visit''s work-photo window (accepted, released or last reopened). Used by the work-photo cap; mirrors the completion-photo cut-off.';

REVOKE ALL ON FUNCTION private.work_photo_since(bigint) FROM public, anon;
GRANT EXECUTE ON FUNCTION private.work_photo_since(bigint) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.enforce_maintenance_photo_cap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_is_work boolean;
  v_since timestamptz;
  v_count integer;
BEGIN
  v_is_work := COALESCE(NEW.uploaded_by_role = 'maintenance'::public.app_role, false);

  -- Lock the request so two overlapping uploads count one after the other
  -- (without this both can read 4 and both insert, passing the cap).
  PERFORM 1
  FROM public."MaintenanceRequests" AS request
  WHERE request.id = NEW.maintenance_request_id
  FOR NO KEY UPDATE;

  IF v_is_work THEN
    v_since := COALESCE(private.work_photo_since(NEW.maintenance_request_id), '-infinity'::timestamptz);
    SELECT count(*)::integer INTO v_count
    FROM public."MaintenanceRequestPhotos" AS photo
    WHERE photo.maintenance_request_id = NEW.maintenance_request_id
      AND photo.uploaded_by_role = 'maintenance'::public.app_role
      AND photo.created_at > v_since;
  ELSE
    SELECT count(*)::integer INTO v_count
    FROM public."MaintenanceRequestPhotos" AS photo
    WHERE photo.maintenance_request_id = NEW.maintenance_request_id
      AND COALESCE(photo.uploaded_by_role = 'maintenance'::public.app_role, false) = false;
  END IF;

  IF v_count >= 5 THEN
    IF v_is_work THEN
      RAISE EXCEPTION 'A maintenance request may have at most 5 work photos per visit';
    END IF;
    RAISE EXCEPTION 'A maintenance request may have at most 5 photos';
  END IF;
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION private.enforce_maintenance_photo_cap() IS
  'At most 5 photos from the reporter side, and at most 5 work photos per visit (since accepted, released or last reopened).';
