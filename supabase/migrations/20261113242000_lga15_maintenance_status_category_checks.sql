-- LGA-15: Codify live MaintenanceRequests status / category / priority CHECKs
-- (and companion status-field CHECKs) into the repo for secondary envs.
-- DROP + ADD so a same-named but wrong CHECK cannot linger (name ≠ definition).
-- Live Landlord Gopher already matches these definitions.

-- ── Status / category / priority enums ────────────────────────────

ALTER TABLE public."MaintenanceRequests"
  DROP CONSTRAINT IF EXISTS "MaintenanceRequests_status_check";
ALTER TABLE public."MaintenanceRequests"
  ADD CONSTRAINT "MaintenanceRequests_status_check"
  CHECK (status = ANY (ARRAY[
    'Open'::text,
    'Scheduled'::text,
    'In Progress'::text,
    'On Hold'::text,
    'Closed'::text
  ]));

ALTER TABLE public."MaintenanceRequests"
  DROP CONSTRAINT IF EXISTS "MaintenanceRequests_category_check";
ALTER TABLE public."MaintenanceRequests"
  ADD CONSTRAINT "MaintenanceRequests_category_check"
  CHECK (category = ANY (ARRAY[
    'Plumbing'::text,
    'Electrical'::text,
    'Heating / AC'::text,
    'Appliance'::text,
    'Pest control'::text,
    'Locks / keys / doors'::text,
    'Windows'::text,
    'Roof / leaks'::text,
    'Mold / water damage'::text,
    'Exterior / yard'::text,
    'General repair'::text,
    'Other'::text
  ]));

ALTER TABLE public."MaintenanceRequests"
  DROP CONSTRAINT IF EXISTS "MaintenanceRequests_priority_check";
ALTER TABLE public."MaintenanceRequests"
  ADD CONSTRAINT "MaintenanceRequests_priority_check"
  CHECK (priority = ANY (ARRAY[
    'Low'::text,
    'Normal'::text,
    'High'::text,
    'Urgent'::text
  ]));

-- ── Companion CHECKs tied to status transitions ───────────────────

ALTER TABLE public."MaintenanceRequests"
  DROP CONSTRAINT IF EXISTS requests_closed_details;
ALTER TABLE public."MaintenanceRequests"
  ADD CONSTRAINT requests_closed_details
  CHECK (
    (
      status = 'Closed'::text
      AND closed_at IS NOT NULL
      AND resolution_notes IS NOT NULL
      AND length(TRIM(BOTH FROM resolution_notes)) > 0
    )
    OR (
      status <> 'Closed'::text
      AND closed_at IS NULL
    )
  );

ALTER TABLE public."MaintenanceRequests"
  DROP CONSTRAINT IF EXISTS requests_hold_details;
ALTER TABLE public."MaintenanceRequests"
  ADD CONSTRAINT requests_hold_details
  CHECK (
    status <> 'On Hold'::text
    OR (
      hold_reason IS NOT NULL
      AND length(TRIM(BOTH FROM hold_reason)) > 0
      AND next_follow_up_date IS NOT NULL
    )
  );

ALTER TABLE public."MaintenanceRequests"
  DROP CONSTRAINT IF EXISTS requests_in_progress_details;
ALTER TABLE public."MaintenanceRequests"
  ADD CONSTRAINT requests_in_progress_details
  CHECK (
    status <> 'In Progress'::text
    OR (
      assigned_staff_id IS NOT NULL
      AND started_at IS NOT NULL
    )
  );

ALTER TABLE public."MaintenanceRequests"
  DROP CONSTRAINT IF EXISTS requests_scheduled_details;
ALTER TABLE public."MaintenanceRequests"
  ADD CONSTRAINT requests_scheduled_details
  CHECK (
    status <> 'Scheduled'::text
    OR (
      assigned_staff_id IS NOT NULL
      AND scheduled_for IS NOT NULL
    )
  );

COMMENT ON CONSTRAINT "MaintenanceRequests_status_check" ON public."MaintenanceRequests" IS
  'LGA-15: Open | Scheduled | In Progress | On Hold | Closed (portal maps snake_case ↔ Title Case).';

COMMENT ON CONSTRAINT "MaintenanceRequests_category_check" ON public."MaintenanceRequests" IS
  'LGA-15: Title Case maintenance categories used by tenant submit + staff WO UI.';
