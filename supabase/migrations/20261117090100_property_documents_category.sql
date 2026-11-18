-- LD-29: Authoritative document category for tenant portal chips
-- (Figma: All / Leases / Addenda / Notices / Other).
-- Additive. Existing rows default to 'other'. Does not alter inquiries.

ALTER TABLE public."PropertyDocuments"
  ADD COLUMN IF NOT EXISTS category text;

UPDATE public."PropertyDocuments"
SET category = 'other'
WHERE category IS NULL;

ALTER TABLE public."PropertyDocuments"
  ALTER COLUMN category SET DEFAULT 'other';

ALTER TABLE public."PropertyDocuments"
  ALTER COLUMN category SET NOT NULL;

ALTER TABLE public."PropertyDocuments"
  DROP CONSTRAINT IF EXISTS property_documents_category_check;

ALTER TABLE public."PropertyDocuments"
  ADD CONSTRAINT property_documents_category_check
  CHECK (category = ANY (ARRAY[
    'lease'::text,
    'addendum'::text,
    'notice'::text,
    'other'::text
  ]));

CREATE INDEX IF NOT EXISTS property_documents_property_category_idx
  ON public."PropertyDocuments" (property_id, category);

COMMENT ON COLUMN public."PropertyDocuments".category IS
  'Tenant portal chip category: lease | addendum | notice | other.';
