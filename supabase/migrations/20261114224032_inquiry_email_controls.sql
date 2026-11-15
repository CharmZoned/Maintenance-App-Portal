-- HISTORY PARITY ONLY (portal ↔ production bgjkjtfgrfiszbzatriq).
-- Version stamp matches supabase_migrations.schema_migrations on production.
-- Source: website PR #3 branch cursor/inquiry-email-notifications-c2b3
--   supabase/migrations/20261114200000_inquiry_email_controls.sql
-- Already applied on production — do NOT re-apply / repair / reset against bgjkjtfgrfiszbzatriq.
-- Plan: Project store docs/supabase-preview-migration-sync-plan.md Option 1.

-- Hourly send budget and an office-mail outbox. Not applied to production by this change.
-- Leave the Resend variables unset in production. The API does not call Resend unless
-- save_inquiry_with_office_mail succeeds, so email stays off until this migration is applied
-- on the database that preview uses.
--
-- Both functions are security invoker and executable only by service_role. The tables have
-- row level security and no policies. The server-side secret key bypasses RLS; anon does not.
-- reserve_inquiry_email_budgets locks every applicable bucket and increments all of them
-- or none. save_inquiry_with_office_mail does that reservation and both inserts in one
-- transaction, so a refused budget writes nothing and a failed outbox insert does not
-- leave an inquiry behind.

create table public.inquiry_email_budget (
  bucket_key text primary key check (char_length(bucket_key) between 1 and 320),
  window_start timestamptz not null,
  hits integer not null check (hits >= 0)
);

alter table public.inquiry_email_budget enable row level security;

create table public.inquiry_email_outbox (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  client_submission_id uuid not null,
  role text not null check (role = 'internal'),
  status text not null check (status in ('pending', 'sent', 'failed')),
  to_email text not null check (char_length(to_email) between 3 and 254),
  reply_to text check (reply_to is null or char_length(reply_to) between 3 and 254),
  subject text not null check (char_length(subject) between 1 and 200),
  body text not null check (char_length(body) between 1 and 20000),
  idempotency_key text not null unique check (char_length(idempotency_key) between 1 and 200),
  attempts integer not null default 0 check (attempts >= 0 and attempts <= 20),
  last_error text check (last_error is null or char_length(last_error) <= 200),
  next_attempt_at timestamptz not null default now()
);

alter table public.inquiry_email_outbox enable row level security;

create index inquiry_email_outbox_due_idx
  on public.inquiry_email_outbox (next_attempt_at)
  where status = 'pending';

create or replace function public.reserve_inquiry_email_budgets(
  p_ip_key text,
  p_recipient_key text,
  p_global_key text,
  p_ip_limit integer,
  p_recipient_limit integer,
  p_global_limit integer,
  p_window_seconds integer
)
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_start timestamptz;
  v_keys text[];
  v_seen integer := 0;
  v_limit integer;
  r record;
begin
  if p_window_seconds is null or p_window_seconds < 60 or p_window_seconds > 86400 then
    return 'invalid';
  end if;
  if p_ip_key is null or char_length(btrim(p_ip_key)) = 0 or char_length(p_ip_key) > 320 then
    return 'invalid';
  end if;
  if p_global_key is null or char_length(btrim(p_global_key)) = 0 or char_length(p_global_key) > 320 then
    return 'invalid';
  end if;
  if p_ip_limit is null or p_ip_limit < 1 or p_ip_limit > 100000 then
    return 'invalid';
  end if;
  if p_global_limit is null or p_global_limit < 1 or p_global_limit > 100000 then
    return 'invalid';
  end if;

  if p_recipient_key is not null and char_length(btrim(p_recipient_key)) > 0 then
    if char_length(p_recipient_key) > 320
      or p_recipient_limit is null
      or p_recipient_limit < 1
      or p_recipient_limit > 100000 then
      return 'invalid';
    end if;
    v_keys := array[p_ip_key, p_recipient_key, p_global_key];
  else
    v_keys := array[p_ip_key, p_global_key];
  end if;

  v_start := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds
  );

  insert into public.inquiry_email_budget (bucket_key, window_start, hits)
  select key, v_start, 0
  from unnest(v_keys) as key
  on conflict (bucket_key) do nothing;

  -- Lock in bucket_key order. A slot already at its cap returns before any hit changes.
  for r in
    select bucket_key, hits, window_start
    from public.inquiry_email_budget
    where bucket_key = any (v_keys)
    order by bucket_key
    for update
  loop
    v_seen := v_seen + 1;
    v_limit := case r.bucket_key
      when p_ip_key then p_ip_limit
      when p_global_key then p_global_limit
      else p_recipient_limit
    end;
    if r.window_start = v_start and r.hits >= v_limit then
      return 'limited';
    end if;
  end loop;

  if v_seen <> cardinality(v_keys) then
    return 'invalid';
  end if;

  update public.inquiry_email_budget as budget
  set
    hits = case when budget.window_start = v_start then budget.hits + 1 else 1 end,
    window_start = v_start
  where budget.bucket_key = any (v_keys);

  return 'allowed';
