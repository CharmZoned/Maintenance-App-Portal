-- PR #78 review fixes (must + should):
-- 1) Balance reservation on initiate + settle remaining check
-- 2) Safer processor event settle (no false processed_at; validate stripe id/amount)
-- 3) tenant_owns_rent_charge requires active lease + LeaseTenants
-- 4) Tenant personal uploads: uploaded_by_tenant_id + unit-scoped path
-- 5) register_payment_receipt RPC (caller JWT / can_select; no open service-role write)
-- Does not alter inquiries.

-- ── Ownership: active lease the caller is on ──────────────────────

CREATE OR REPLACE FUNCTION private.tenant_owns_rent_charge(p_charge_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public."RentCharges" AS c
    JOIN public."Leases" AS l ON l.id = c.lease_id
    JOIN public."LeaseTenants" AS lt ON lt.lease_id = l.id
    WHERE c.id = p_charge_id
      AND l.status = 'active'
      AND lt.tenant_id IS NOT DISTINCT FROM private.current_tenant_id()
      AND l.unit_id IS NOT DISTINCT FROM private.current_tenant_unit_id()
  );
$function$;

REVOKE ALL ON FUNCTION private.tenant_owns_rent_charge(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.tenant_owns_rent_charge(bigint) TO authenticated, service_role;

-- ── Remaining balance helper (charge must already be locked) ──────

CREATE OR REPLACE FUNCTION private.rent_charge_remaining_after_intents(
  p_charge_id bigint,
  p_exclude_intent_id bigint DEFAULT NULL
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT GREATEST(
    0,
    COALESCE((SELECT amount - amount_paid FROM public."RentCharges" WHERE id = p_charge_id), 0)
    - COALESCE((
        SELECT sum(pi.amount)
        FROM public."PaymentIntents" AS pi
        WHERE pi.charge_id = p_charge_id
          AND pi.status = ANY (ARRAY[
            'pending'::text,
            'processing'::text,
            'requires_action'::text,
            'zelle_reported'::text
          ])
          AND (p_exclude_intent_id IS NULL OR pi.id IS DISTINCT FROM p_exclude_intent_id)
      ), 0)
  );
$function$;

REVOKE ALL ON FUNCTION private.rent_charge_remaining_after_intents(bigint, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.rent_charge_remaining_after_intents(bigint, bigint) TO authenticated, service_role;

-- ── initiate_tenant_payment: reserve open intents ─────────────────

CREATE OR REPLACE FUNCTION public.initiate_tenant_payment(
  p_charge_id bigint,
  p_amount numeric,
  p_method text
)
RETURNS public."PaymentIntents"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_tenant_id bigint;
  charge public."RentCharges";
  remaining numeric;
  v_method text;
  intent public."PaymentIntents";
BEGIN
  v_tenant_id := private.current_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Only approved tenants can initiate payments'
      USING ERRCODE = '42501';
  END IF;

  v_method := lower(trim(coalesce(p_method, '')));
  IF v_method IS NULL OR v_method NOT IN ('card', 'ach', 'zelle') THEN
    RAISE EXCEPTION 'method must be card, ach, or zelle';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be positive';
  END IF;

  IF NOT private.tenant_owns_rent_charge(p_charge_id) THEN
    RAISE EXCEPTION 'Rent charge % is not payable by this tenant', p_charge_id
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO charge
  FROM public."RentCharges"
  WHERE id = p_charge_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rent charge % not found', p_charge_id;
  END IF;

  IF charge.status = 'waived' THEN
    RAISE EXCEPTION 'Cannot pay a waived charge';
  END IF;

  -- Lock open intents for this charge so concurrent initiates serialize.
  PERFORM 1
  FROM public."PaymentIntents" AS pi
  WHERE pi.charge_id = p_charge_id
    AND pi.status = ANY (ARRAY[
      'pending'::text,
      'processing'::text,
      'requires_action'::text,
      'zelle_reported'::text
    ])
  FOR UPDATE;

  remaining := private.rent_charge_remaining_after_intents(p_charge_id, NULL);
  IF remaining <= 0 THEN
    RAISE EXCEPTION 'Charge % has no remaining balance', p_charge_id;
  END IF;
  IF p_amount > remaining THEN
    RAISE EXCEPTION 'Amount % exceeds remaining balance % (including open intents)', p_amount, remaining;
  END IF;

  INSERT INTO public."PaymentIntents" (
    charge_id,
    tenant_id,
    amount,
    method,
    status,
    processor,
    client_reference,
    is_test_data
  ) VALUES (
    p_charge_id,
    v_tenant_id,
    p_amount,
    v_method,
    'pending',
    CASE WHEN v_method = 'zelle' THEN 'manual_zelle' ELSE 'stripe' END,
    NULL,
    COALESCE(charge.is_test_data, false)
  )
  RETURNING * INTO intent;

  UPDATE public."PaymentIntents"
  SET
    client_reference = 'LG-' || intent.charge_id::text || '-' || intent.id::text,
    updated_at = now()
  WHERE id = intent.id
  RETURNING * INTO intent;

  RETURN intent;
END;
$function$;

-- ── settle: refuse overpay under charge lock ──────────────────────

CREATE OR REPLACE FUNCTION private.settle_payment_intent(
  p_intent_id bigint,
  p_paid_at timestamptz DEFAULT now(),
  p_payment_method text DEFAULT NULL,
  p_reference text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS public."PaymentIntents"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  intent public."PaymentIntents";
  charge public."RentCharges";
  new_payment_id bigint;
  new_paid numeric;
  new_status text;
  v_method text;
  live_remaining numeric;
BEGIN
  SELECT * INTO intent
  FROM public."PaymentIntents"
  WHERE id = p_intent_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment intent % not found', p_intent_id;
  END IF;

  IF intent.status = 'succeeded' AND intent.payment_id IS NOT NULL THEN
    RETURN intent;
  END IF;

  IF intent.status = 'canceled' THEN
    RAISE EXCEPTION 'Cannot settle canceled payment intent %', p_intent_id;
  END IF;

  IF intent.status = 'failed' THEN
    RAISE EXCEPTION 'Cannot settle failed payment intent %', p_intent_id;
  END IF;

  PERFORM set_config('private.rent_charge_ledger_ok', '1', true);

  SELECT * INTO charge
  FROM public."RentCharges"
  WHERE id = intent.charge_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rent charge % not found', intent.charge_id;
  END IF;

  live_remaining := COALESCE(charge.amount, 0) - COALESCE(charge.amount_paid, 0);
  IF intent.amount > live_remaining THEN
    RAISE EXCEPTION
      'Cannot settle intent %: amount % exceeds live remaining balance %',
      p_intent_id, intent.amount, live_remaining;
  END IF;

  v_method := COALESCE(
    NULLIF(trim(coalesce(p_payment_method, '')), ''),
    CASE intent.method
      WHEN 'zelle' THEN 'zelle'
      WHEN 'ach' THEN 'ach'
      WHEN 'card' THEN 'credit'
      ELSE 'other'
    END
  );
  IF v_method = 'card' THEN
    v_method := 'credit';
  END IF;

  INSERT INTO public."Payments" (charge_id, amount, method, reference, notes, paid_at)
  VALUES (
    intent.charge_id,
    intent.amount,
    v_method,
    COALESCE(NULLIF(trim(coalesce(p_reference, '')), ''), intent.client_reference),
    p_notes,
    COALESCE(p_paid_at, now())
  )
  RETURNING id INTO new_payment_id;

  SELECT COALESCE(sum(amount), 0) INTO new_paid
  FROM public."Payments"
  WHERE charge_id = intent.charge_id;

  new_status := private.rent_charge_status_for_paid(
    COALESCE(charge.amount, 0)::numeric,
    new_paid,
    charge.due_date::date
  );

  IF charge.status = 'waived' AND new_paid <= 0 THEN
    new_status := 'waived';
  END IF;

  UPDATE public."RentCharges"
  SET amount_paid = new_paid,
      status = new_status
  WHERE id = intent.charge_id;

  UPDATE public."PaymentIntents"
  SET
    status = 'succeeded',
    payment_id = new_payment_id,
    updated_at = now(),
    failure_reason = NULL
  WHERE id = p_intent_id
  RETURNING * INTO intent;

  RETURN intent;
END;
$function$;

REVOKE ALL ON FUNCTION private.settle_payment_intent(bigint, timestamptz, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.settle_payment_intent(bigint, timestamptz, text, text, text) TO service_role;

-- ── Processor event settle: no false processed_at ─────────────────

CREATE OR REPLACE FUNCTION public.record_processor_event_and_settle(
  p_provider text,
  p_event_id text,
  p_event_type text,
  p_payload jsonb,
  p_intent_id bigint DEFAULT NULL,
  p_settle boolean DEFAULT false,
  p_reference text DEFAULT NULL,
  p_processor_payment_id text DEFAULT NULL,
  p_amount_cents bigint DEFAULT NULL
)
RETURNS public."PaymentProcessorEvents"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  ev public."PaymentProcessorEvents";
  intent public."PaymentIntents";
  v_intent_id bigint;
  expected_cents bigint;
BEGIN
  IF coalesce(auth.jwt() ->> 'role', '') IS DISTINCT FROM 'service_role'
     AND (SELECT auth.uid()) IS NOT NULL
  THEN
    RAISE EXCEPTION 'Only service_role can record processor events'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public."PaymentProcessorEvents" (
    provider, event_id, event_type, payload, payment_intent_id
  ) VALUES (
    p_provider,
    p_event_id,
    p_event_type,
    COALESCE(p_payload, '{}'::jsonb),
    p_intent_id
  )
  ON CONFLICT (provider, event_id) DO UPDATE
    SET
      event_type = EXCLUDED.event_type,
      payload = EXCLUDED.payload,
      payment_intent_id = COALESCE(
        public."PaymentProcessorEvents".payment_intent_id,
        EXCLUDED.payment_intent_id
      )
  RETURNING * INTO ev;

  IF ev.processed_at IS NOT NULL THEN
    RETURN ev;
  END IF;

  IF NOT p_settle THEN
    UPDATE public."PaymentProcessorEvents"
    SET processed_at = now(), processing_error = NULL
    WHERE id = ev.id
    RETURNING * INTO ev;
    RETURN ev;
  END IF;

  -- Settle path: resolve intent, validate, settle, then mark processed.
  v_intent_id := COALESCE(ev.payment_intent_id, p_intent_id);

  IF v_intent_id IS NULL AND nullif(trim(coalesce(p_processor_payment_id, '')), '') IS NOT NULL THEN
    SELECT id INTO v_intent_id
    FROM public."PaymentIntents"
    WHERE processor_payment_id = trim(p_processor_payment_id)
    ORDER BY id DESC
    LIMIT 1;
  END IF;

  IF v_intent_id IS NULL THEN
    UPDATE public."PaymentProcessorEvents"
    SET processing_error = 'settle requested but payment intent could not be resolved'
    WHERE id = ev.id;
    RAISE EXCEPTION 'settle requested but payment intent could not be resolved'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO intent
  FROM public."PaymentIntents"
  WHERE id = v_intent_id
  FOR UPDATE;

  IF NOT FOUND THEN
    UPDATE public."PaymentProcessorEvents"
    SET processing_error = 'payment intent ' || v_intent_id::text || ' not found',
        payment_intent_id = v_intent_id
    WHERE id = ev.id;
    RAISE EXCEPTION 'payment intent % not found', v_intent_id;
  END IF;

  IF intent.processor IS DISTINCT FROM 'stripe' THEN
    UPDATE public."PaymentProcessorEvents"
    SET processing_error = 'intent processor is not stripe',
        payment_intent_id = v_intent_id
    WHERE id = ev.id;
    RAISE EXCEPTION 'intent % processor is not stripe', v_intent_id;
  END IF;

  IF nullif(trim(coalesce(p_processor_payment_id, '')), '') IS NOT NULL
     AND intent.processor_payment_id IS DISTINCT FROM trim(p_processor_payment_id)
  THEN
    UPDATE public."PaymentProcessorEvents"
    SET processing_error = 'processor_payment_id mismatch',
        payment_intent_id = v_intent_id
    WHERE id = ev.id;
    RAISE EXCEPTION 'processor_payment_id mismatch for intent %', v_intent_id;
  END IF;

  IF p_amount_cents IS NOT NULL THEN
    expected_cents := round(intent.amount * 100)::bigint;
    IF p_amount_cents IS DISTINCT FROM expected_cents THEN
      UPDATE public."PaymentProcessorEvents"
      SET processing_error = 'amount mismatch',
          payment_intent_id = v_intent_id
      WHERE id = ev.id;
      RAISE EXCEPTION 'amount mismatch for intent %: stripe % cents vs intent % cents',
        v_intent_id, p_amount_cents, expected_cents;
    END IF;
  END IF;

  BEGIN
    PERFORM private.settle_payment_intent(
      v_intent_id,
      now(),
      NULL,
      COALESCE(p_reference, intent.processor_payment_id),
      'Processor event ' || p_event_type
    );

    UPDATE public."PaymentProcessorEvents"
    SET
      processed_at = now(),
      processing_error = NULL,
      payment_intent_id = v_intent_id
    WHERE id = ev.id
    RETURNING * INTO ev;

    RETURN ev;
  EXCEPTION WHEN OTHERS THEN
    UPDATE public."PaymentProcessorEvents"
    SET
      processing_error = SQLERRM,
      payment_intent_id = v_intent_id
    WHERE id = ev.id;
    RAISE;
  END;
END;
$function$;

REVOKE ALL ON FUNCTION public.record_processor_event_and_settle(text, text, text, jsonb, bigint, boolean, text, text, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_processor_event_and_settle(text, text, text, jsonb, bigint, boolean, text, text, bigint) FROM anon;
REVOKE ALL ON FUNCTION public.record_processor_event_and_settle(text, text, text, jsonb, bigint, boolean, text, text, bigint) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.record_processor_event_and_settle(text, text, text, jsonb, bigint, boolean, text, text, bigint) TO service_role;

-- Drop old 7-arg overload if present so callers cannot hit the unsafe version.
DROP FUNCTION IF EXISTS public.record_processor_event_and_settle(text, text, text, jsonb, bigint, boolean, text);

-- Refuse overwriting a different Stripe PaymentIntent id.
CREATE OR REPLACE FUNCTION public.attach_payment_intent_processor_id(
  p_intent_id bigint,
  p_processor_payment_id text,
  p_status text DEFAULT 'processing'
)
RETURNS public."PaymentIntents"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  intent public."PaymentIntents";
  v_status text;
BEGIN
  IF coalesce(auth.jwt() ->> 'role', '') IS DISTINCT FROM 'service_role'
     AND private.current_tenant_id() IS NULL
  THEN
    RAISE EXCEPTION 'Forbidden'
      USING ERRCODE = '42501';
  END IF;

  v_status := COALESCE(NULLIF(trim(coalesce(p_status, '')), ''), 'processing');
  IF v_status NOT IN ('pending', 'processing', 'requires_action') THEN
    RAISE EXCEPTION 'Invalid attach status %', v_status;
  END IF;

  IF nullif(trim(coalesce(p_processor_payment_id, '')), '') IS NULL THEN
    RAISE EXCEPTION 'processor_payment_id required';
  END IF;

  SELECT * INTO intent
  FROM public."PaymentIntents"
  WHERE id = p_intent_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment intent % not found', p_intent_id;
  END IF;

  IF coalesce(auth.jwt() ->> 'role', '') IS DISTINCT FROM 'service_role'
     AND intent.tenant_id IS DISTINCT FROM private.current_tenant_id()
  THEN
    RAISE EXCEPTION 'Forbidden'
      USING ERRCODE = '42501';
  END IF;

  IF intent.processor_payment_id IS NOT NULL
     AND intent.processor_payment_id IS DISTINCT FROM trim(p_processor_payment_id)
  THEN
    RAISE EXCEPTION 'Intent % already attached to a different processor payment', p_intent_id;
  END IF;

  IF intent.status NOT IN ('pending', 'processing', 'requires_action') THEN
    RAISE EXCEPTION 'Intent % cannot attach processor id from status %', p_intent_id, intent.status;
  END IF;

  UPDATE public."PaymentIntents"
  SET
    processor_payment_id = trim(p_processor_payment_id),
    processor = COALESCE(processor, 'stripe'),
    status = v_status,
    updated_at = now()
  WHERE id = p_intent_id
  RETURNING * INTO intent;

  RETURN intent;
END;
$function$;

REVOKE ALL ON FUNCTION public.attach_payment_intent_processor_id(bigint, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.attach_payment_intent_processor_id(bigint, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.attach_payment_intent_processor_id(bigint, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.attach_payment_intent_processor_id(bigint, text, text) TO service_role;

-- ── Receipt register RPC (JWT / can_select) ───────────────────────

CREATE OR REPLACE FUNCTION public.register_payment_receipt(
  p_payment_id bigint,
  p_file_name text DEFAULT 'receipt.pdf',
  p_content_type text DEFAULT 'application/pdf',
  p_byte_size bigint DEFAULT NULL
)
RETURNS public."PaymentReceipts"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_path text;
  v_file text;
  v_ctype text;
  receipt public."PaymentReceipts";
BEGIN
  IF (SELECT auth.uid()) IS NULL
     AND coalesce(auth.jwt() ->> 'role', '') IS DISTINCT FROM 'service_role'
  THEN
    RAISE EXCEPTION 'Authentication required'
      USING ERRCODE = '42501';
  END IF;

  IF NOT private.can_select_payment_receipt(p_payment_id) THEN
    RAISE EXCEPTION 'Forbidden'
      USING ERRCODE = '42501';
  END IF;

  -- Generation/write: staff/admin, or service_role (trusted worker) after can_select.
  IF coalesce(auth.jwt() ->> 'role', '') IS DISTINCT FROM 'service_role'
     AND NOT private.is_staff_or_admin()
  THEN
    RAISE EXCEPTION 'Only staff/admin can register payment receipts'
      USING ERRCODE = '42501';
  END IF;

  v_file := COALESCE(nullif(trim(coalesce(p_file_name, '')), ''), 'receipt.pdf');
  v_ctype := COALESCE(nullif(trim(coalesce(p_content_type, '')), ''), 'application/pdf');
  v_path := 'receipts/' || p_payment_id::text || '/' || regexp_replace(v_file, '[/\\]+', '_', 'g');

  INSERT INTO public."PaymentReceipts" (
    payment_id, storage_path, file_name, content_type, byte_size, generated_at
  ) VALUES (
    p_payment_id, v_path, v_file, v_ctype, p_byte_size, now()
  )
  ON CONFLICT (payment_id) DO UPDATE
    SET
      file_name = EXCLUDED.file_name,
      content_type = EXCLUDED.content_type,
      byte_size = EXCLUDED.byte_size,
      generated_at = now(),
      storage_path = EXCLUDED.storage_path
  RETURNING * INTO receipt;

  RETURN receipt;
END;
$function$;

COMMENT ON FUNCTION public.register_payment_receipt(bigint, text, text, bigint) IS
  'LD-30: register receipt metadata when caller can_select the payment; staff/admin or service_role only.';

REVOKE ALL ON FUNCTION public.register_payment_receipt(bigint, text, text, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.register_payment_receipt(bigint, text, text, bigint) FROM anon;
GRANT EXECUTE ON FUNCTION public.register_payment_receipt(bigint, text, text, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_payment_receipt(bigint, text, text, bigint) TO service_role;

-- ── Personal tenant uploads ───────────────────────────────────────

ALTER TABLE public."PropertyDocuments"
  ADD COLUMN IF NOT EXISTS uploaded_by_tenant_id bigint
  REFERENCES private.tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS property_documents_uploaded_by_tenant_idx
  ON public."PropertyDocuments" (uploaded_by_tenant_id)
  WHERE uploaded_by_tenant_id IS NOT NULL;

-- Allow property-level OR property/unit-scoped paths.
ALTER TABLE public."PropertyDocuments"
  DROP CONSTRAINT IF EXISTS property_documents_path_shape;

ALTER TABLE public."PropertyDocuments"
  ADD CONSTRAINT property_documents_path_shape
  CHECK (
    storage_path ~ ('^' || property_id::text || '/[^/]+$')
    OR (
      unit_id IS NOT NULL
      AND storage_path ~ ('^' || property_id::text || '/' || unit_id::text || '/[^/]+$')
    )
  );

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
      WHEN private.is_staff_or_admin() THEN true
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

-- Keep 3-arg callers working by wrapping.
CREATE OR REPLACE FUNCTION private.can_select_property_document(
  p_property_id bigint,
  p_unit_id bigint,
  p_visibility text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT private.can_select_property_document(p_property_id, p_unit_id, p_visibility, NULL);
$function$;

DROP POLICY IF EXISTS property_documents_select ON public."PropertyDocuments";
CREATE POLICY property_documents_select
  ON public."PropertyDocuments"
  FOR SELECT
  TO authenticated
  USING (
    private.can_select_property_document(
      property_id,
      unit_id,
      visibility,
      uploaded_by_tenant_id
    )
  );

DROP POLICY IF EXISTS property_documents_storage_select ON storage.objects;
CREATE POLICY property_documents_storage_select
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'property-documents'
    AND EXISTS (
      SELECT 1
      FROM public."PropertyDocuments" AS doc
      WHERE doc.storage_path = name
        AND private.can_select_property_document(
          doc.property_id,
          doc.unit_id,
          doc.visibility,
          doc.uploaded_by_tenant_id
        )
    )
  );

DROP POLICY IF EXISTS property_documents_storage_insert ON storage.objects;
CREATE POLICY property_documents_storage_insert
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'property-documents'
    AND (
      name ~ '^[0-9]+/[^/]+$'
      OR name ~ '^[0-9]+/[0-9]+/[^/]+$'
    )
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
              doc.visibility,
              doc.uploaded_by_tenant_id
            )
          )
        )
    )
  );

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
  v_tenant_id bigint;
  v_category text;
  v_title text;
  v_file text;
  v_path text;
  doc public."PropertyDocuments";
BEGIN
  v_tenant_id := private.current_tenant_id();
  IF v_tenant_id IS NULL THEN
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

  -- Prefer unit-scoped path to avoid property-wide filename collisions.
  IF v_path !~ ('^' || v_property_id::text || '/' || v_unit_id::text || '/[^/]+$') THEN
    RAISE EXCEPTION
      'storage_path must be {property_id}/{unit_id}/{filename} for property % unit %',
      v_property_id, v_unit_id;
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
    uploaded_by_tenant_id,
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
    v_tenant_id,
    nullif(trim(coalesce(p_notes, '')), ''),
    false
  )
  RETURNING * INTO doc;

  RETURN doc;
END;
$function$;

NOTIFY pgrst, 'reload schema';
