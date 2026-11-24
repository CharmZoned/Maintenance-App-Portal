-- Visit arrival window (UX-17).
--
-- Owner decision (2026-11-24): an admin schedules a visit as a date plus an
-- arrival window (Morning 8–12, Afternoon 12–5, Evening 5–8, or a custom start
-- and end), not as a bare date or a single clock time.
--
--   scheduled_for     (existing) start of the arrival window
--   scheduled_end_at  (new)      end of the arrival window, NULL = no window
--
-- Existing rows keep scheduled_for as it is and get scheduled_end_at NULL:
--   * the date-only write path stored noon UTC (…T12:00:00Z); the portal keeps
--     reading that as "a day, time to be arranged";
--   * a real clock time (seed data, offer_maintenance_request) reads as an
--     arrival time with no window ("Wed 25 Nov · 2 pm").
-- Nothing is invented for old rows.
--
-- Rules:
--   * The window ends after it starts and within 24 hours.
--   * Clearing scheduled_for clears the window. Moving scheduled_for without
--     saying a new end also clears it, so a stale end never sticks to a new day.
--   * Only admins set the window, like scheduled_for (accept / release keep it).

ALTER TABLE public."MaintenanceRequests"
  ADD COLUMN IF NOT EXISTS scheduled_end_at timestamptz;

COMMENT ON COLUMN public."MaintenanceRequests".scheduled_end_at IS
  'End of the visit arrival window that starts at scheduled_for. NULL = no window (a date only, or an arrival time only).';

ALTER TABLE public."MaintenanceRequests"
  DROP CONSTRAINT IF EXISTS requests_visit_window;
ALTER TABLE public."MaintenanceRequests"
  ADD CONSTRAINT requests_visit_window CHECK (
    scheduled_end_at IS NULL
    OR (
      scheduled_for IS NOT NULL
      AND scheduled_end_at > scheduled_for
      AND scheduled_end_at <= scheduled_for + interval '24 hours'
    )
  );

CREATE OR REPLACE FUNCTION private.keep_visit_window()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  -- Only admins (or the database itself) set the window.
  IF auth.uid() IS NOT NULL AND NOT private.is_admin() THEN
    IF TG_OP = 'INSERT' AND NEW.scheduled_end_at IS NOT NULL THEN
      RAISE EXCEPTION 'Only admins can Accept & schedule maintenance requests';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.scheduled_end_at IS DISTINCT FROM OLD.scheduled_end_at THEN
      RAISE EXCEPTION 'Only admins can Accept & schedule maintenance requests';
    END IF;
  END IF;

  IF NEW.scheduled_for IS NULL THEN
    NEW.scheduled_end_at := NULL;
  ELSIF TG_OP = 'UPDATE'
    AND NEW.scheduled_for IS DISTINCT FROM OLD.scheduled_for
    AND NEW.scheduled_end_at IS NOT DISTINCT FROM OLD.scheduled_end_at
  THEN
    NEW.scheduled_end_at := NULL;
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION private.keep_visit_window() IS
  'Visit window: admin-only; cleared when scheduled_for is cleared or moved without a new end.';

DROP TRIGGER IF EXISTS maintenance_requests_visit_window ON public."MaintenanceRequests";
CREATE TRIGGER maintenance_requests_visit_window
  BEFORE INSERT OR UPDATE OF scheduled_for, scheduled_end_at ON public."MaintenanceRequests"
  FOR EACH ROW
  EXECUTE FUNCTION private.keep_visit_window();

-- offer_maintenance_request gains the window end (optional, last, so existing
-- positional and named callers keep working).
DROP FUNCTION IF EXISTS public.offer_maintenance_request(bigint, timestamptz, numeric, numeric);

CREATE OR REPLACE FUNCTION public.offer_maintenance_request(
  p_request_id bigint,
  p_scheduled_for timestamptz,
  p_worker_price numeric,
  p_landlord_price numeric DEFAULT NULL,
  p_scheduled_end_at timestamptz DEFAULT NULL
)
RETURNS public."MaintenanceRequests"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_request public."MaintenanceRequests";
BEGIN
  IF NOT private.is_admin() THEN
    RAISE EXCEPTION 'Only admins can offer jobs to workers' USING ERRCODE = '42501';
  END IF;
  IF p_scheduled_for IS NULL THEN
    RAISE EXCEPTION 'Set the date and time before offering this job';
  END IF;
  IF p_scheduled_end_at IS NOT NULL AND p_scheduled_end_at <= p_scheduled_for THEN
    RAISE EXCEPTION 'The arrival window must end after it starts';
  END IF;
  IF p_worker_price IS NULL OR p_worker_price < 0 THEN
    RAISE EXCEPTION 'Set the worker price before offering this job';
  END IF;
  IF p_landlord_price IS NOT NULL AND p_landlord_price < 0 THEN
    RAISE EXCEPTION 'The landlord price cannot be negative';
  END IF;

  SELECT * INTO v_request
  FROM public."MaintenanceRequests"
  WHERE id = p_request_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Maintenance request % not found', p_request_id;
  END IF;
  IF v_request.status <> 'Open' OR v_request.assigned_staff_id IS NOT NULL THEN
    RAISE EXCEPTION 'Only a new, unassigned request can be offered to workers';
  END IF;

  INSERT INTO public."MaintenanceRequestWorkerPrices" (maintenance_request_id, amount)
  VALUES (p_request_id, p_worker_price)
  ON CONFLICT (maintenance_request_id)
  DO UPDATE SET amount = EXCLUDED.amount, updated_at = now();

  IF p_landlord_price IS NOT NULL THEN
    INSERT INTO public."MaintenanceRequestLandlordPrices" (maintenance_request_id, amount)
    VALUES (p_request_id, p_landlord_price)
    ON CONFLICT (maintenance_request_id)
    DO UPDATE SET amount = EXCLUDED.amount, updated_at = now();
  END IF;

  UPDATE public."MaintenanceRequests"
  SET scheduled_for = p_scheduled_for,
      scheduled_end_at = p_scheduled_end_at,
      offered_at = now(),
      offered_by_user_id = auth.uid(),
      accepted_at = NULL
  WHERE id = p_request_id
  RETURNING * INTO v_request;

  INSERT INTO public."MaintenanceRequestStatusHistory" (
    maintenance_request_id, from_status, to_status, changed_by_user_id, changed_by_role, note
  ) VALUES (
    p_request_id, 'Open', 'Open', auth.uid(), private.current_role(), 'Offered to workers'
  );

  RETURN v_request;
END;
$function$;

COMMENT ON FUNCTION public.offer_maintenance_request(bigint, timestamptz, numeric, numeric, timestamptz) IS
  'Admin: set the visit (start, optional arrival-window end) and prices, and push the job to the worker pool.';

REVOKE ALL ON FUNCTION public.offer_maintenance_request(bigint, timestamptz, numeric, numeric, timestamptz) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.offer_maintenance_request(bigint, timestamptz, numeric, numeric, timestamptz)
  TO authenticated, service_role;