end;
$$;

create or replace function public.save_inquiry_with_office_mail(
  p_inquiry jsonb,
  p_outbox jsonb,
  p_ip_key text,
  p_recipient_key text,
  p_global_key text,
  p_ip_limit integer,
  p_recipient_limit integer,
  p_global_limit integer,
  p_window_seconds integer
)
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_budget text;
  v_submission uuid;
begin
  v_submission := (p_inquiry->>'client_submission_id')::uuid;

  begin
    v_budget := public.reserve_inquiry_email_budgets(
      p_ip_key,
      p_recipient_key,
      p_global_key,
      p_ip_limit,
      p_recipient_limit,
      p_global_limit,
      p_window_seconds
    );
    if v_budget = 'limited' then
      return 'limited';
    end if;
    if v_budget <> 'allowed' then
      return 'invalid';
    end if;

    insert into public.inquiries (
      first_name,
      last_name,
      phone,
      email,
      referral_source,
      message,
      kind,
      listing_id,
      listing_label,
      listing_sample,
      client_submission_id
    )
    values (
      p_inquiry->>'first_name',
      nullif(p_inquiry->>'last_name', ''),
      nullif(p_inquiry->>'phone', ''),
      nullif(p_inquiry->>'email', ''),
      nullif(p_inquiry->>'referral_source', ''),
      nullif(p_inquiry->>'message', ''),
      p_inquiry->>'kind',
      nullif(p_inquiry->>'listing_id', ''),
      nullif(p_inquiry->>'listing_label', ''),
      coalesce((p_inquiry->>'listing_sample')::boolean, false),
      v_submission
    );

    insert into public.inquiry_email_outbox (
      client_submission_id,
      role,
      status,
      to_email,
      reply_to,
      subject,
      body,
      idempotency_key,
      attempts,
      next_attempt_at
    )
    values (
      v_submission,
      'internal',
      'pending',
      p_outbox->>'to_email',
      nullif(p_outbox->>'reply_to', ''),
      p_outbox->>'subject',
      p_outbox->>'body',
      p_outbox->>'idempotency_key',
      0,
      now() + interval '2 minutes'
    );

    return 'saved';
  exception
    when unique_violation then
      -- The inquiry insert and the budget increment both roll back.
      -- A previous save already stored the inquiry; recreate the office row if it is missing.
      insert into public.inquiry_email_outbox (
        client_submission_id,
        role,
        status,
        to_email,
        reply_to,
        subject,
        body,
        idempotency_key,
        attempts,
        next_attempt_at
      )
      values (
        v_submission,
        'internal',
        'pending',
        p_outbox->>'to_email',
        nullif(p_outbox->>'reply_to', ''),
        p_outbox->>'subject',
        p_outbox->>'body',
        p_outbox->>'idempotency_key',
        0,
        now()
      )
      on conflict (idempotency_key) do nothing;
      return 'duplicate';
  end;
end;
$$;

revoke all on table public.inquiry_email_budget from public;
revoke all on table public.inquiry_email_outbox from public;
revoke all on function public.reserve_inquiry_email_budgets(text, text, text, integer, integer, integer, integer) from public;
revoke all on function public.save_inquiry_with_office_mail(jsonb, jsonb, text, text, text, integer, integer, integer, integer) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table public.inquiry_email_budget from anon;
    revoke all on table public.inquiry_email_outbox from anon;
    revoke all on function public.reserve_inquiry_email_budgets(text, text, text, integer, integer, integer, integer) from anon;
    revoke all on function public.save_inquiry_with_office_mail(jsonb, jsonb, text, text, text, integer, integer, integer, integer) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table public.inquiry_email_budget from authenticated;
    revoke all on table public.inquiry_email_outbox from authenticated;
    revoke all on function public.reserve_inquiry_email_budgets(text, text, text, integer, integer, integer, integer) from authenticated;
    revoke all on function public.save_inquiry_with_office_mail(jsonb, jsonb, text, text, text, integer, integer, integer, integer) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on table public.inquiry_email_budget to service_role;
    grant select, insert, update, delete on table public.inquiry_email_outbox to service_role;
    grant execute on function public.reserve_inquiry_email_budgets(text, text, text, integer, integer, integer, integer) to service_role;
    grant execute on function public.save_inquiry_with_office_mail(jsonb, jsonb, text, text, text, integer, integer, integer, integer) to service_role;
  end if;
end $$;
