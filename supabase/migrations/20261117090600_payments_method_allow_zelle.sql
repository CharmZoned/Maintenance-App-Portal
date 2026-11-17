-- Allow settled Payments.method = zelle (tenant self-serve settle path).
-- Card intents continue to post as 'credit' (existing allowlist).
-- Does not alter inquiries.

ALTER TABLE public."Payments"
  DROP CONSTRAINT IF EXISTS "Payments_method_check";

ALTER TABLE public."Payments"
  ADD CONSTRAINT "Payments_method_check"
  CHECK (method = ANY (ARRAY[
    'cash'::text,
    'check'::text,
    'ach'::text,
    'credit'::text,
    'other'::text,
    'zelle'::text
  ]));

-- Map card intents to credit when settling; keep zelle as zelle.
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

  v_method := COALESCE(
    NULLIF(trim(coalesce(p_payment_method, '')), ''),
    CASE intent.method
      WHEN 'zelle' THEN 'zelle'
      WHEN 'ach' THEN 'ach'
      WHEN 'card' THEN 'credit'
      ELSE 'other'
    END
  );

  -- Normalize legacy/alias method strings to Payments allowlist
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
