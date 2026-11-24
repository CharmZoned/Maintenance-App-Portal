-- Landlord wave A2: "Regarding request #MR-…" on office chat (owner decision D6:
-- a real link stored on the message, docs/landlord-wave-plan.md §2).
--
-- OfficeMessages.request_id points at the maintenance request a message is
-- about. It is optional, and is cleared (not cascaded) if the request is
-- deleted, so the conversation stays intact.
--
-- The INSERT rule from 20261118190000 is restated with one extra condition:
-- when request_id is set, the author must be an admin or able to see that
-- request (private.can_select_maintenance_request: the submitting tenant, the
-- assigned worker, or the owning landlord, including common-area requests per
-- 20261124100000). A landlord therefore cannot attach another landlord's
-- request to their thread, even by id. There is no UPDATE grant on the table,
-- so the link cannot be changed after sending.

ALTER TABLE public."OfficeMessages"
  ADD COLUMN IF NOT EXISTS request_id bigint
    REFERENCES public."MaintenanceRequests"(id) ON DELETE SET NULL;

COMMENT ON COLUMN public."OfficeMessages".request_id IS
  'Optional: the maintenance request this message is about ("Regarding #MR-…"). The author must be an admin or able to see the request. Set to NULL if the request is deleted.';

CREATE INDEX IF NOT EXISTS office_messages_request_idx
  ON public."OfficeMessages" (request_id)
  WHERE request_id IS NOT NULL;

DROP POLICY IF EXISTS office_messages_insert ON public."OfficeMessages";
CREATE POLICY office_messages_insert ON public."OfficeMessages"
  FOR INSERT TO authenticated
  WITH CHECK (
    author_user_id = (SELECT auth.uid())
    AND NOT (author_role IS DISTINCT FROM (SELECT private.current_role()))
    AND (
      (
        (SELECT private.is_admin())
        AND (SELECT private.is_office_thread_user(thread_user_id))
      )
      OR (
        (SELECT private.current_role()) <> 'admin'::public.app_role
        AND thread_user_id = (SELECT auth.uid())
      )
    )
    AND (
      request_id IS NULL
      OR (SELECT private.is_admin())
      OR (SELECT private.can_select_maintenance_request(request_id))
    )
  );
