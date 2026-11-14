-- LD-10: justified FK covering indexes + auth RLS initplan fixes from staging advisors.
-- Does not drop "unused" indexes (staging traffic is too low to trust that signal).

-- ── Unindexed foreign keys (hot-path / cascade-relevant) ───────────
create index if not exists idx_lease_tenants_tenant_id
  on public."LeaseTenants" (tenant_id);

create index if not exists idx_applications_unit_id
  on public."Applications" (unit_id);

create index if not exists idx_maintenance_requests_property_id
  on public."MaintenanceRequests" (property_id);

create index if not exists idx_maintenance_requests_vendor_id
  on public."MaintenanceRequests" (vendor_id);

create index if not exists idx_mr_comments_author_user_id
  on public."MaintenanceRequestComments" (author_user_id);

create index if not exists idx_mr_comments_author_staff_id
  on public."MaintenanceRequestComments" (author_staff_id);

create index if not exists idx_mr_comments_author_tenant_id
  on public."MaintenanceRequestComments" (author_tenant_id);

create index if not exists idx_mr_photos_uploaded_by_user_id
  on public."MaintenanceRequestPhotos" (uploaded_by_user_id);

create index if not exists idx_mr_status_history_changed_by_user_id
  on public."MaintenanceRequestStatusHistory" (changed_by_user_id);

create index if not exists idx_property_documents_uploaded_by_user_id
  on public."PropertyDocuments" (uploaded_by_user_id);

-- ── auth_rls_initplan: wrap auth.uid() in (select …) ───────────────
drop policy if exists maintenance_photos_insert on public."MaintenanceRequestPhotos";
create policy maintenance_photos_insert on public."MaintenanceRequestPhotos"
  for insert
  to authenticated
  with check (
    (select private.can_upload_maintenance_photo("MaintenanceRequestPhotos".maintenance_request_id))
    and uploaded_by_user_id = (select auth.uid())
    and not (uploaded_by_role is distinct from (select private.current_role()))
    and storage_path ~ (('^'::text || (maintenance_request_id)::text) || '/[^/]+$'::text)
  );

drop policy if exists maintenance_photos_delete on public."MaintenanceRequestPhotos";
create policy maintenance_photos_delete on public."MaintenanceRequestPhotos"
  for delete
  to authenticated
  using (
    ((select private.current_role()) = 'admin'::public.app_role)
    or (
      ((select private.current_role()) = 'tenant'::public.app_role)
      and uploaded_by_user_id = (select auth.uid())
      and (select private.can_upload_maintenance_photo("MaintenanceRequestPhotos".maintenance_request_id))
    )
  );

drop policy if exists maintenance_comments_insert on public."MaintenanceRequestComments";
create policy maintenance_comments_insert on public."MaintenanceRequestComments"
  for insert
  to authenticated
  with check (
    (visibility = any (array['tenant_visible'::text, 'internal'::text]))
    and author_user_id = (select auth.uid())
    and not (author_role is distinct from (select private.current_role()))
    and not (author_staff_id is distinct from (select private.current_staff_id()))
    and not (author_tenant_id is distinct from (select private.current_tenant_id()))
    and (
      (select private.can_update_maintenance_request("MaintenanceRequestComments".maintenance_request_id))
      or (
        (select private.current_role()) = 'tenant'::public.app_role
        and visibility = 'tenant_visible'::text
        and (select private.can_select_maintenance_request("MaintenanceRequestComments".maintenance_request_id))
      )
    )
  );

drop policy if exists property_documents_insert on public."PropertyDocuments";
create policy property_documents_insert on public."PropertyDocuments"
  for insert
  to authenticated
  with check (
    (select private.can_manage_property_documents())
    and uploaded_by_user_id = (select auth.uid())
    and not (uploaded_by_role is distinct from (select private.current_role()))
    and storage_path ~ (('^'::text || (property_id)::text) || '/[^/]+$'::text)
    and ((select private.is_admin()) or (visibility = 'staff'::text))
  );

drop policy if exists property_documents_update on public."PropertyDocuments";
create policy property_documents_update on public."PropertyDocuments"
  for update
  to authenticated
  using ((select private.can_manage_property_documents()))
  with check (
    (select private.can_manage_property_documents())
    and (
      (select private.is_admin())
      or visibility = 'staff'::text
    )
  );

drop policy if exists property_documents_delete on public."PropertyDocuments";
create policy property_documents_delete on public."PropertyDocuments"
  for delete
  to authenticated
  using ((select private.can_manage_property_documents()));
