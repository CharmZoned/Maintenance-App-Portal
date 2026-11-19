-- Worker job pool: admin pushes a priced, dated job; workers accept or leave it.
--
-- Owner decisions (2026-11-18):
--   * Maintenance staff and vendors are the same thing: an outside maintenance
--     professional with a login. They live in public."Staff" (auth, approval and
--     every existing RLS helper already key off Staff). Staff gains company,
--     phone and services. public."Vendors" and MaintenanceRequests.vendor_id
--     stay in place, unused by this flow, until the portal stops reading them.
--   * Only an admin sets the date/time (scheduled_for) and the prices.
--   * There are two prices, because Landlord Gopher keeps the difference:
--     what the worker is paid, and what the landlord is billed. The worker
--     never sees the landlord price, the landlord never sees the worker price,
--     and the tenant sees neither. They live in two side tables with their own
--     row rules; the old single MaintenanceRequests.cost column is removed.
--   * Admin pushes a job to the pool (offered_at). Workers whose services match
--     the category see it. There is no decline: a worker accepts it or leaves it.
--     First accept wins. Admin can still assign one worker directly.
--   * Before accepting, a worker sees the request row, its photos and the
--     property/unit address. NOT comments, status history, staff notes or the
--     tenant record: those still require assignment.
--   * A worker can release a job they accepted (reason required). It goes back
--     to the admin unassigned and is NOT re-offered automatically.
--   * A worker must upload at least one photo before completing a job.
--   * After completion the tenant can confirm it is fixed, or say it is not.
--   * Every non-admin gets one direct thread with the Landlord Gopher office
--     (worker <-> office, landlord <-> office). Job chat stays on
--     MaintenanceRequestComments. Per-user read state is added for both.
--
-- "Available" is a derived state, not a new status value:
--   status = 'Open' AND offered_at IS NOT NULL AND assigned_staff_id IS NULL

-- ── Worker profile on Staff ─────────────────────────────────────────

ALTER TABLE public."Staff"
  ADD COLUMN IF NOT EXISTS company_name text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS services text[] NOT NULL DEFAULT '{}';

ALTER TABLE public."Staff"
  DROP CONSTRAINT IF EXISTS staff_services_allowed,
  DROP CONSTRAINT IF EXISTS staff_company_name_length,
  DROP CONSTRAINT IF EXISTS staff_phone_length;
ALTER TABLE public."Staff"
  ADD CONSTRAINT staff_services_allowed CHECK (
    services <@ ARRAY['Plumbing', 'Electrical', 'Heating / AC', 'Appliance', 'Pest control',
                      'Locks / keys / doors', 'Windows', 'Roof / leaks', 'Mold / water damage',
                      'Exterior / yard', 'General repair', 'Other']::text[]
  ),
  ADD CONSTRAINT staff_company_name_length CHECK (company_name IS NULL OR char_length(company_name) <= 120),
  ADD CONSTRAINT staff_phone_length CHECK (phone IS NULL OR char_length(phone) <= 40);

COMMENT ON TABLE public."Staff" IS
  'People who work jobs: outside maintenance professionals (formerly also "vendors") and office staff. Login is linked through user_roles.staff_id.';
COMMENT ON COLUMN public."Staff".company_name IS 'Company the worker trades as. NULL for an individual or office staff.';
COMMENT ON COLUMN public."Staff".services IS
  'Maintenance categories this worker takes (same values as MaintenanceRequests.category). Empty = sees every pushed job.';
COMMENT ON TABLE public."Vendors" IS
  'Deprecated 2026-11-18: vendors are now Staff rows (company_name, phone, services). Kept until the portal stops reading it.';

-- ── Pool / release / tenant-confirmation columns on the request ─────

