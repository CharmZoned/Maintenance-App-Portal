-- LD-30 (partial): Realtime for maintenance request + comment lists.
-- Does NOT publish messages/notifications tables (out of scope / absent).
-- RLS still applies to Realtime payloads.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication
    WHERE pubname = 'supabase_realtime'
  ) THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'MaintenanceRequests'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public."MaintenanceRequests";
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'MaintenanceRequestComments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public."MaintenanceRequestComments";
  END IF;
END
$$;

-- Replica identity full helps Realtime filter UPDATE/DELETE under RLS.
ALTER TABLE public."MaintenanceRequests" REPLICA IDENTITY FULL;
ALTER TABLE public."MaintenanceRequestComments" REPLICA IDENTITY FULL;
