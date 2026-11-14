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
      and property.landlord_id = (
        select landlord_id
        from public.user_roles
        where user_id = (select auth.uid())
      )
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
      and request.assigned_staff_id = (
        select staff_id
        from public.user_roles
        where user_id = (select auth.uid())
      )
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
      and request.assigned_staff_id = (
        select staff_id
        from public.user_roles
        where user_id = (select auth.uid())
      )
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
      and property.landlord_id = (
        select landlord_id
        from public.user_roles
        where user_id = (select auth.uid())
      )
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
      and request.assigned_staff_id = (
        select staff_id
        from public.user_roles
        where user_id = (select auth.uid())
      )
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
      and property.landlord_id = (
        select landlord_id
        from public.user_roles
        where user_id = (select auth.uid())
      )
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
      and request.submitted_by_tenant_id = (
        select tenant_id
        from public.user_roles
        where user_id = (select auth.uid())
      )
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
    from public.user_roles as membership
    join public."Tenants" as tenant on tenant.id = membership.tenant_id
    join public."Units" as unit on unit.id = tenant.unit_id
    join public."Properties" as property on property.id = unit.property_id
    where membership.user_id = (select auth.uid())
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
    where request.assigned_staff_id = (
      select staff_id
      from public.user_roles
      where user_id = (select auth.uid())
    )
      and property.landlord_id = target_landlord
  )
$$;

revoke all on function
  private.current_role(),
  private.current_landlord_id(),
  private.current_tenant_id(),
  private.current_staff_id(),
  private.current_tenant_unit_id(),
  private.current_tenant_property_id(),
  private.landlord_owns_unit(bigint),
  private.staff_assigned_to_unit(bigint),
  private.staff_assigned_to_property(bigint),
  private.landlord_can_see_tenant(bigint),
  private.staff_can_see_tenant(bigint),
  private.landlord_can_see_staff(bigint),
  private.tenant_can_see_staff(bigint),
  private.tenant_can_see_landlord(bigint),
  private.staff_can_see_landlord(bigint)
from public, anon;

grant execute on function
  private.current_role(),
  private.current_landlord_id(),
  private.current_tenant_id(),
  private.current_staff_id(),
  private.current_tenant_unit_id(),
  private.current_tenant_property_id(),
  private.landlord_owns_unit(bigint),
  private.staff_assigned_to_unit(bigint),
  private.staff_assigned_to_property(bigint),
  private.landlord_can_see_tenant(bigint),
  private.staff_can_see_tenant(bigint),
  private.landlord_can_see_staff(bigint),
  private.tenant_can_see_staff(bigint),
  private.tenant_can_see_landlord(bigint),
  private.staff_can_see_landlord(bigint)
to authenticated;
