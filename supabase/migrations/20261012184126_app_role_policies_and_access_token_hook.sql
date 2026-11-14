alter table public.user_roles enable row level security;
alter table public.user_roles force row level security;

alter table public."Landlords" enable row level security;
alter table public."Landlords" force row level security;
alter table public."Properties" enable row level security;
alter table public."Properties" force row level security;
alter table public."Units" enable row level security;
alter table public."Units" force row level security;
alter table public."Tenants" enable row level security;
alter table public."Tenants" force row level security;
alter table public."Staff" enable row level security;
alter table public."Staff" force row level security;
alter table public."MaintenanceRequests" enable row level security;
alter table public."MaintenanceRequests" force row level security;

create policy user_roles_select_own
  on public.user_roles
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy user_roles_select_auth_admin
  on public.user_roles
  for select
  to supabase_auth_admin
  using (true);

create policy landlords_select
  on public."Landlords"
  for select
  to authenticated
  using (
    (select private.current_role()) = 'admin'
    or id = (select private.current_landlord_id())
    or (select private.tenant_can_see_landlord(id))
    or (select private.staff_can_see_landlord(id))
  );

create policy properties_select
  on public."Properties"
  for select
  to authenticated
  using (
    (select private.current_role()) = 'admin'
    or landlord_id = (select private.current_landlord_id())
    or id = (select private.current_tenant_property_id())
    or (select private.staff_assigned_to_property(id))
  );

create policy units_select
  on public."Units"
  for select
  to authenticated
  using (
    (select private.current_role()) = 'admin'
    or (select private.landlord_owns_unit(id))
    or id = (select private.current_tenant_unit_id())
    or (select private.staff_assigned_to_unit(id))
  );

create policy tenants_select
  on public."Tenants"
  for select
  to authenticated
  using (
    (select private.current_role()) = 'admin'
    or id = (select private.current_tenant_id())
    or (select private.landlord_can_see_tenant(id))
    or (select private.staff_can_see_tenant(id))
  );

create policy staff_select
  on public."Staff"
  for select
  to authenticated
  using (
    (select private.current_role()) = 'admin'
    or id = (select private.current_staff_id())
    or (select private.landlord_can_see_staff(id))
    or (select private.tenant_can_see_staff(id))
  );

create policy maintenance_requests_select
  on public."MaintenanceRequests"
  for select
  to authenticated
  using (
    (select private.current_role()) = 'admin'
    or submitted_by_tenant_id = (select private.current_tenant_id())
    or assigned_staff_id = (select private.current_staff_id())
    or (select private.landlord_owns_unit(unit_id))
  );

create policy maintenance_requests_insert_tenant
  on public."MaintenanceRequests"
  for insert
  to authenticated
  with check (
    (select private.current_role()) = 'tenant'
    and submitted_by_tenant_id = (select private.current_tenant_id())
    and unit_id = (select private.current_tenant_unit_id())
    and status = 'Open'
    and assigned_staff_id is null
    and started_at is null
    and closed_at is null
    and scheduled_for is null
    and hold_reason is null
    and next_follow_up_date is null
    and resolution_notes is null
    and is_test_data = false
  );

create policy maintenance_requests_update_landlord
  on public."MaintenanceRequests"
  for update
  to authenticated
  using (
    (select private.current_role()) = 'landlord'
    and (select private.landlord_owns_unit(unit_id))
  )
  with check (
    (select private.current_role()) = 'landlord'
    and (select private.landlord_owns_unit(unit_id))
  );

create policy maintenance_requests_update_staff
  on public."MaintenanceRequests"
  for update
  to authenticated
  using (
    (select private.current_role()) = 'maintenance'
    and assigned_staff_id = (select private.current_staff_id())
  )
  with check (
    (select private.current_role()) = 'maintenance'
    and assigned_staff_id = (select private.current_staff_id())
  );

create policy maintenance_requests_update_admin
  on public."MaintenanceRequests"
  for update
  to authenticated
  using ((select private.current_role()) = 'admin')
  with check ((select private.current_role()) = 'admin');

revoke all on table
  public.user_roles,
  public."Landlords",
  public."Properties",
  public."Units",
  public."Tenants",
  public."Staff",
  public."MaintenanceRequests"
from anon, authenticated;

grant select on table
  public.user_roles,
  public."Landlords",
  public."Properties",
  public."Units",
  public."Tenants",
  public."Staff",
  public."MaintenanceRequests"
to authenticated;

grant insert, update on table public."MaintenanceRequests" to authenticated;
grant select on table public.user_roles to supabase_auth_admin;

revoke all on all sequences in schema public from anon, authenticated;

do $$
declare
  identity_sequence regclass;
begin
  select pg_get_serial_sequence('public."MaintenanceRequests"', 'id')::regclass
    into identity_sequence;
  if identity_sequence is not null then
    execute format('grant usage, select on sequence %s to authenticated', identity_sequence);
  end if;
end $$;

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  claims jsonb;
  found_role public.app_role;
  found_landlord bigint;
  found_tenant bigint;
  found_staff bigint;
begin
  select role, landlord_id, tenant_id, staff_id
    into found_role, found_landlord, found_tenant, found_staff
  from public.user_roles
  where user_id = (event->>'user_id')::uuid;

  claims := coalesce(event->'claims', '{}'::jsonb);
  claims := jsonb_set(claims, '{user_role}', coalesce(to_jsonb(found_role), 'null'::jsonb));
  claims := jsonb_set(claims, '{landlord_id}', coalesce(to_jsonb(found_landlord), 'null'::jsonb));
  claims := jsonb_set(claims, '{tenant_id}', coalesce(to_jsonb(found_tenant), 'null'::jsonb));
  claims := jsonb_set(claims, '{staff_id}', coalesce(to_jsonb(found_staff), 'null'::jsonb));

  return jsonb_set(event, '{claims}', claims);
end;
$$;

grant usage on schema public to supabase_auth_admin;

grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;

revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;
