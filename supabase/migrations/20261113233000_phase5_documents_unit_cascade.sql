-- Phase 5 follow-up: unit delete must not widen tenant document ACL.
-- Was ON DELETE SET NULL → unit-scoped tenant docs became property-wide.
-- Additive. Does not alter inquiries.

ALTER TABLE public."PropertyDocuments"
  DROP CONSTRAINT IF EXISTS "PropertyDocuments_unit_id_fkey";

ALTER TABLE public."PropertyDocuments"
  ADD CONSTRAINT "PropertyDocuments_unit_id_fkey"
  FOREIGN KEY (unit_id)
  REFERENCES public."Units"(id)
  ON DELETE CASCADE;

COMMENT ON CONSTRAINT "PropertyDocuments_unit_id_fkey" ON public."PropertyDocuments" IS
  'Unit-scoped docs are removed with the unit so tenant ACL cannot widen to property-wide.';
