-- HISTORY PARITY ONLY (portal ↔ production bgjkjtfgrfiszbzatriq).
-- Version stamp matches supabase_migrations.schema_migrations on production.
-- Source: website main supabase/migrations/20261114181000_fix_listing_photo_path_check.sql (via staging pack copy)
-- Already applied on production — do NOT re-apply / repair / reset against bgjkjtfgrfiszbzatriq.
-- Plan: Project store docs/supabase-preview-migration-sync-plan.md Option 1.

-- Postgres bound quantifiers cannot exceed 255, so the first path check
-- never accepted a photo. Replace it with an unbounded class plus a length limit.

alter table public."UnitListingPhotos"
  drop constraint unit_listing_photos_path_check;

alter table public."UnitListingPhotos"
  add constraint unit_listing_photos_path_check check (
    char_length(storage_path) between 3 and 501
    and storage_path ~ '^[A-Za-z0-9][A-Za-z0-9./_-]*$'
    and storage_path !~ '\.\.'
    and position('/' in storage_path) > 0
  );
