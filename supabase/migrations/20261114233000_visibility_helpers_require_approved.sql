-- PR #53 review follow-up: staff_* and tenant_* visibility helpers still resolved
-- link ids with a raw user_roles lookup that ignored account_status. Suspended/
-- rejected users with a leftover staff_id (or tenant link) could still pass
-- staff_can_see_tenant / staff_assigned_to_* / tenant_can_see_*.
-- Landlord helpers were already routed through current_landlord_id() in
-- 20261114030000; rewrite them here for the same pattern.
--
-- Route every helper through private.current_*_id(), which require
-- account_status = 'approved' (20261113180000).

create or replace function private.landlord_owns_unit(target_unit bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public."Units" as unit
    join public."Properties" as property on property.id = unit.property_id
    where unit.id = target_unit
      and property.landlord_id = (select private.current_landlord_id())
  )
$$;

create or replace function private.staff_assigned_to_unit(target_unit bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public."MaintenanceRequests" as request
    where request.unit_id = target_unit
      and request.assigned_staff_id = (select private.current_staff_id())
  )
$$;

create or replace function private.staff_assigned_to_property(target_property bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public."MaintenanceRequests" as request
    join public."Units" as unit on unit.id = request.unit_id
    where unit.property_id = target_property
      and request.assigned_staff_id = (select private.current_staff_id())
  )
$$;

create or replace function private.landlord_can_see_tenant(target_tenant bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public."Tenants" as tenant
    join public."Units" as unit on unit.id = tenant.unit_id
    join public."Properties" as property on property.id = unit.property_id
    where tenant.id = target_tenant
      and property.landlord_id = (select private.current_landlord_id())
  )
$$;

create or replace function private.staff_can_see_tenant(target_tenant bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public."Tenants" as tenant
    join public."MaintenanceRequests" as request on request.unit_id = tenant.unit_id
    where tenant.id = target_tenant
      and request.assigned_staff_id = (select private.current_staff_id())
  )
$$;

create or replace function private.landlord_can_see_staff(target_staff bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public."MaintenanceRequests" as request
    join public."Units" as unit on unit.id = request.unit_id
    join public."Properties" as property on property.id = unit.property_id
    where request.assigned_staff_id = target_staff
      and property.landlord_id = (select private.current_landlord_id())
  )
$$;

create or replace function private.tenant_can_see_staff(target_staff bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public."MaintenanceRequests" as request
    where request.assigned_staff_id = target_staff
      and request.submitted_by_tenant_id = (select private.current_tenant_id())
  )
$$;

create or replace function private.tenant_can_see_landlord(target_landlord bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public."Tenants" as tenant
    join public."Units" as unit on unit.id = tenant.unit_id
    join public."Properties" as property on property.id = unit.property_id
    where tenant.id = (select private.current_tenant_id())
      and property.landlord_id = target_landlord
  )
$$;

create or replace function private.staff_can_see_landlord(target_landlord bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public."MaintenanceRequests" as request
    join public."Units" as unit on unit.id = request.unit_id
    join public."Properties" as property on property.id = unit.property_id
    where request.assigned_staff_id = (select private.current_staff_id())
      and property.landlord_id = target_landlord
  )
$$;

comment on function private.staff_can_see_tenant(bigint) is
  'True when an approved maintenance user is assigned to a work order on the tenant unit (via current_staff_id()).';

comment on function private.staff_assigned_to_unit(bigint) is
  'True when an approved maintenance user is assigned to a work order on the unit (via current_staff_id()).';

comment on function private.staff_assigned_to_property(bigint) is
  'True when an approved maintenance user is assigned to a work order on the property (via current_staff_id()).';

comment on function private.staff_can_see_landlord(bigint) is
  'True when an approved maintenance user is assigned to a work order on a unit owned by the landlord (via current_staff_id()).';

comment on function private.tenant_can_see_staff(bigint) is
  'True when an approved tenant submitted a work order assigned to that staff (via current_tenant_id()).';

comment on function private.tenant_can_see_landlord(bigint) is
  'True when an approved tenant lives in a unit owned by that landlord (via current_tenant_id()).';

comment on function private.landlord_owns_unit(bigint) is
  'True when an approved landlord owns the property for the unit (via current_landlord_id()).';
