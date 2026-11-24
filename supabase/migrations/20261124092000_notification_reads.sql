-- Bell read state (UX-08 follow-up): what each user has read in the
-- notifications panel, so reads survive a reload and "Mark all read" sticks.
--
-- Message notifications (request comments, office messages) do NOT use this
-- table: they share the inbox's read state (MaintenanceThreadReads /
-- OfficeThreadReads), so the bell and the Messages inbox always agree. This
-- table covers the other events — status changes and urgent requests.
--
-- item_key is the notification's stable id, e.g. 'status:812' or 'urgent:31'.
-- The reserved key '*' is the user's "Mark all read" point: every event at or
-- before its read_at counts as read.
--
-- Additive. Own rows only, for every role.

CREATE TABLE IF NOT EXISTS public."NotificationReads" (
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  item_key text NOT NULL CHECK (char_length(item_key) BETWEEN 1 AND 120),
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, item_key)
);

COMMENT ON TABLE public."NotificationReads" IS
  'Per-user read marks for bell notifications (status changes, urgent requests). item_key ''*'' = mark-all-read point.';

ALTER TABLE public."NotificationReads" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."NotificationReads" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notification_reads_select ON public."NotificationReads";
CREATE POLICY notification_reads_select ON public."NotificationReads"
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS notification_reads_insert ON public."NotificationReads";
CREATE POLICY notification_reads_insert ON public."NotificationReads"
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND (SELECT private.current_role()) IS NOT NULL
  );

DROP POLICY IF EXISTS notification_reads_update ON public."NotificationReads";
CREATE POLICY notification_reads_update ON public."NotificationReads"
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS notification_reads_delete ON public."NotificationReads";
CREATE POLICY notification_reads_delete ON public."NotificationReads"
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

REVOKE ALL ON public."NotificationReads" FROM anon;
REVOKE ALL ON public."NotificationReads" FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."NotificationReads" TO authenticated;
GRANT ALL ON public."NotificationReads" TO service_role;

NOTIFY pgrst, 'reload schema';
