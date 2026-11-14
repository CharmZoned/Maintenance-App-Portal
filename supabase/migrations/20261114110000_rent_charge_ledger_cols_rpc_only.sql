-- Lock RentCharges.amount_paid + status to record_payment / delete_payment only
-- (authenticated path). Ledger totals must match SUM(Payments).
-- Emulator/SQL-editor sessions without auth.uid() remain usable for fixtures.
-- Does not apply live from agents — ops after merge.

CREATE OR REPLACE FUNCTION private.guard_rent_charge_ledger_cols()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  IF TG_OP = 'UPDATE'
     AND (
       NEW.amount_paid IS DISTINCT FROM OLD.amount_paid
       OR NEW.status IS DISTINCT FROM OLD.status
     )
     AND current_setting('private.rent_charge_ledger_ok', true) IS DISTINCT FROM '1'
     AND (SELECT auth.uid()) IS NOT NULL
  THEN
    RAISE EXCEPTION
      'RentCharges.amount_paid and status may only change via record_payment or delete_payment'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS rent_charges_ledger_cols_guard ON public."RentCharges";
CREATE TRIGGER rent_charges_ledger_cols_guard
  BEFORE UPDATE ON public."RentCharges"
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_rent_charge_ledger_cols();

CREATE OR REPLACE FUNCTION public.record_payment(
  p_charge_id bigint,
  p_amount numeric,
  p_method text DEFAULT 'cash',
  p_reference text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_paid_at timestamptz DEFAULT now()
)
RETURNS public."RentCharges"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  charge public."RentCharges";
  new_paid numeric;
  new_status text;
BEGIN
  IF NOT private.is_admin() THEN
    RAISE EXCEPTION 'Only admins can record payments';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be positive';
  END IF;

  PERFORM set_config('private.rent_charge_ledger_ok', '1', true);

  SELECT * INTO charge
  FROM public."RentCharges"
  WHERE id = p_charge_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rent charge % not found', p_charge_id;
  END IF;

  INSERT INTO public."Payments" (charge_id, amount, method, reference, notes, paid_at)
  VALUES (
    p_charge_id,
    p_amount,
    COALESCE(NULLIF(trim(p_method), ''), 'cash'),
    p_reference,
    p_notes,
    COALESCE(p_paid_at, now())
  );

  SELECT COALESCE(sum(amount), 0) INTO new_paid
  FROM public."Payments"
  WHERE charge_id = p_charge_id;

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
  WHERE id = p_charge_id
  RETURNING * INTO charge;

  RETURN charge;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_payment(p_payment_id bigint)
RETURNS public."RentCharges"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  payment public."Payments";
  charge public."RentCharges";
  new_paid numeric;
  new_status text;
BEGIN
  IF NOT private.is_admin() THEN
    RAISE EXCEPTION 'Only admins can delete payments';
  END IF;

  PERFORM set_config('private.rent_charge_ledger_ok', '1', true);

  SELECT * INTO payment
  FROM public."Payments"
  WHERE id = p_payment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment % not found', p_payment_id;
  END IF;

  SELECT * INTO charge
  FROM public."RentCharges"
  WHERE id = payment.charge_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rent charge % not found for payment %', payment.charge_id, p_payment_id;
  END IF;

  DELETE FROM public."Payments" WHERE id = p_payment_id;

  SELECT COALESCE(sum(amount), 0) INTO new_paid
  FROM public."Payments"
  WHERE charge_id = charge.id;

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
  WHERE id = charge.id
  RETURNING * INTO charge;

  RETURN charge;
END;
$function$;

REVOKE ALL ON FUNCTION public.record_payment(bigint, numeric, text, text, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_payment(bigint, numeric, text, text, text, timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public.delete_payment(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_payment(bigint) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_payment(bigint, numeric, text, text, text, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_payment(bigint) TO authenticated;

COMMENT ON FUNCTION public.record_payment IS
  'Admin-only atomic payment insert + RentCharges.amount_paid/status from SUM(Payments). Sets private.rent_charge_ledger_ok for the ledger-column guard.';
COMMENT ON FUNCTION public.delete_payment IS
  'Admin-only atomic payment delete + RentCharges balance from SUM(Payments). Sets private.rent_charge_ledger_ok for the ledger-column guard.';
COMMENT ON FUNCTION private.guard_rent_charge_ledger_cols IS
  'Blocks authenticated UPDATEs of RentCharges.amount_paid/status unless private.rent_charge_ledger_ok=1 (payment RPCs).';
