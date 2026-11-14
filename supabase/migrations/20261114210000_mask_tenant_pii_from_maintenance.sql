-- Approved access rule: maintenance may read tenant contact fields for assigned
-- units, but must not receive monthly_income, date_of_birth, employer, or private notes.
-- RLS is row-level only; public."Tenants" is a security_invoker view that allowlists
-- who may see those columns (admin / landlord / tenant / service_role / DB owner).
--
-- Physical rows live in private.tenants (out of PostgREST db-schemas). Authenticated
-- gets SELECT on the base table only so the invoker view can read through RLS; writes
-- go through INSTEAD OF triggers that require private.is_admin() (SECURITY DEFINER
-- would otherwise bypass tenants_admin_* policies). RETURNING values are re-masked.

alter table public."Tenants" set schema private;
alter table private."Tenants" rename to tenants;

create or replace function private.can_read_tenant_pii()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- Do not use current_user here: SECURITY DEFINER makes it the owner and
  -- would fail-open for every caller.
  select
    coalesce(auth.jwt() ->> 'role', '') = 'service_role'
    or private.current_role() in (
      'admin'::public.app_role,
      'landlord'::public.app_role,
      'tenant'::public.app_role
    )
    -- DB/SQL-editor sessions (no JWT subject): allow full row for ops.
    or (
      (select auth.uid()) is null
      and coalesce(auth.jwt() ->> 'role', '') = ''
    );
$$;

revoke all on function private.can_read_tenant_pii() from public, anon;
grant execute on function private.can_read_tenant_pii() to authenticated, service_role;

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
  case when private.can_read_tenant_pii() then t.notes else null end as notes,
  t.is_test_data,
  case when private.can_read_tenant_pii() then t.date_of_birth else null end as date_of_birth,
  t.emergency_contact,
  case when private.can_read_tenant_pii() then t.employer else null end as employer,
  case when private.can_read_tenant_pii() then t.monthly_income else null end as monthly_income
from private.tenants t;

comment on view public."Tenants" is
  'Tenant rows; income/DOB/employer/notes only for admin/landlord/tenant/service_role.';

-- Invoker view needs SELECT on the base relation. Keep private out of PostgREST
-- exposed schemas so JWT clients address public."Tenants" only. No base-table
-- INSERT/UPDATE/DELETE for authenticated — writes use admin-gated triggers.
grant usage on schema private to authenticated, service_role;
revoke all on table private.tenants from anon, authenticated;
grant select on table private.tenants to authenticated;
grant select, insert, update, delete on table private.tenants to service_role;
grant select, insert, update, delete on table private.tenants to postgres;

grant select, insert, update, delete on public."Tenants" to authenticated, service_role;

create or replace function private.tenants_view_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Allow admin JWTs, service_role, and SQL-editor/emulator (no JWT) seeds.
  -- Reject every other authenticated persona (maintenance, landlord, tenant, pending).
  if not (
    private.is_admin()
    or coalesce(auth.jwt() ->> 'role', '') = 'service_role'
    or ((select auth.uid()) is null and coalesce(auth.jwt() ->> 'role', '') = '')
  ) then
    raise exception 'forbidden: only admin may insert tenants';
  end if;

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

  -- Prefer: return=representation must not leak unmasked PII to non-allowlisted roles.
  if not private.can_read_tenant_pii() then
    new.notes := null;
    new.date_of_birth := null;
    new.employer := null;
    new.monthly_income := null;
  end if;
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
  if not (
    private.is_admin()
    or coalesce(auth.jwt() ->> 'role', '') = 'service_role'
    or ((select auth.uid()) is null and coalesce(auth.jwt() ->> 'role', '') = '')
  ) then
    raise exception 'forbidden: only admin may update tenants';
  end if;

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

  if not private.can_read_tenant_pii() then
    new.notes := null;
    new.date_of_birth := null;
    new.employer := null;
    new.monthly_income := null;
  end if;
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
  if not (
    private.is_admin()
    or coalesce(auth.jwt() ->> 'role', '') = 'service_role'
    or ((select auth.uid()) is null and coalesce(auth.jwt() ->> 'role', '') = '')
  ) then
    raise exception 'forbidden: only admin may delete tenants';
  end if;
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

alter table private.tenants force row level security;

notify pgrst, 'reload schema';
