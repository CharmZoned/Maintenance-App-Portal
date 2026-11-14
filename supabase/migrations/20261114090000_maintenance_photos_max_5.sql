-- WS-S S2 hygiene #6: enforce max 5 MaintenanceRequestPhotos per request at DB.
-- FE already slices to 5; this blocks API/SQL bypass. One concern: photo cap.

CREATE OR REPLACE FUNCTION private.enforce_maintenance_photo_cap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*)::integer INTO v_count
  FROM public."MaintenanceRequestPhotos"
  WHERE maintenance_request_id = NEW.maintenance_request_id;

  IF v_count >= 5 THEN
    RAISE EXCEPTION 'A maintenance request may have at most 5 photos';
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION private.enforce_maintenance_photo_cap IS
  'BEFORE INSERT guard: at most 5 MaintenanceRequestPhotos rows per request.';

DROP TRIGGER IF EXISTS trg_maintenance_photo_cap ON public."MaintenanceRequestPhotos";
CREATE TRIGGER trg_maintenance_photo_cap
  BEFORE INSERT ON public."MaintenanceRequestPhotos"
  FOR EACH ROW
  EXECUTE FUNCTION private.enforce_maintenance_photo_cap();
