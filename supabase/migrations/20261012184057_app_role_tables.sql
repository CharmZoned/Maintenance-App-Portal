create schema if not exists private;

revoke all on schema private from public, anon;
grant usage on schema private to postgres, authenticated, supabase_auth_admin;

do $$
begin
  if to_regclass('public."Landlords"') is null
    or to_regclass('public."Properties"') is null
    or to_regclass('public."Units"') is null
    or to_regclass('public."Tenants"') is null
    or to_regclass('public."Staff"') is null
    or to_regclass('public."MaintenanceRequests"') is null
  then
    raise exception 'Property tables are missing. Apply the existing schema before roles.';
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'app_role' and typnamespace = 'public'::regnamespace) then
    create type public.app_role as enum ('admin', 'landlord', 'tenant', 'maintenance');
  end if;
end $$;

create table public.user_roles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role public.app_role not null,
  landlord_id bigint references public."Landlords" (id) on delete cascade,
  tenant_id bigint references public."Tenants" (id) on delete cascade,
  staff_id bigint references public."Staff" (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint user_roles_subject_matches_role check (
    (
      role = 'admin'
      and landlord_id is null
      and tenant_id is null
      and staff_id is null
    )
    or (
      role = 'landlord'
      and landlord_id is not null
      and tenant_id is null
      and staff_id is null
    )
    or (
      role = 'tenant'
      and tenant_id is not null
      and landlord_id is null
      and staff_id is null
    )
    or (
      role = 'maintenance'
      and staff_id is not null
      and landlord_id is null
      and tenant_id is null
    )
  )
);

create unique index user_roles_one_landlord
  on public.user_roles (landlord_id)
  where landlord_id is not null;

create unique index user_roles_one_tenant
  on public.user_roles (tenant_id)
  where tenant_id is not null;

create unique index user_roles_one_staff
  on public.user_roles (staff_id)
  where staff_id is not null;

comment on table public.user_roles is
  'Application role for each Auth user. Authorization reads this table, never user_metadata.';

create or replace function private.current_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select role
  from public.user_roles
  where user_id = (select auth.uid())
$$;

create or replace function private.current_landlord_id()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select landlord_id
  from public.user_roles
  where user_id = (select auth.uid())
$$;

create or replace function private.current_tenant_id()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select tenant_id
  from public.user_roles
  where user_id = (select auth.uid())
$$;

create or replace function private.current_staff_id()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select staff_id
  from public.user_roles
  where user_id = (select auth.uid())
$$;

create or replace function private.current_tenant_unit_id()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select tenant.unit_id
  from public.user_roles as membership
  join public."Tenants" as tenant on tenant.id = membership.tenant_id
  where membership.user_id = (select auth.uid())
$$;

create or replace function private.current_tenant_property_id()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select unit.property_id
  from public.user_roles as membership
  join public."Tenants" as tenant on tenant.id = membership.tenant_id
  join public."Units" as unit on unit.id = tenant.unit_id
  where membership.user_id = (select auth.uid())
$$;
