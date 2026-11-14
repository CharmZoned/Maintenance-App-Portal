-- Approved access rule: maintenance may read tenant contact fields for assigned
-- units, but must not receive monthly_income, date_of_birth, employer, or private notes.
-- RLS is row-level only; this view masks those columns when private.current_role()
-- is maintenance. Admin / landlord / tenant / service_role (no app role) keep values.
--
-- Physical rows move to private.tenants; public."Tenants" becomes the masked view so
-- existing PostgREST paths keep working. Direct SELECT on private.tenants is revoked
-- from anon/authenticated.

alter table public."Tenants" set schema private;
alter table private."Tenants" rename to tenants;

create or replace view public."Tenants"
with (security_invoker = true) as
select
  t.id,
  t.created_at,
  t.source_id,
  t.first_name,
  t.last_name,
  t.email,
  t.mobile_phone,
  t.unit_id,
  t.primary_on_lease,
  t.invite_to_app,
  case
    when private.current_role() = 'maintenance'::public.app_role then null
    else t.notes
  end as notes,
  t.is_test_data,
  case
    when private.current_role() = 'maintenance'::public.app_role then null
    else t.date_of_birth
  end as date_of_birth,
  t.emergency_contact,
  case
    when private.current_role() = 'maintenance'::public.app_role then null
    else t.employer
  end as employer,
  case
    when private.current_role() = 'maintenance'::public.app_role then null
    else t.monthly_income
  end as monthly_income
from private.tenants t;

comment on view public."Tenants" is
  'Tenant rows with income/DOB/employer/notes masked for maintenance JWTs.';

-- Invoker-security view requires the caller to have table privilege on the base
-- relation. Keep private.tenants out of the PostgREST public schema so JWT clients
-- cannot address it directly; RLS on private.tenants still filters rows.
grant usage on schema private to authenticated, service_role;
revoke all on table private.tenants from anon;
grant select, insert, update, delete on table private.tenants to authenticated;
grant select, insert, update, delete on table private.tenants to service_role;
grant select, insert, update, delete on table private.tenants to postgres;

grant select, insert, update, delete on public."Tenants" to authenticated, service_role;

-- Auto-updatable views cannot use CASE; provide INSTEAD OF triggers for admin writes.

create or replace function private.tenants_view_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.tenants (
    id, created_at, source_id, first_name, last_name, email, mobile_phone,
    unit_id, primary_on_lease, invite_to_app, notes, is_test_data,
    date_of_birth, emergency_contact, employer, monthly_income
  ) values (
    coalesce(new.id, nextval(pg_get_serial_sequence('private.tenants', 'id'))),
    coalesce(new.created_at, now()),
    coalesce(new.source_id, 'app-' || gen_random_uuid()::text),
    new.first_name,
    new.last_name,
    new.email,
    new.mobile_phone,
    new.unit_id,
    coalesce(new.primary_on_lease, false),
    coalesce(new.invite_to_app, false),
    new.notes,
    coalesce(new.is_test_data, false),
    new.date_of_birth,
    new.emergency_contact,
    new.employer,
    new.monthly_income
  )
  returning
    id, created_at, source_id, first_name, last_name, email, mobile_phone,
    unit_id, primary_on_lease, invite_to_app, notes, is_test_data,
    date_of_birth, emergency_contact, employer, monthly_income
  into
    new.id, new.created_at, new.source_id, new.first_name, new.last_name, new.email, new.mobile_phone,
    new.unit_id, new.primary_on_lease, new.invite_to_app, new.notes, new.is_test_data,
    new.date_of_birth, new.emergency_contact, new.employer, new.monthly_income;
  return new;
end;
$$;

create or replace function private.tenants_view_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update private.tenants t set
    source_id = new.source_id,
    first_name = new.first_name,
    last_name = new.last_name,
    email = new.email,
    mobile_phone = new.mobile_phone,
    unit_id = new.unit_id,
    primary_on_lease = new.primary_on_lease,
    invite_to_app = new.invite_to_app,
    notes = new.notes,
    is_test_data = new.is_test_data,
    date_of_birth = new.date_of_birth,
    emergency_contact = new.emergency_contact,
    employer = new.employer,
    monthly_income = new.monthly_income
  where t.id = old.id
  returning
    t.id, t.created_at, t.source_id, t.first_name, t.last_name, t.email, t.mobile_phone,
    t.unit_id, t.primary_on_lease, t.invite_to_app, t.notes, t.is_test_data,
    t.date_of_birth, t.emergency_contact, t.employer, t.monthly_income
  into
    new.id, new.created_at, new.source_id, new.first_name, new.last_name, new.email, new.mobile_phone,
    new.unit_id, new.primary_on_lease, new.invite_to_app, new.notes, new.is_test_data,
    new.date_of_birth, new.emergency_contact, new.employer, new.monthly_income;
  return new;
end;
$$;

create or replace function private.tenants_view_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from private.tenants where id = old.id;
  return old;
end;
$$;

drop trigger if exists tenants_view_insert on public."Tenants";
create trigger tenants_view_insert
  instead of insert on public."Tenants"
  for each row execute function private.tenants_view_insert();

drop trigger if exists tenants_view_update on public."Tenants";
create trigger tenants_view_update
  instead of update on public."Tenants"
  for each row execute function private.tenants_view_update();

drop trigger if exists tenants_view_delete on public."Tenants";
create trigger tenants_view_delete
  instead of delete on public."Tenants"
  for each row execute function private.tenants_view_delete();

-- RLS remains on private.tenants (moved with the table). Ensure FORCE still holds.
alter table private.tenants force row level security;

notify pgrst, 'reload schema';
