-- LD-9: database integrity for leases / tenant assignment / WO property consistency.
-- Additive constraints + triggers. Safe on empty or clean data; validate before prod.

-- 1) Lease date ordering
alter table public."Leases"
  drop constraint if exists leases_end_on_or_after_start;
alter table public."Leases"
  add constraint leases_end_on_or_after_start
  check (end_date >= start_date);

-- 2) At most one active lease per unit
create unique index if not exists leases_one_active_per_unit
  on public."Leases" (unit_id)
  where status = 'active';

-- 3) Work-order property_id must match the unit's property when unit_id is set
create or replace function private.maintenance_request_property_matches_unit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  unit_property bigint;
begin
  if new.unit_id is null then
    return new;
  end if;

  select u.property_id into unit_property
  from public."Units" u
  where u.id = new.unit_id;

  if unit_property is null then
    raise exception 'maintenance request unit_id % not found', new.unit_id;
  end if;

  if new.property_id is null then
    new.property_id := unit_property;
  elsif new.property_id is distinct from unit_property then
    raise exception
      'maintenance request property_id % does not match unit % property %',
      new.property_id, new.unit_id, unit_property;
  end if;

  return new;
end;
$$;

drop trigger if exists maintenance_request_property_matches_unit
  on public."MaintenanceRequests";
create trigger maintenance_request_property_matches_unit
  before insert or update of unit_id, property_id
  on public."MaintenanceRequests"
  for each row
  execute function private.maintenance_request_property_matches_unit();

-- 4) Keep private.tenants.unit_id aligned with the tenant's active lease unit
create or replace function private.sync_tenant_unit_from_active_lease()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  lease_unit bigint;
begin
  select l.unit_id into lease_unit
  from public."Leases" l
  where l.id = new.lease_id
    and l.status = 'active';

  if lease_unit is not null then
    update private.tenants t
       set unit_id = lease_unit
     where t.id = new.tenant_id
       and t.unit_id is distinct from lease_unit;
  end if;

  return new;
end;
$$;

drop trigger if exists lease_tenants_sync_tenant_unit on public."LeaseTenants";
create trigger lease_tenants_sync_tenant_unit
  after insert or update of lease_id, tenant_id
  on public."LeaseTenants"
  for each row
  execute function private.sync_tenant_unit_from_active_lease();

-- 5) When a lease becomes active (or its unit changes while active), sync members
create or replace function private.sync_tenants_on_lease_activation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'active'
     and (tg_op = 'INSERT' or old.status is distinct from 'active' or old.unit_id is distinct from new.unit_id)
  then
    update private.tenants t
       set unit_id = new.unit_id
      from public."LeaseTenants" lt
     where lt.lease_id = new.id
       and lt.tenant_id = t.id
       and t.unit_id is distinct from new.unit_id;
  end if;
  return new;
end;
$$;

drop trigger if exists leases_sync_tenant_units on public."Leases";
create trigger leases_sync_tenant_units
  after insert or update of status, unit_id
  on public."Leases"
  for each row
  execute function private.sync_tenants_on_lease_activation();
