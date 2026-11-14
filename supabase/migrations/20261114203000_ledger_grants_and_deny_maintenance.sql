-- Staging rebuild gap + approved access rule:
-- 1) Authenticated lacked table GRANTs on ledger/applications after a clean pack
--    apply (production already had them). Align privileges with live.
-- 2) Maintenance must not read leases, lease membership, rent charges, or payments.
--    Remove private.staff_assigned_to_unit from ledger SELECT policies.

grant select, insert, update, delete on table
  public."Leases",
  public."LeaseTenants",
  public."RentCharges",
  public."Payments",
  public."Applications"
  to authenticated;

grant select, insert, update, delete on table
  public."Leases",
  public."LeaseTenants",
  public."RentCharges",
  public."Payments",
  public."Applications"
  to service_role;

do $$
declare
  identity_sequence regclass;
  qualified_table text;
begin
  -- LeaseTenants has a composite PK (no identity id sequence).
  foreach qualified_table in array array[
    'public."Leases"',
    'public."RentCharges"',
    'public."Payments"',
    'public."Applications"'
  ]
  loop
    select pg_get_serial_sequence(qualified_table, 'id')::regclass
      into identity_sequence;
    if identity_sequence is not null then
      execute format(
        'grant usage, select on sequence %s to authenticated, service_role',
        identity_sequence
      );
    end if;
  end loop;
end $$;

drop policy if exists leases_select on public."Leases";
create policy leases_select on public."Leases"
  for select
  to authenticated
  using (
    private.is_admin()
    or private.landlord_owns_unit(unit_id)
    or unit_id = (select private.current_tenant_unit_id())
  );

drop policy if exists lease_tenants_select on public."LeaseTenants";
create policy lease_tenants_select on public."LeaseTenants"
  for select
  to authenticated
  using (
    exists (
      select 1
      from public."Leases" l
      where l.id = "LeaseTenants".lease_id
        and (
          private.is_admin()
          or private.landlord_owns_unit(l.unit_id)
          or l.unit_id = (select private.current_tenant_unit_id())
        )
    )
  );

drop policy if exists rent_charges_select on public."RentCharges";
create policy rent_charges_select on public."RentCharges"
  for select
  to authenticated
  using (
    exists (
      select 1
      from public."Leases" l
      where l.id = "RentCharges".lease_id
        and (
          private.is_admin()
          or private.landlord_owns_unit(l.unit_id)
          or l.unit_id = (select private.current_tenant_unit_id())
        )
    )
  );

drop policy if exists payments_select on public."Payments";
create policy payments_select on public."Payments"
  for select
  to authenticated
  using (
    exists (
      select 1
      from public."RentCharges" c
      join public."Leases" l on l.id = c.lease_id
      where c.id = "Payments".charge_id
        and (
          private.is_admin()
          or private.landlord_owns_unit(l.unit_id)
          or l.unit_id = (select private.current_tenant_unit_id())
        )
    )
  );