ALTER TABLE public."MaintenanceRequests"
  ADD COLUMN IF NOT EXISTS offered_at timestamptz,
  ADD COLUMN IF NOT EXISTS offered_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS released_at timestamptz,
  ADD COLUMN IF NOT EXISTS released_by_staff_id bigint REFERENCES public."Staff"(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tenant_fix_response text,
  ADD COLUMN IF NOT EXISTS tenant_fix_responded_at timestamptz,
  ADD COLUMN IF NOT EXISTS tenant_fix_note text;

ALTER TABLE public."MaintenanceRequests"
  DROP CONSTRAINT IF EXISTS requests_offered_details,
  DROP CONSTRAINT IF EXISTS requests_tenant_fix_response_check,
  DROP CONSTRAINT IF EXISTS requests_tenant_fix_details;
ALTER TABLE public."MaintenanceRequests"
  -- A job waiting in the pool always carries the date/time the admin set.
  -- (Its worker price is guarded by keep_pooled_worker_price below.)
  ADD CONSTRAINT requests_offered_details CHECK (
    offered_at IS NULL
    OR assigned_staff_id IS NOT NULL
    OR scheduled_for IS NOT NULL
  ),
  ADD CONSTRAINT requests_tenant_fix_response_check CHECK (
    tenant_fix_response IS NULL OR tenant_fix_response IN ('confirmed', 'not_fixed')
  ),
  ADD CONSTRAINT requests_tenant_fix_details CHECK (
    (tenant_fix_response IS NULL AND tenant_fix_responded_at IS NULL AND tenant_fix_note IS NULL)
    OR (
      tenant_fix_response IS NOT NULL
      AND tenant_fix_responded_at IS NOT NULL
      AND status = 'Closed'
      AND (tenant_fix_note IS NULL OR char_length(tenant_fix_note) <= 1000)
    )
  );

COMMENT ON COLUMN public."MaintenanceRequests".offered_at IS
  'When an admin pushed this job to the worker pool. Available = Open + offered_at set + unassigned.';
COMMENT ON COLUMN public."MaintenanceRequests".accepted_at IS 'When the assigned worker accepted the job from the pool.';
COMMENT ON COLUMN public."MaintenanceRequests".released_at IS
  'When a worker last released this job back to the admin. Needs reassigning while unassigned and not re-offered.';
COMMENT ON COLUMN public."MaintenanceRequests".tenant_fix_response IS
  'Tenant answer after completion: confirmed | not_fixed. Cleared when the request is reopened.';
CREATE INDEX IF NOT EXISTS maintenance_requests_pool_idx
  ON public."MaintenanceRequests" (scheduled_for)
  WHERE offered_at IS NOT NULL AND assigned_staff_id IS NULL AND status = 'Open';
CREATE INDEX IF NOT EXISTS maintenance_requests_released_by_idx
  ON public."MaintenanceRequests" (released_by_staff_id);
CREATE INDEX IF NOT EXISTS maintenance_requests_offered_by_idx
  ON public."MaintenanceRequests" (offered_by_user_id);

-- ── Two prices, in two side tables ──────────────────────────────────
-- Row rules cannot hide one column of a row from one audience, so each price
-- gets its own table (same approach as MaintenanceRequestStaffNotes).

CREATE TABLE IF NOT EXISTS public."MaintenanceRequestWorkerPrices" (
  maintenance_request_id bigint PRIMARY KEY
    REFERENCES public."MaintenanceRequests"(id) ON DELETE CASCADE,
  amount numeric(10, 2) NOT NULL CHECK (amount >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public."MaintenanceRequestLandlordPrices" (
  maintenance_request_id bigint PRIMARY KEY
    REFERENCES public."MaintenanceRequests"(id) ON DELETE CASCADE,
  amount numeric(10, 2) NOT NULL CHECK (amount >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public."MaintenanceRequestWorkerPrices" IS
  'What Landlord Gopher pays the worker for the job. Admin writes. Read by admin, the assigned worker, and workers looking at the job in the pool. Never the landlord or tenant.';
COMMENT ON TABLE public."MaintenanceRequestLandlordPrices" IS
  'What Landlord Gopher bills the landlord for the job. Admin writes. Read by admin and the owning landlord. Never the worker or tenant.';

-- The tenant insert rule named the cost column; restate it without, and keep a
-- tenant from submitting a request that is already offered, accepted, released
-- or confirmed.
DROP POLICY IF EXISTS maintenance_requests_insert_tenant ON public."MaintenanceRequests";
CREATE POLICY maintenance_requests_insert_tenant ON public."MaintenanceRequests"
  FOR INSERT TO authenticated
  WITH CHECK (
    ((SELECT private.current_role()) = 'tenant'::public.app_role)
    AND (submitted_by_tenant_id = (SELECT private.current_tenant_id()))
    AND (unit_id = (SELECT private.current_tenant_unit_id()))
    AND (NOT (property_id IS DISTINCT FROM (SELECT private.current_tenant_property_id())))
    AND (status = 'Open'::text)
    AND (assigned_staff_id IS NULL)
    AND (started_at IS NULL)
    AND (closed_at IS NULL)
    AND (scheduled_for IS NULL)
    AND (hold_reason IS NULL)
    AND (next_follow_up_date IS NULL)
    AND (resolution_notes IS NULL)
    AND (vendor_id IS NULL)
    AND (offered_at IS NULL)
    AND (offered_by_user_id IS NULL)
    AND (accepted_at IS NULL)
    AND (released_at IS NULL)
    AND (released_by_staff_id IS NULL)
    AND (tenant_fix_response IS NULL)
    AND (is_test_data = false)
  );

-- The old single cost column was readable by everyone who could see the
-- request. Landlords could already read it, so it carries over as the landlord
-- price (no audience gains anything), then the column goes.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'MaintenanceRequests' AND column_name = 'cost'
  ) THEN
    INSERT INTO public."MaintenanceRequestLandlordPrices" (maintenance_request_id, amount)
    SELECT id, cost FROM public."MaintenanceRequests" WHERE cost IS NOT NULL AND cost >= 0
    ON CONFLICT (maintenance_request_id) DO NOTHING;
    ALTER TABLE public."MaintenanceRequests" DROP COLUMN cost;
  END IF;
END
$$;

-- ── Helpers ─────────────────────────────────────────────────────────

-- Approved maintenance login that is linked to a Staff row.
CREATE OR REPLACE FUNCTION private.is_approved_worker()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT (SELECT private.current_role()) = 'maintenance'::public.app_role
     AND (SELECT private.current_staff_id()) IS NOT NULL
$function$;

-- The job is in the pool and the calling worker's services cover its category.
CREATE OR REPLACE FUNCTION private.job_available_to_me(target_request bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT (SELECT private.is_approved_worker())
     AND EXISTS (
       SELECT 1
       FROM public."MaintenanceRequests" AS request
       JOIN public."Staff" AS me ON me.id = (SELECT private.current_staff_id())
       WHERE request.id = target_request
         AND request.status = 'Open'
         AND request.offered_at IS NOT NULL
         AND request.assigned_staff_id IS NULL
         AND (me.services = '{}'::text[] OR request.category = ANY (me.services))
         AND EXISTS (
           SELECT 1 FROM public."MaintenanceRequestWorkerPrices" AS price
           WHERE price.maintenance_request_id = request.id
         )
     )
$function$;

-- The landlord owns the unit this request is for.
CREATE OR REPLACE FUNCTION private.landlord_owns_request(target_request bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public."MaintenanceRequests" AS request
    WHERE request.id = target_request
      AND private.landlord_owns_unit(request.unit_id)
  )
$function$;

CREATE OR REPLACE FUNCTION private.job_available_for_unit(target_unit bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT (SELECT private.is_approved_worker())
     AND EXISTS (
       SELECT 1
       FROM public."MaintenanceRequests" AS request
       WHERE request.unit_id = target_unit
         AND request.status = 'Open'
         AND request.offered_at IS NOT NULL
         AND request.assigned_staff_id IS NULL
         AND private.job_available_to_me(request.id)
     )
$function$;

CREATE OR REPLACE FUNCTION private.job_available_for_property(target_property bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT (SELECT private.is_approved_worker())
     AND EXISTS (
       SELECT 1
       FROM public."MaintenanceRequests" AS request
       LEFT JOIN public."Units" AS unit ON unit.id = request.unit_id
       WHERE (request.property_id = target_property OR unit.property_id = target_property)
         AND request.status = 'Open'
         AND request.offered_at IS NOT NULL
         AND request.assigned_staff_id IS NULL
         AND private.job_available_to_me(request.id)
     )
$function$;

REVOKE ALL ON FUNCTION private.is_approved_worker() FROM public, anon;
REVOKE ALL ON FUNCTION private.job_available_to_me(bigint) FROM public, anon;
REVOKE ALL ON FUNCTION private.job_available_for_unit(bigint) FROM public, anon;
REVOKE ALL ON FUNCTION private.job_available_for_property(bigint) FROM public, anon;
REVOKE ALL ON FUNCTION private.landlord_owns_request(bigint) FROM public, anon;
GRANT EXECUTE ON FUNCTION private.is_approved_worker() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.job_available_to_me(bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.job_available_for_unit(bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.job_available_for_property(bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.landlord_owns_request(bigint) TO authenticated, service_role;

-- ── Who reads which price ───────────────────────────────────────────

ALTER TABLE public."MaintenanceRequestWorkerPrices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."MaintenanceRequestWorkerPrices" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."MaintenanceRequestLandlordPrices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."MaintenanceRequestLandlordPrices" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS worker_prices_select ON public."MaintenanceRequestWorkerPrices";
CREATE POLICY worker_prices_select ON public."MaintenanceRequestWorkerPrices"
  FOR SELECT TO authenticated
  USING (
    -- admin, or the worker assigned to the job
    (SELECT private.can_update_maintenance_request(maintenance_request_id))
    -- or a worker looking at it in the pool
    OR (SELECT private.job_available_to_me(maintenance_request_id))
  );

DROP POLICY IF EXISTS worker_prices_admin_insert ON public."MaintenanceRequestWorkerPrices";
CREATE POLICY worker_prices_admin_insert ON public."MaintenanceRequestWorkerPrices"
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.is_admin()));

DROP POLICY IF EXISTS worker_prices_admin_update ON public."MaintenanceRequestWorkerPrices";
CREATE POLICY worker_prices_admin_update ON public."MaintenanceRequestWorkerPrices"
  FOR UPDATE TO authenticated
  USING ((SELECT private.is_admin()))
  WITH CHECK ((SELECT private.is_admin()));

DROP POLICY IF EXISTS worker_prices_admin_delete ON public."MaintenanceRequestWorkerPrices";
CREATE POLICY worker_prices_admin_delete ON public."MaintenanceRequestWorkerPrices"
  FOR DELETE TO authenticated
  USING ((SELECT private.is_admin()));

DROP POLICY IF EXISTS landlord_prices_select ON public."MaintenanceRequestLandlordPrices";
CREATE POLICY landlord_prices_select ON public."MaintenanceRequestLandlordPrices"
  FOR SELECT TO authenticated
  USING (
    (SELECT private.is_admin())
    OR (SELECT private.landlord_owns_request(maintenance_request_id))
  );

DROP POLICY IF EXISTS landlord_prices_admin_insert ON public."MaintenanceRequestLandlordPrices";
CREATE POLICY landlord_prices_admin_insert ON public."MaintenanceRequestLandlordPrices"
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.is_admin()));

DROP POLICY IF EXISTS landlord_prices_admin_update ON public."MaintenanceRequestLandlordPrices";
CREATE POLICY landlord_prices_admin_update ON public."MaintenanceRequestLandlordPrices"
  FOR UPDATE TO authenticated
  USING ((SELECT private.is_admin()))
  WITH CHECK ((SELECT private.is_admin()));

DROP POLICY IF EXISTS landlord_prices_admin_delete ON public."MaintenanceRequestLandlordPrices";
CREATE POLICY landlord_prices_admin_delete ON public."MaintenanceRequestLandlordPrices"
  FOR DELETE TO authenticated
  USING ((SELECT private.is_admin()));

REVOKE ALL ON public."MaintenanceRequestWorkerPrices" FROM anon;
REVOKE ALL ON public."MaintenanceRequestWorkerPrices" FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."MaintenanceRequestWorkerPrices" TO authenticated;
GRANT ALL ON public."MaintenanceRequestWorkerPrices" TO service_role;
REVOKE ALL ON public."MaintenanceRequestLandlordPrices" FROM anon;
REVOKE ALL ON public."MaintenanceRequestLandlordPrices" FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."MaintenanceRequestLandlordPrices" TO authenticated;
GRANT ALL ON public."MaintenanceRequestLandlordPrices" TO service_role;

-- A job cannot sit in the pool without the price workers are shown.
CREATE OR REPLACE FUNCTION private.keep_pooled_worker_price()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public."MaintenanceRequests" AS request
    WHERE request.id = OLD.maintenance_request_id
      AND request.status = 'Open'
      AND request.offered_at IS NOT NULL
      AND request.assigned_staff_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Withdraw the job from workers before removing its price';
  END IF;
  RETURN OLD;
END;
$function$;

DROP TRIGGER IF EXISTS worker_prices_keep_pooled ON public."MaintenanceRequestWorkerPrices";
CREATE TRIGGER worker_prices_keep_pooled
  BEFORE DELETE ON public."MaintenanceRequestWorkerPrices"
  FOR EACH ROW
  EXECUTE FUNCTION private.keep_pooled_worker_price();

-- ── Workers browsing the pool: request row, photos, address ─────────
-- Comments, status history and staff notes keep using
-- private.can_select_maintenance_request (assignment required), unchanged.

DROP POLICY IF EXISTS maintenance_requests_select ON public."MaintenanceRequests";
CREATE POLICY maintenance_requests_select ON public."MaintenanceRequests"
  FOR SELECT TO authenticated
  USING (
    ((SELECT private.current_role()) = 'admin'::public.app_role)
    OR (submitted_by_tenant_id = (SELECT private.current_tenant_id()))
    OR (assigned_staff_id = (SELECT private.current_staff_id()))
    OR (SELECT private.landlord_owns_unit("MaintenanceRequests".unit_id))
    OR (
      status = 'Open'
      AND offered_at IS NOT NULL
      AND assigned_staff_id IS NULL
      AND (SELECT private.job_available_to_me("MaintenanceRequests".id))
    )
  );

DROP POLICY IF EXISTS maintenance_photos_select ON public."MaintenanceRequestPhotos";
CREATE POLICY maintenance_photos_select ON public."MaintenanceRequestPhotos"
  FOR SELECT TO authenticated
  USING (
    (SELECT private.can_select_maintenance_request("MaintenanceRequestPhotos".maintenance_request_id))
    OR (SELECT private.job_available_to_me("MaintenanceRequestPhotos".maintenance_request_id))
  );

DROP POLICY IF EXISTS maintenance_photos_storage_select ON storage.objects;
CREATE POLICY maintenance_photos_storage_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'maintenance-photos'
    AND (
      (SELECT private.can_select_maintenance_request(NULLIF(split_part(objects.name, '/', 1), '')::bigint))
      OR (SELECT private.job_available_to_me(NULLIF(split_part(objects.name, '/', 1), '')::bigint))
    )
  );

DROP POLICY IF EXISTS units_select ON public."Units";
CREATE POLICY units_select ON public."Units"
  FOR SELECT TO authenticated
  USING (
    ((SELECT private.current_role()) = 'admin'::public.app_role)
    OR (SELECT private.landlord_owns_unit("Units".id))
    OR (id = (SELECT private.current_tenant_unit_id()))
    OR (SELECT private.staff_assigned_to_unit("Units".id))
    OR (SELECT private.job_available_for_unit("Units".id))
  );

DROP POLICY IF EXISTS properties_select ON public."Properties";
CREATE POLICY properties_select ON public."Properties"
  FOR SELECT TO authenticated
  USING (
    ((SELECT private.current_role()) = 'admin'::public.app_role)
    OR (landlord_id = (SELECT private.current_landlord_id()))
    OR (id = (SELECT private.current_tenant_property_id()))
    OR (SELECT private.staff_assigned_to_property("Properties".id))
    OR (SELECT private.job_available_for_property("Properties".id))
  );

-- ── Field protection ────────────────────────────────────────────────
-- Non-admins cannot set schedule, pool or confirmation fields by a plain
-- UPDATE (prices are in their own admin-write tables). The three RPCs below set a transaction-local flag naming the one
-- transition they perform; the trigger re-checks the shape of that transition,
-- so the flag cannot widen anything else.

CREATE OR REPLACE FUNCTION private.protect_maintenance_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_role public.app_role;
  v_flow text;
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

  -- A worker proves the fix with a photo before completing.
  IF v_role = 'maintenance'::public.app_role
    AND NEW.status = 'Closed'
    AND OLD.status IS DISTINCT FROM 'Closed'
    AND NOT EXISTS (
      SELECT 1
      FROM public."MaintenanceRequestPhotos" AS photo
      WHERE photo.maintenance_request_id = NEW.id
        AND photo.uploaded_by_role = 'maintenance'::public.app_role
    )
  THEN
    RAISE EXCEPTION 'Add at least one photo of the finished work before completing this job';
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION private.protect_maintenance_request() IS
  'Non-admins cannot rewrite submission fields, schedule, pool or tenant-confirmation fields; maintenance cannot reassign and needs a work photo to complete. accept/release/tenant_fix RPCs pass through shape-checked.';

-- Reopening a completed request clears the tenant's answer (any role, any path).
CREATE OR REPLACE FUNCTION private.reset_tenant_fix_on_reopen()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  IF OLD.status = 'Closed' AND NEW.status <> 'Closed' THEN
    NEW.tenant_fix_response := NULL;
    NEW.tenant_fix_responded_at := NULL;
    NEW.tenant_fix_note := NULL;
  END IF;
  RETURN NEW;
END;
$function$;

-- Fires after maintenance_requests_protect_fields (BEFORE triggers run in name order).
DROP TRIGGER IF EXISTS maintenance_requests_reset_tenant_fix ON public."MaintenanceRequests";
CREATE TRIGGER maintenance_requests_reset_tenant_fix
  BEFORE UPDATE OF status ON public."MaintenanceRequests"
  FOR EACH ROW
  EXECUTE FUNCTION private.reset_tenant_fix_on_reopen();

-- Status history: let the workflow RPCs label the row the trigger writes.
CREATE OR REPLACE FUNCTION private.log_maintenance_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_role public.app_role;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public."MaintenanceRequestStatusHistory" (
      maintenance_request_id,
      from_status,
      to_status,
      changed_by_user_id,
      changed_by_role,
      note
    ) VALUES (
      NEW.id,
      NULL,
      NEW.status,
      auth.uid(),
      private.current_role(),
      'Created'
    );
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    BEGIN
      v_role := private.current_role();
    EXCEPTION WHEN OTHERS THEN
      v_role := NULL;
    END;

    INSERT INTO public."MaintenanceRequestStatusHistory" (
      maintenance_request_id,
      from_status,
      to_status,
      changed_by_user_id,
      changed_by_role,
      note
    ) VALUES (
      NEW.id,
      OLD.status,
      NEW.status,
      auth.uid(),
      v_role,
      NULLIF(current_setting('lg.mr_history_note', true), '')
    );
  END IF;

  RETURN NEW;
END;
$function$;

-- ── Photos: 5 from the reporter side, 5 from the worker ─────────────
-- The old cap was 5 per request in total, which let a tenant's photos use up
-- the room a worker needs for the required completion photo.

CREATE OR REPLACE FUNCTION private.enforce_maintenance_photo_cap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_is_work boolean;
  v_count integer;
BEGIN
  v_is_work := COALESCE(NEW.uploaded_by_role = 'maintenance'::public.app_role, false);

  SELECT count(*)::integer INTO v_count
  FROM public."MaintenanceRequestPhotos" AS photo
  WHERE photo.maintenance_request_id = NEW.maintenance_request_id
    AND COALESCE(photo.uploaded_by_role = 'maintenance'::public.app_role, false) = v_is_work;

  IF v_count >= 5 THEN
    IF v_is_work THEN
      RAISE EXCEPTION 'A maintenance request may have at most 5 work photos';
    END IF;
    RAISE EXCEPTION 'A maintenance request may have at most 5 photos';
  END IF;
  RETURN NEW;
END;
$function$;

-- ── Workflow RPCs ───────────────────────────────────────────────────

-- Admin: set date/time and prices, and push the job to the worker pool.
-- p_landlord_price NULL leaves the landlord price as it is.
CREATE OR REPLACE FUNCTION public.offer_maintenance_request(
  p_request_id bigint,
  p_scheduled_for timestamptz,
  p_worker_price numeric,
  p_landlord_price numeric DEFAULT NULL
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

-- Admin: take a job back out of the pool before anyone accepts it.
CREATE OR REPLACE FUNCTION public.withdraw_maintenance_offer(p_request_id bigint)
RETURNS public."MaintenanceRequests"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_request public."MaintenanceRequests";
BEGIN
  IF NOT private.is_admin() THEN
    RAISE EXCEPTION 'Only admins can withdraw a job offer' USING ERRCODE = '42501';
  END IF;

  UPDATE public."MaintenanceRequests"
  SET offered_at = NULL,
      offered_by_user_id = NULL
  WHERE id = p_request_id
    AND status = 'Open'
    AND offered_at IS NOT NULL
    AND assigned_staff_id IS NULL
  RETURNING * INTO v_request;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This job is not waiting in the worker pool';
  END IF;

  INSERT INTO public."MaintenanceRequestStatusHistory" (
    maintenance_request_id, from_status, to_status, changed_by_user_id, changed_by_role, note
  ) VALUES (
    p_request_id, 'Open', 'Open', auth.uid(), private.current_role(), 'Offer withdrawn'
  );

  RETURN v_request;
END;
$function$;

-- Worker: accept a pooled job. First accept wins.
CREATE OR REPLACE FUNCTION public.accept_maintenance_request(p_request_id bigint)
RETURNS public."MaintenanceRequests"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_staff bigint;
  v_request public."MaintenanceRequests";
BEGIN
  IF NOT private.is_approved_worker() THEN
    RAISE EXCEPTION 'Only an approved worker can accept jobs' USING ERRCODE = '42501';
  END IF;
  v_staff := private.current_staff_id();

  -- Lock the row first so two workers cannot both pass the availability check.
  SELECT * INTO v_request
  FROM public."MaintenanceRequests"
  WHERE id = p_request_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This job is not available';
  END IF;

  IF NOT private.job_available_to_me(p_request_id) THEN
    IF v_request.offered_at IS NOT NULL AND v_request.assigned_staff_id IS NOT NULL THEN
      RAISE EXCEPTION 'This job has already been taken';
    END IF;
    RAISE EXCEPTION 'This job is not available';
  END IF;

  PERFORM set_config('lg.mr_flow', 'accept', true);
  PERFORM set_config('lg.mr_history_note', 'Accepted by worker', true);
  UPDATE public."MaintenanceRequests"
  SET assigned_staff_id = v_staff,
      status = 'Scheduled',
      accepted_at = now()
  WHERE id = p_request_id
  RETURNING * INTO v_request;
  PERFORM set_config('lg.mr_flow', '', true);
  PERFORM set_config('lg.mr_history_note', '', true);

  RETURN v_request;
END;
$function$;

-- Worker: hand an accepted job back to the admin. It is not re-offered.
CREATE OR REPLACE FUNCTION public.release_maintenance_request(p_request_id bigint, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_staff bigint;
  v_reason text;
  v_request public."MaintenanceRequests";
BEGIN
  IF NOT private.is_approved_worker() THEN
    RAISE EXCEPTION 'Only an approved worker can release jobs' USING ERRCODE = '42501';
  END IF;
  v_staff := private.current_staff_id();

  v_reason := NULLIF(btrim(COALESCE(p_reason, '')), '');
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Say why you are releasing this job';
  END IF;
  IF char_length(v_reason) > 1000 THEN
    RAISE EXCEPTION 'The reason must be at most 1000 characters';
  END IF;

  SELECT * INTO v_request
  FROM public."MaintenanceRequests"
  WHERE id = p_request_id
  FOR UPDATE;
  IF NOT FOUND OR v_request.assigned_staff_id IS DISTINCT FROM v_staff THEN
    RAISE EXCEPTION 'This job is not assigned to you';
  END IF;
  IF v_request.status = 'Closed' THEN
    RAISE EXCEPTION 'A completed job cannot be released';
  END IF;

  -- The reason goes to the office thread (admin + worker only), never to the
  -- tenant-visible row or history.
  INSERT INTO public."MaintenanceRequestComments" (
    maintenance_request_id, author_user_id, author_role, author_staff_id, body, visibility
  ) VALUES (
    p_request_id, auth.uid(), 'maintenance'::public.app_role, v_staff,
    'Released this job: ' || v_reason, 'internal'
  );

  PERFORM set_config('lg.mr_flow', 'release', true);
  PERFORM set_config('lg.mr_history_note', 'Released by worker', true);
  UPDATE public."MaintenanceRequests"
  SET assigned_staff_id = NULL,
      status = 'Open',
      started_at = NULL,
      hold_reason = NULL,
      next_follow_up_date = NULL,
      offered_at = NULL,
      offered_by_user_id = NULL,
      accepted_at = NULL,
      released_at = now(),
      released_by_staff_id = v_staff
  WHERE id = p_request_id;
  PERFORM set_config('lg.mr_flow', '', true);
  PERFORM set_config('lg.mr_history_note', '', true);

  -- An Open-but-assigned job changes no status, so the trigger logged nothing.
  IF v_request.status = 'Open' THEN
    INSERT INTO public."MaintenanceRequestStatusHistory" (
      maintenance_request_id, from_status, to_status, changed_by_user_id, changed_by_role, note
    ) VALUES (
      p_request_id, 'Open', 'Open', auth.uid(), 'maintenance'::public.app_role, 'Released by worker'
    );
  END IF;
END;
$function$;

-- Tenant: after completion, confirm the fix or say it is still a problem.
CREATE OR REPLACE FUNCTION public.confirm_maintenance_request_fixed(
  p_request_id bigint,
  p_fixed boolean,
  p_note text DEFAULT NULL
)
RETURNS public."MaintenanceRequests"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_tenant bigint;
  v_note text;
  v_request public."MaintenanceRequests";
BEGIN
  v_tenant := private.current_tenant_id();
  IF v_tenant IS NULL OR private.current_role() IS DISTINCT FROM 'tenant'::public.app_role THEN
    RAISE EXCEPTION 'Only the tenant who reported the request can confirm the fix' USING ERRCODE = '42501';
  END IF;
  IF p_fixed IS NULL THEN
    RAISE EXCEPTION 'Say whether the problem is fixed';
  END IF;

  v_note := NULLIF(btrim(COALESCE(p_note, '')), '');
  IF v_note IS NOT NULL AND char_length(v_note) > 1000 THEN
    RAISE EXCEPTION 'The note must be at most 1000 characters';
  END IF;

  SELECT * INTO v_request
  FROM public."MaintenanceRequests"
  WHERE id = p_request_id
  FOR UPDATE;
  IF NOT FOUND OR v_request.submitted_by_tenant_id IS DISTINCT FROM v_tenant THEN
    RAISE EXCEPTION 'Only the tenant who reported the request can confirm the fix' USING ERRCODE = '42501';
  END IF;
  IF v_request.status <> 'Closed' THEN
    RAISE EXCEPTION 'This request is not completed yet';
  END IF;

  PERFORM set_config('lg.mr_flow', 'tenant_fix', true);
  UPDATE public."MaintenanceRequests"
  SET tenant_fix_response = CASE WHEN p_fixed THEN 'confirmed' ELSE 'not_fixed' END,
      tenant_fix_responded_at = now(),
      tenant_fix_note = v_note
  WHERE id = p_request_id
  RETURNING * INTO v_request;
  PERFORM set_config('lg.mr_flow', '', true);

  INSERT INTO public."MaintenanceRequestStatusHistory" (
    maintenance_request_id, from_status, to_status, changed_by_user_id, changed_by_role, note
  ) VALUES (
    p_request_id, 'Closed', 'Closed', auth.uid(), 'tenant'::public.app_role,
    CASE WHEN p_fixed THEN 'Tenant confirmed it is fixed' ELSE 'Tenant says it is not fixed' END
  );

  RETURN v_request;
END;
$function$;

-- Worker (or any staff login): edit own profile. Email is not editable here.
CREATE OR REPLACE FUNCTION public.update_staff_profile(
  p_first_name text,
  p_last_name text,
  p_company_name text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_services text[] DEFAULT '{}'::text[]
)
RETURNS public."Staff"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_staff bigint;
  v_first text;
  v_last text;
  v_company text;
  v_phone text;
  v_services text[];
  v_row public."Staff";
BEGIN
  v_staff := private.current_staff_id();
  IF v_staff IS NULL THEN
    RAISE EXCEPTION 'Only an approved staff login can update a staff profile' USING ERRCODE = '42501';
  END IF;

  v_first := NULLIF(btrim(COALESCE(p_first_name, '')), '');
  v_last := NULLIF(btrim(COALESCE(p_last_name, '')), '');
  IF v_first IS NULL OR v_last IS NULL THEN
    RAISE EXCEPTION 'first_name and last_name are required';
  END IF;
  IF char_length(v_first) > 80 OR char_length(v_last) > 80 THEN
    RAISE EXCEPTION 'Name fields must be at most 80 characters';
  END IF;

  v_company := NULLIF(btrim(COALESCE(p_company_name, '')), '');
  v_phone := NULLIF(btrim(COALESCE(p_phone, '')), '');

  SELECT COALESCE(array_agg(DISTINCT service ORDER BY service), '{}'::text[]) INTO v_services
  FROM unnest(COALESCE(p_services, '{}'::text[])) AS service;

  UPDATE public."Staff" AS staff
  SET first_name = v_first,
      last_name = v_last,
      company_name = v_company,
      phone = v_phone,
      services = v_services
  WHERE staff.id = v_staff
  RETURNING * INTO v_row;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Staff % not found', v_staff;
  END IF;

  RETURN v_row;
END;
$function$;

REVOKE ALL ON FUNCTION public.offer_maintenance_request(bigint, timestamptz, numeric, numeric) FROM public, anon;
REVOKE ALL ON FUNCTION public.withdraw_maintenance_offer(bigint) FROM public, anon;
REVOKE ALL ON FUNCTION public.accept_maintenance_request(bigint) FROM public, anon;
REVOKE ALL ON FUNCTION public.release_maintenance_request(bigint, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.confirm_maintenance_request_fixed(bigint, boolean, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.update_staff_profile(text, text, text, text, text[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.offer_maintenance_request(bigint, timestamptz, numeric, numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.withdraw_maintenance_offer(bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.accept_maintenance_request(bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.release_maintenance_request(bigint, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_maintenance_request_fixed(bigint, boolean, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_staff_profile(text, text, text, text, text[]) TO authenticated, service_role;

-- ── Direct thread with the Landlord Gopher office ───────────────────
-- One thread per non-admin user (worker, landlord, tenant), keyed by that
-- user. Every admin reads and answers every thread.

CREATE OR REPLACE FUNCTION private.is_office_thread_user(target_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles AS ur
    WHERE ur.user_id = target_user
      AND ur.role <> 'admin'::public.app_role
  )
$function$;

REVOKE ALL ON FUNCTION private.is_office_thread_user(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION private.is_office_thread_user(uuid) TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public."OfficeMessages" (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  thread_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  author_user_id uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  author_role public.app_role NOT NULL,
  body text NOT NULL CHECK (length(btrim(body)) > 0 AND char_length(body) <= 5000)
);

COMMENT ON TABLE public."OfficeMessages" IS
  'Direct chat between one non-admin user (thread_user_id) and the Landlord Gopher office (all admins). Not tied to a job.';

CREATE INDEX IF NOT EXISTS office_messages_thread_idx ON public."OfficeMessages" (thread_user_id, created_at);
CREATE INDEX IF NOT EXISTS office_messages_author_idx ON public."OfficeMessages" (author_user_id);

ALTER TABLE public."OfficeMessages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."OfficeMessages" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS office_messages_select ON public."OfficeMessages";
CREATE POLICY office_messages_select ON public."OfficeMessages"
  FOR SELECT TO authenticated
  USING (
    (SELECT private.is_admin())
    OR (
      thread_user_id = (SELECT auth.uid())
      AND (SELECT private.current_role()) IS NOT NULL
    )
  );

DROP POLICY IF EXISTS office_messages_insert ON public."OfficeMessages";
CREATE POLICY office_messages_insert ON public."OfficeMessages"
  FOR INSERT TO authenticated
  WITH CHECK (
    author_user_id = (SELECT auth.uid())
    AND NOT (author_role IS DISTINCT FROM (SELECT private.current_role()))
    AND (
      (
        (SELECT private.is_admin())
        AND (SELECT private.is_office_thread_user(thread_user_id))
      )
      OR (
        (SELECT private.current_role()) <> 'admin'::public.app_role
        AND thread_user_id = (SELECT auth.uid())
      )
    )
  );

DROP POLICY IF EXISTS office_messages_delete ON public."OfficeMessages";
CREATE POLICY office_messages_delete ON public."OfficeMessages"
  FOR DELETE TO authenticated
  USING ((SELECT private.is_admin()));

REVOKE ALL ON public."OfficeMessages" FROM anon;
REVOKE ALL ON public."OfficeMessages" FROM authenticated;
GRANT SELECT, INSERT, DELETE ON public."OfficeMessages" TO authenticated;
GRANT ALL ON public."OfficeMessages" TO service_role;

-- ── Read state (unread dots) ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public."OfficeThreadReads" (
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  thread_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, thread_user_id)
);

COMMENT ON TABLE public."OfficeThreadReads" IS
  'Per-user last-read time for an office thread. A non-admin tracks their own thread; each admin tracks every thread separately.';

CREATE INDEX IF NOT EXISTS office_thread_reads_thread_idx ON public."OfficeThreadReads" (thread_user_id);

ALTER TABLE public."OfficeThreadReads" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."OfficeThreadReads" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS office_thread_reads_select ON public."OfficeThreadReads";
CREATE POLICY office_thread_reads_select ON public."OfficeThreadReads"
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS office_thread_reads_insert ON public."OfficeThreadReads";
CREATE POLICY office_thread_reads_insert ON public."OfficeThreadReads"
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND (
      (SELECT private.is_admin())
      OR (
        thread_user_id = (SELECT auth.uid())
        AND (SELECT private.current_role()) IS NOT NULL
      )
    )
  );

DROP POLICY IF EXISTS office_thread_reads_update ON public."OfficeThreadReads";
CREATE POLICY office_thread_reads_update ON public."OfficeThreadReads"
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND (
      (SELECT private.is_admin())
      OR thread_user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS office_thread_reads_delete ON public."OfficeThreadReads";
CREATE POLICY office_thread_reads_delete ON public."OfficeThreadReads"
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

REVOKE ALL ON public."OfficeThreadReads" FROM anon;
REVOKE ALL ON public."OfficeThreadReads" FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."OfficeThreadReads" TO authenticated;
GRANT ALL ON public."OfficeThreadReads" TO service_role;

CREATE TABLE IF NOT EXISTS public."MaintenanceThreadReads" (
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  maintenance_request_id bigint NOT NULL
    REFERENCES public."MaintenanceRequests"(id) ON DELETE CASCADE,
  thread text NOT NULL CHECK (thread IN ('shared', 'office')),
  last_read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, maintenance_request_id, thread)
);

COMMENT ON TABLE public."MaintenanceThreadReads" IS
  'Per-user last-read time per job thread. shared = tenant_visible comments; office = internal comments (admin/maintenance only).';

CREATE INDEX IF NOT EXISTS maintenance_thread_reads_request_idx
  ON public."MaintenanceThreadReads" (maintenance_request_id);

ALTER TABLE public."MaintenanceThreadReads" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."MaintenanceThreadReads" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS maintenance_thread_reads_select ON public."MaintenanceThreadReads";
CREATE POLICY maintenance_thread_reads_select ON public."MaintenanceThreadReads"
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS maintenance_thread_reads_insert ON public."MaintenanceThreadReads";
CREATE POLICY maintenance_thread_reads_insert ON public."MaintenanceThreadReads"
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND (SELECT private.can_select_maintenance_request(maintenance_request_id))
    AND (
      thread = 'shared'
      OR (SELECT private.current_role()) IN ('admin'::public.app_role, 'maintenance'::public.app_role)
    )
  );

DROP POLICY IF EXISTS maintenance_thread_reads_update ON public."MaintenanceThreadReads";
CREATE POLICY maintenance_thread_reads_update ON public."MaintenanceThreadReads"
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND (SELECT private.can_select_maintenance_request(maintenance_request_id))
  );

DROP POLICY IF EXISTS maintenance_thread_reads_delete ON public."MaintenanceThreadReads";
CREATE POLICY maintenance_thread_reads_delete ON public."MaintenanceThreadReads"
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

REVOKE ALL ON public."MaintenanceThreadReads" FROM anon;
REVOKE ALL ON public."MaintenanceThreadReads" FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."MaintenanceThreadReads" TO authenticated;
GRANT ALL ON public."MaintenanceThreadReads" TO service_role;

-- ── Realtime for the office thread ──────────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
    AND NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'OfficeMessages'
    )
  THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public."OfficeMessages";
  END IF;
END
$$;

ALTER TABLE public."OfficeMessages" REPLICA IDENTITY FULL;

NOTIFY pgrst, 'reload schema';
