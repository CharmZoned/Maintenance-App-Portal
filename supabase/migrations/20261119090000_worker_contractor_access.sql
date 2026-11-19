-- Workers are outside contractors now (see 20261118190000_worker_job_pool.sql),
-- but several rules still treated an approved `maintenance` login as in-house
-- staff. Before this file any approved worker could:
--   * read and download EVERY property document (tenant leases and
--     landlord-only files included), upload documents, and delete any document;
--   * read the rent payment receipts and payment attempts of any unit they had
--     ever been assigned a job in, and write payment-receipt files;
--   * read the whole vendor directory;
--   * read the landlord's contact record (email, phone, preferred contact,
--     notes) for any property they had ever been assigned a job in;
--   * keep reading a tenant's email, phone and emergency contact forever after
--     a job in their unit, long after it was completed.
-- None of that is needed to do a repair. This file makes the first three
-- admin-only, closes the landlord record to workers, and limits tenant contact
-- details to the time the worker actually holds an open job there (landlord and
-- tenant access is unchanged). A worker keeps exactly what the job needs: the
-- request, its photos, the address, the tenant's name, the job chat, and the
-- tenant's contact details until the job is completed.
--
-- private.is_staff_or_admin() is left in place but no rule uses it for access
-- any more, apart from the second check inside public.register_payment_receipt,
-- which a worker can no longer reach (it first requires
-- private.can_select_payment_receipt, narrowed below).

-- ── Property documents ──────────────────────────────────────────────

-- Gates INSERT/UPDATE/DELETE on PropertyDocuments and the matching
-- property-documents storage rules.
CREATE OR REPLACE FUNCTION private.can_manage_property_documents()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT private.is_admin();
$function$;

COMMENT ON FUNCTION private.can_manage_property_documents() IS
  'Admin only. Workers are outside contractors and do not manage property documents.';

CREATE OR REPLACE FUNCTION private.can_select_property_document(
  p_property_id bigint,
  p_unit_id bigint,
  p_visibility text,
  p_uploaded_by_tenant_id bigint
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT
    CASE
      WHEN private.is_admin() THEN true
      WHEN private.current_role() = 'landlord'::public.app_role
        AND p_visibility = ANY (ARRAY['landlord'::text, 'tenant'::text])
        AND EXISTS (
          SELECT 1
          FROM public."Properties" AS p
          WHERE p.id = p_property_id
            AND p.landlord_id = private.current_landlord_id()
        )
      THEN true
      WHEN private.current_role() = 'tenant'::public.app_role
        AND p_visibility = 'tenant'
        AND p_property_id IS NOT DISTINCT FROM private.current_tenant_property_id()
        AND (
          -- Personal uploads: only the uploading tenant (not next occupant / co-tenant).
          CASE
            WHEN p_uploaded_by_tenant_id IS NOT NULL THEN
              p_uploaded_by_tenant_id IS NOT DISTINCT FROM private.current_tenant_id()
            ELSE
              (
                p_unit_id IS NULL
                OR p_unit_id IS NOT DISTINCT FROM private.current_tenant_unit_id()
              )
          END
        )
      THEN true
      ELSE false
    END;
$function$;

COMMENT ON FUNCTION private.can_select_property_document(bigint, bigint, text, bigint) IS
  'Admin sees all; landlord sees landlord/tenant docs on own properties; tenant sees tenant docs for own unit/property. Workers see none.';

-- ── Rent payments ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION private.can_select_payment_receipt(p_payment_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public."Payments" AS pay
    JOIN public."RentCharges" AS c ON c.id = pay.charge_id
    JOIN public."Leases" AS l ON l.id = c.lease_id
    WHERE pay.id = p_payment_id
      AND (
        private.is_admin()
        OR private.landlord_owns_unit(l.unit_id)
        OR l.unit_id IS NOT DISTINCT FROM private.current_tenant_unit_id()
      )
  );
$function$;

CREATE OR REPLACE FUNCTION private.can_select_payment_intent(
  p_tenant_id bigint,
  p_charge_id bigint
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT
    private.is_admin()
    OR (
      private.current_role() = 'tenant'::public.app_role
      AND p_tenant_id IS NOT DISTINCT FROM private.current_tenant_id()
    )
    OR EXISTS (
      SELECT 1
      FROM public."RentCharges" AS c
      JOIN public."Leases" AS l ON l.id = c.lease_id
      WHERE c.id = p_charge_id
        AND private.landlord_owns_unit(l.unit_id)
    );
$function$;

DROP POLICY IF EXISTS payment_receipts_admin_insert ON public."PaymentReceipts";
CREATE POLICY payment_receipts_admin_insert
  ON public."PaymentReceipts"
  FOR INSERT
  TO authenticated
  WITH CHECK (private.is_admin());

DROP POLICY IF EXISTS payment_receipts_storage_insert ON storage.objects;
CREATE POLICY payment_receipts_storage_insert
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'payment-receipts'
    AND private.is_admin()
    AND name ~ '^receipts/[0-9]+/[^/]+$'
    AND EXISTS (
      SELECT 1
      FROM public."PaymentReceipts" AS r
      WHERE r.storage_path = name
    )
  );

DROP POLICY IF EXISTS payment_receipts_storage_update ON storage.objects;
CREATE POLICY payment_receipts_storage_update
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'payment-receipts'
    AND private.is_admin()
  )
  WITH CHECK (
    bucket_id = 'payment-receipts'
    AND private.is_admin()
  );

