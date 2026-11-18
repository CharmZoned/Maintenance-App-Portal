-- LD-28: Tenant self-serve profile update (allowlisted columns only).
-- Writes private.tenants directly; does not open general view UPDATE to tenants.
-- Does not alter inquiries or admin record_payment.

CREATE OR REPLACE FUNCTION public.update_tenant_profile(
  p_first_name text,
  p_last_name text,
  p_mobile_phone text DEFAULT NULL,
  p_emergency_contact text DEFAULT NULL
)
RETURNS public."Tenants"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_tenant_id bigint;
  v_first text;
  v_last text;
  v_phone text;
  v_emergency text;
  v_row public."Tenants";
BEGIN
  v_tenant_id := private.current_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Only approved tenants can update their profile'
      USING ERRCODE = '42501';
  END IF;

  v_first := nullif(trim(coalesce(p_first_name, '')), '');
  v_last := nullif(trim(coalesce(p_last_name, '')), '');
  IF v_first IS NULL OR v_last IS NULL THEN
    RAISE EXCEPTION 'first_name and last_name are required';
  END IF;
  IF char_length(v_first) > 80 OR char_length(v_last) > 80 THEN
    RAISE EXCEPTION 'Name fields must be at most 80 characters';
  END IF;

  v_phone := nullif(trim(coalesce(p_mobile_phone, '')), '');
  v_emergency := nullif(trim(coalesce(p_emergency_contact, '')), '');
  IF v_phone IS NOT NULL AND char_length(v_phone) > 40 THEN
    RAISE EXCEPTION 'mobile_phone must be at most 40 characters';
  END IF;
  IF v_emergency IS NOT NULL AND char_length(v_emergency) > 200 THEN
    RAISE EXCEPTION 'emergency_contact must be at most 200 characters';
  END IF;

  UPDATE private.tenants AS t
  SET
    first_name = v_first,
    last_name = v_last,
    mobile_phone = v_phone,
    emergency_contact = v_emergency
  WHERE t.id = v_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tenant % not found', v_tenant_id;
  END IF;

  SELECT * INTO v_row
  FROM public."Tenants"
  WHERE id = v_tenant_id;

  RETURN v_row;
END;
$function$;

COMMENT ON FUNCTION public.update_tenant_profile(text, text, text, text) IS
  'LD-28: approved tenant updates own first_name/last_name/mobile_phone/emergency_contact only.';

REVOKE ALL ON FUNCTION public.update_tenant_profile(text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_tenant_profile(text, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_tenant_profile(text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_tenant_profile(text, text, text, text) TO service_role;

NOTIFY pgrst, 'reload schema';
