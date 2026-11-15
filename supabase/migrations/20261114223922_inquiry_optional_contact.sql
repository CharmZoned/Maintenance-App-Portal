-- HISTORY PARITY ONLY (portal ↔ production bgjkjtfgrfiszbzatriq).
-- Version stamp matches supabase_migrations.schema_migrations on production.
-- Source: website main supabase/migrations/20261114190000_inquiry_optional_contact.sql (via staging pack copy)
-- Already applied on production — do NOT re-apply / repair / reset against bgjkjtfgrfiszbzatriq.
-- Plan: Project store docs/supabase-preview-migration-sync-plan.md Option 1.

-- Allow phone-only inquiries: email is no longer required when a phone is present.
-- App validation still requires at least one of phone or email. Do not rely on
-- this check alone for UX copy; it is a safety net for direct inserts.
--
-- Apply before (or with) the website release that accepts phone-only submissions.
-- Additive and reversible: existing rows with email stay valid.

alter table public.inquiries
  alter column email drop not null;

alter table public.inquiries
  drop constraint if exists inquiries_contact_chk;

alter table public.inquiries
  add constraint inquiries_contact_chk check (
    (email is not null and btrim(email) <> '')
    or (phone is not null and btrim(phone) <> '')
  );
