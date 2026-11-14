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

-- 4) Recompute private.tenants.unit_id from remaining active lease membership.
--    p_exclude_lease_id: ignore a lease that is ending/deleting (still visible to the
--    statement). p_left_lease_unit_id: only clear when unit_id still matches that unit
--    (same conditional clear as app Gap R3). Prefer another active lease when present.
create or replace function private.recompute_tenant_unit_from_leases(
  p_tenant_id bigint,
  p_left_lease_unit_id bigint default null,
  p_exclude_lease_id bigint default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  active_unit bigint;
  is_primary boolean;
begin
  select
    l.unit_id,
    (l.primary_tenant_id is not distinct from p_tenant_id)
  into active_unit, is_primary
  from public."LeaseTenants" lt
  join public."Leases" l on l.id = lt.lease_id
  where lt.tenant_id = p_tenant_id
    and l.status = 'active'
    and (p_exclude_lease_id is null or l.id is distinct from p_exclude_lease_id)
  order by l.start_date desc nulls last, l.id desc
  limit 1;

  if active_unit is not null then
    -- Keep primary_on_lease aligned with the remaining active lease so we do
    -- not violate tenants_one_primary_per_unit_idx after a cross-unit reassign.
    update private.tenants t
       set unit_id = active_unit,
           primary_on_lease = coalesce(is_primary, false)
     where t.id = p_tenant_id
       and (
         t.unit_id is distinct from active_unit
         or t.primary_on_lease is distinct from coalesce(is_primary, false)
       );
    return;
  end if;

  if p_left_lease_unit_id is null then
    return;
  end if;

  update private.tenants t
     set unit_id = null,
         primary_on_lease = false
   where t.id = p_tenant_id
     and t.unit_id = p_left_lease_unit_id;
end;
$$;

-- 5) LeaseTenants insert/update pushes active unit; delete/reassign recomputes
create or replace function private.sync_tenant_unit_from_lease_tenants()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  lease_unit bigint;
  is_primary boolean;
begin
  if tg_op = 'DELETE' then
    select l.unit_id into lease_unit
    from public."Leases" l
    where l.id = old.lease_id;

    -- Parent already gone (ON DELETE CASCADE from Leases): lease-level trigger handled it.
    if not found then
      return old;
    end if;

    perform private.recompute_tenant_unit_from_leases(old.tenant_id, lease_unit, old.lease_id);
    return old;
  end if;

  if tg_op = 'UPDATE'
     and (
       old.tenant_id is distinct from new.tenant_id
       or old.lease_id is distinct from new.lease_id
     )
  then
    select l.unit_id into lease_unit
    from public."Leases" l
    where l.id = old.lease_id;
    perform private.recompute_tenant_unit_from_leases(old.tenant_id, lease_unit, old.lease_id);
  end if;

  select
    l.unit_id,
    (l.primary_tenant_id is not distinct from new.tenant_id)
  into lease_unit, is_primary
  from public."Leases" l
  where l.id = new.lease_id
    and l.status = 'active';

  if lease_unit is not null then
    update private.tenants t
       set unit_id = lease_unit,
           primary_on_lease = coalesce(is_primary, false)
     where t.id = new.tenant_id
       and (
         t.unit_id is distinct from lease_unit
         or t.primary_on_lease is distinct from coalesce(is_primary, false)
       );
  end if;

  return new;
end;
$$;

drop trigger if exists lease_tenants_sync_tenant_unit on public."LeaseTenants";
create trigger lease_tenants_sync_tenant_unit
  after insert or update of lease_id, tenant_id or delete
  on public."LeaseTenants"
  for each row
  execute function private.sync_tenant_unit_from_lease_tenants();

-- 6) Lease become-active / unit change pushes; leave-active and delete clear orphans
create or replace function private.sync_tenants_on_lease_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  member record;
  left_unit bigint;
begin
  if tg_op = 'DELETE' then
    left_unit := old.unit_id;
    for member in
      select lt.tenant_id
      from public."LeaseTenants" lt
      where lt.lease_id = old.id
    loop
      perform private.recompute_tenant_unit_from_leases(
        member.tenant_id,
        left_unit,
        old.id
      );
    end loop;
    return old;
  end if;

  if new.status = 'active'
     and (
       tg_op = 'INSERT'
       or old.status is distinct from 'active'
       or old.unit_id is distinct from new.unit_id
     )
  then
    update private.tenants t
       set unit_id = new.unit_id,
           primary_on_lease = (t.id is not distinct from new.primary_tenant_id)
      from public."LeaseTenants" lt
     where lt.lease_id = new.id
       and lt.tenant_id = t.id
       and (
         t.unit_id is distinct from new.unit_id
         or t.primary_on_lease is distinct from (t.id is not distinct from new.primary_tenant_id)
       );
    return new;
  end if;

  if tg_op = 'UPDATE'
     and old.status = 'active'
     and new.status is distinct from 'active'
  then
    left_unit := coalesce(old.unit_id, new.unit_id);
    for member in
      select lt.tenant_id
      from public."LeaseTenants" lt
      where lt.lease_id = new.id
    loop
      perform private.recompute_tenant_unit_from_leases(
        member.tenant_id,
        left_unit,
        new.id
      );
    end loop;
  end if;

  return new;
end;
$$;

drop trigger if exists leases_sync_tenant_units on public."Leases";
drop trigger if exists leases_sync_tenant_units_before_delete on public."Leases";
-- Prior draft names from earlier commits of this migration (idempotent).
drop function if exists private.sync_tenants_on_lease_activation();
drop function if exists private.sync_tenant_unit_from_active_lease();

create trigger leases_sync_tenant_units
  after insert or update of status, unit_id
  on public."Leases"
  for each row
  execute function private.sync_tenants_on_lease_status();

-- BEFORE DELETE so memberships still exist and we can exclude this lease id.
create trigger leases_sync_tenant_units_before_delete
  before delete
  on public."Leases"
  for each row
  execute function private.sync_tenants_on_lease_status();
