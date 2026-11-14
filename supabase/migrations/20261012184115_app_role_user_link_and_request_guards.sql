create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  matched_landlord bigint;
  matched_tenant bigint;
  matched_staff bigint;
  matches integer;
begin
  select id into matched_landlord
  from public."Landlords"
  where lower(email) = lower(new.email);

  select id into matched_tenant
  from public."Tenants"
  where lower(email) = lower(new.email);

  select id into matched_staff
  from public."Staff"
  where lower(email) = lower(new.email);

  matches := (matched_landlord is not null)::integer
    + (matched_tenant is not null)::integer
    + (matched_staff is not null)::integer;

  if matches = 1 then
    if matched_landlord is not null then
      insert into public.user_roles (user_id, role, landlord_id)
      values (new.id, 'landlord', matched_landlord);
    elsif matched_tenant is not null then
      insert into public.user_roles (user_id, role, tenant_id)
      values (new.id, 'tenant', matched_tenant);
    else
      insert into public.user_roles (user_id, role, staff_id)
      values (new.id, 'maintenance', matched_staff);
    end if;
  end if;

  return new;
exception
  when unique_violation then
    return new;
end;
$$;

revoke all on function private.handle_new_user() from public, anon, authenticated;
grant execute on function private.handle_new_user() to postgres, supabase_auth_admin;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function private.handle_new_user();

create or replace function private.assign_admin(admin_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target uuid;
begin
  select id into target
  from auth.users
  where lower(email) = lower(admin_email);

  if target is null then
    raise exception 'No Auth user with that email';
  end if;

  insert into public.user_roles (user_id, role)
  values (target, 'admin')
  on conflict (user_id) do update
    set role = 'admin',
        landlord_id = null,
        tenant_id = null,
        staff_id = null;
end;
$$;

revoke all on function private.assign_admin(text) from public, anon, authenticated;
grant execute on function private.assign_admin(text) to postgres;

create sequence public.maintenance_request_number_seq start 1000;

create or replace function private.assign_request_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.request_number is null or btrim(new.request_number) = '' then
    new.request_number := 'MR-' || lpad(nextval('public.maintenance_request_number_seq')::text, 6, '0');
  end if;
  return new;
end;
$$;

revoke all on function private.assign_request_number() from public, anon, authenticated;
grant execute on function private.assign_request_number() to postgres, authenticated, service_role;

drop trigger if exists maintenance_requests_assign_number on public."MaintenanceRequests";
create trigger maintenance_requests_assign_number
  before insert on public."MaintenanceRequests"
  for each row
  execute function private.assign_request_number();

create or replace function private.protect_maintenance_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or (select private.current_role()) = 'admin' then
    return new;
  end if;

  if new.id is distinct from old.id
    or new.request_number is distinct from old.request_number
    or new.unit_id is distinct from old.unit_id
    or new.submitted_by_tenant_id is distinct from old.submitted_by_tenant_id
    or new.title is distinct from old.title
    or new.description is distinct from old.description
    or new.category is distinct from old.category
    or new.created_at is distinct from old.created_at
    or new.is_test_data is distinct from old.is_test_data
  then
    raise exception 'These request fields cannot be changed from this account';
  end if;

  if (select private.current_role()) = 'maintenance'
    and new.assigned_staff_id is distinct from old.assigned_staff_id
  then
    raise exception 'Assigned staff cannot be changed from this account';
  end if;

  return new;
end;
$$;

revoke all on function private.protect_maintenance_request() from public, anon, authenticated;
grant execute on function private.protect_maintenance_request() to postgres, authenticated, service_role;

drop trigger if exists maintenance_requests_protect_fields on public."MaintenanceRequests";
create trigger maintenance_requests_protect_fields
  before update on public."MaintenanceRequests"
  for each row
  execute function private.protect_maintenance_request();
