drop policy maintenance_requests_update_admin on public."MaintenanceRequests";
drop policy maintenance_requests_update_landlord on public."MaintenanceRequests";
drop policy maintenance_requests_update_staff on public."MaintenanceRequests";

create policy maintenance_requests_update
  on public."MaintenanceRequests"
  for update
  to authenticated
  using (
    (select private.current_role()) = 'admin'
    or (
      (select private.current_role()) = 'landlord'
      and (select private.landlord_owns_unit(unit_id))
    )
    or (
      (select private.current_role()) = 'maintenance'
      and assigned_staff_id = (select private.current_staff_id())
    )
  )
  with check (
    (select private.current_role()) = 'admin'
    or (
      (select private.current_role()) = 'landlord'
      and (select private.landlord_owns_unit(unit_id))
    )
    or (
      (select private.current_role()) = 'maintenance'
      and assigned_staff_id = (select private.current_staff_id())
    )
  );
