-- HISTORY PARITY ONLY (portal ↔ production bgjkjtfgrfiszbzatriq).
-- Version stamp matches supabase_migrations.schema_migrations on production.
-- Source: website main supabase/migrations/20261114000000_inquiry_kinds_and_submission_ids.sql (via staging pack copy)
-- Already applied on production — do NOT re-apply / repair / reset against bgjkjtfgrfiszbzatriq.
-- Plan: Project store docs/supabase-preview-migration-sync-plan.md Option 1.

-- Property inquiries (a question about one listing) share the inquiries table with
-- general owner inquiries. client_submission_id stops a double-click or a retry
-- from inserting the same submission twice. Nullable on purpose, matching
-- MaintenanceRequests: rows written before this column existed stay valid, and
-- Postgres allows many nulls under a partial unique index.
--
-- Apply this migration before deploying the website change that writes these
-- columns. It is additive: existing general inquiries still insert.

alter table public.inquiries
  add column kind text not null default 'general',
  add column listing_id text,
  add column listing_label text,
  add column listing_sample boolean not null default false,
  add column client_submission_id uuid;

alter table public.inquiries
  add constraint inquiries_kind_chk check (kind in ('general', 'property')),
  add constraint inquiries_listing_id_chk check (
    listing_id is null or char_length(listing_id) between 1 and 80
  ),
  add constraint inquiries_listing_label_chk check (
    listing_label is null or char_length(listing_label) between 1 and 200
  ),
  add constraint inquiries_kind_shape_chk check (
    (
      kind = 'general'
      and listing_id is null
      and listing_label is null
      and listing_sample = false
    )
    or (kind = 'property' and listing_id is not null)
  );

create unique index inquiries_client_submission_id_key
  on public.inquiries (client_submission_id)
  where client_submission_id is not null;

create index inquiries_listing_id_idx
  on public.inquiries (listing_id)
  where listing_id is not null;

-- RLS stays enabled with no policies (see the create_inquiries migration).
-- anon and authenticated still cannot read or write; the server uses the secret key.