-- ── Vendor directory (deprecated table) ─────────────────────────────

DROP POLICY IF EXISTS vendors_select ON public."Vendors";
CREATE POLICY vendors_select ON public."Vendors"
  FOR SELECT TO authenticated
  USING ((SELECT private.is_admin()));

-- ── Landlord contact record ─────────────────────────────────────────
-- Landlord Gopher is the go-between; a worker has no reason to hold the
-- landlord's email, phone or notes. private.staff_can_see_landlord() is left
-- in place but no rule uses it.

DROP POLICY IF EXISTS landlords_select ON public."Landlords";
CREATE POLICY landlords_select ON public."Landlords"
  FOR SELECT TO authenticated
  USING (
    ((SELECT private.current_role()) = 'admin'::public.app_role)
    OR (id = (SELECT private.current_landlord_id()))
    OR (SELECT private.tenant_can_see_landlord(id))
  );

-- ── Tenant contact details: only while the job is open ──────────────
-- A worker still sees the tenant's name on every job they hold or held (the
-- row rule is unchanged). Email, mobile phone and emergency contact show only
-- while the worker is assigned a job in that tenant's unit that is not yet
-- completed. Once the job is Closed (or released, or reassigned) they read as
-- NULL again.

CREATE OR REPLACE FUNCTION private.worker_has_open_job_for_tenant(target_tenant bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT (SELECT private.current_role()) = 'maintenance'::public.app_role
     AND EXISTS (
       SELECT 1
       FROM private.tenants AS tenant
       JOIN public."MaintenanceRequests" AS request ON request.unit_id = tenant.unit_id
       WHERE tenant.id = target_tenant
         AND request.assigned_staff_id = (SELECT private.current_staff_id())
         AND request.status <> 'Closed'
     )
$function$;

REVOKE ALL ON FUNCTION private.worker_has_open_job_for_tenant(bigint) FROM public, anon;
GRANT EXECUTE ON FUNCTION private.worker_has_open_job_for_tenant(bigint) TO authenticated, service_role;

-- Same columns, order and types as before; only the three contact columns gain
-- a mask. INSTEAD OF triggers and grants on the view are kept by REPLACE.
CREATE OR REPLACE VIEW public."Tenants"
WITH (security_invoker = true) AS
SELECT
  t.id,
  t.created_at,
  t.source_id,
  t.first_name,
  t.last_name,
  CASE WHEN private.can_read_tenant_pii() OR private.worker_has_open_job_for_tenant(t.id)
       THEN t.email ELSE NULL END AS email,
  CASE WHEN private.can_read_tenant_pii() OR private.worker_has_open_job_for_tenant(t.id)
       THEN t.mobile_phone ELSE NULL END AS mobile_phone,
  t.unit_id,
  t.primary_on_lease,
  t.invite_to_app,
  CASE WHEN private.can_read_tenant_pii() THEN t.notes ELSE NULL END AS notes,
  t.is_test_data,
  CASE WHEN private.can_read_tenant_pii() THEN t.date_of_birth ELSE NULL END AS date_of_birth,
  CASE WHEN private.can_read_tenant_pii() OR private.worker_has_open_job_for_tenant(t.id)
       THEN t.emergency_contact ELSE NULL END AS emergency_contact,
  CASE WHEN private.can_read_tenant_pii() THEN t.employer ELSE NULL END AS employer,
  CASE WHEN private.can_read_tenant_pii() THEN t.monthly_income ELSE NULL END AS monthly_income
FROM private.tenants t;

COMMENT ON VIEW public."Tenants" IS
  'Tenant rows. Income/DOB/employer/notes only for admin/landlord/tenant/service_role. Email/phone/emergency contact also for a worker, but only while they hold an open (not Closed) job in that tenant''s unit.';

NOTIFY pgrst, 'reload schema';
