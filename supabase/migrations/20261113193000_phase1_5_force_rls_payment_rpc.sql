-- Phase 1.5: FORCE RLS on Phase 1 tables, atomic payment ledger RPCs,
-- and narrow vendors_select (staff/admin only — landlords no longer see all vendors).
-- Does not alter inquiries or Applications.

-- ── FORCE ROW LEVEL SECURITY ──────────────────────────────────────
ALTER TABLE public."Leases" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."LeaseTenants" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."RentCharges" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."Payments" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."Vendors" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."Settings" FORCE ROW LEVEL SECURITY;

-- ── Narrow vendors_select ─────────────────────────────────────────
DROP POLICY IF EXISTS vendors_select ON public."Vendors";
CREATE POLICY vendors_select ON public."Vendors"
  FOR SELECT TO authenticated
  USING (private.is_staff_or_admin());

-- ── Payment ledger helper (status from paid balance) ──────────────
CREATE OR REPLACE FUNCTION private.rent_charge_status_for_paid(
  p_amount numeric,
  p_amount_paid numeric,
  p_due_date date
)
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN p_amount_paid >= p_amount AND p_amount > 0 THEN 'paid'
    WHEN p_amount_paid > 0 THEN 'partial'
    WHEN p_due_date < CURRENT_DATE THEN 'overdue'
    ELSE 'open'
  END;
$function$;

-- ── record_payment: insert payment + update charge atomically ─────
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

  -- Always recompute from ledger rows (heals prior drift; matches delete_payment)
  SELECT COALESCE(sum(amount), 0) INTO new_paid
  FROM public."Payments"
  WHERE charge_id = p_charge_id;

  new_status := private.rent_charge_status_for_paid(
    COALESCE(charge.amount, 0)::numeric,
    new_paid,
    charge.due_date::date
  );

  -- Preserve waived unless payment brings balance current/partial/paid
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

-- ── delete_payment: delete + recompute charge balance atomically ──
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
REVOKE ALL ON FUNCTION public.delete_payment(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_payment(bigint, numeric, text, text, text, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_payment(bigint) TO authenticated;

-- Authenticated path must use RPCs; keep SELECT for history UI.
-- SECURITY DEFINER RPCs still write as owner. Service role / SQL Editor bypass RLS.
DROP POLICY IF EXISTS payments_admin_insert ON public."Payments";
DROP POLICY IF EXISTS payments_admin_update ON public."Payments";
DROP POLICY IF EXISTS payments_admin_delete ON public."Payments";

COMMENT ON FUNCTION public.record_payment IS
  'Phase 1.5: admin-only atomic payment insert + RentCharges.amount_paid/status from SUM(Payments).';
COMMENT ON FUNCTION public.delete_payment IS
  'Phase 1.5: admin-only atomic payment delete + RentCharges balance from SUM(Payments).';
