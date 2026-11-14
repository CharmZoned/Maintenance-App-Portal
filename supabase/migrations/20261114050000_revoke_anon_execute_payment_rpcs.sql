-- WS-S S2 hygiene #3: revoke anon EXECUTE on payment ledger RPCs.
-- Phase 1.5 already REVOKE FROM PUBLIC + GRANT TO authenticated, but default
-- privileges (emulator shim / Supabase) can still leave EXECUTE on anon.
-- Confirmed payment RPCs in public schema: record_payment, delete_payment only.

REVOKE ALL ON FUNCTION public.record_payment(bigint, numeric, text, text, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_payment(bigint, numeric, text, text, text, timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public.delete_payment(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_payment(bigint) FROM anon;

GRANT EXECUTE ON FUNCTION public.record_payment(bigint, numeric, text, text, text, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_payment(bigint) TO authenticated;
