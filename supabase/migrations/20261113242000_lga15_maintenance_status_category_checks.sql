-- LGA-15: Codify live MaintenanceRequests status / category / priority CHECKs
-- (and companion status-field CHECKs) into the repo for secondary envs.
-- Version 20261113242000 avoids collision with LGA-18/19 `20261113240000_*`.
--
-- 1) Remap retired D1 labels so ADD CONSTRAINT does not fail on stale rows
-- 2) DROP + ADD canonical CHECKs (name presence ≠ definition)

-- ── Remap legacy statuses (D1 / pre-CHECK) ────────────────────────
-- Assigned → Scheduled only when companions already satisfy scheduled CHECK.
UPDATE public."MaintenanceRequests"
SET status = 'Scheduled'
WHERE status IN ('Assigned', 'assigned')
  AND assigned_staff_id IS NOT NULL
  AND scheduled_for IS NOT NULL;

-- Remaining Assigned → Open (clear fields that would break companion CHECKs).
UPDATE public."MaintenanceRequests"
SET
  status = 'Open',
  assigned_staff_id = NULL,
  scheduled_for = NULL,
  started_at = NULL,
  closed_at = NULL,
  hold_reason = NULL,
  next_follow_up_date = NULL,
  resolution_notes = NULL
WHERE status IN ('Assigned', 'assigned');

-- Completed / Cancelled → Closed with companion fields filled.
UPDATE public."MaintenanceRequests"
SET
  status = 'Closed',
  closed_at = COALESCE(closed_at, started_at, created_at, now()),
  resolution_notes = COALESCE(
    NULLIF(TRIM(BOTH FROM resolution_notes), ''),
    'Migrated from legacy status'
  )
WHERE status IN (
  'Completed', 'completed',
  'Cancelled', 'cancelled',
  'Canceled', 'canceled'
);

-- Title-case / whitespace normalize for already-valid labels.
UPDATE public."MaintenanceRequests"
SET status = 'In Progress'
WHERE lower(trim(status)) IN ('in progress', 'in_progress')
  AND status IS DISTINCT FROM 'In Progress';

UPDATE public."MaintenanceRequests"
SET status = 'On Hold'
WHERE lower(trim(status)) IN ('on hold', 'on_hold')
  AND status IS DISTINCT FROM 'On Hold';

UPDATE public."MaintenanceRequests"
SET status = 'Open'
WHERE lower(trim(status)) = 'open' AND status IS DISTINCT FROM 'Open';

UPDATE public."MaintenanceRequests"
SET status = 'Scheduled'
WHERE lower(trim(status)) = 'scheduled' AND status IS DISTINCT FROM 'Scheduled';

UPDATE public."MaintenanceRequests"
SET status = 'Closed'
WHERE lower(trim(status)) = 'closed' AND status IS DISTINCT FROM 'Closed';

-- Any other unknown status → Open (clear companions so Closed/Hold CHECKs pass).
UPDATE public."MaintenanceRequests"
SET
  status = 'Open',
  closed_at = NULL,
  hold_reason = NULL,
  next_follow_up_date = NULL,
  resolution_notes = NULL
WHERE status NOT IN ('Open', 'Scheduled', 'In Progress', 'On Hold', 'Closed');

-- Ensure Closed / In Progress / On Hold / Scheduled companions before CHECKs.
UPDATE public."MaintenanceRequests"
SET
  closed_at = COALESCE(closed_at, started_at, created_at, now()),
  resolution_notes = COALESCE(
    NULLIF(TRIM(BOTH FROM resolution_notes), ''),
    'Migrated from legacy status'
  )
WHERE status = 'Closed'
  AND (
    closed_at IS NULL
    OR resolution_notes IS NULL
    OR length(TRIM(BOTH FROM resolution_notes)) = 0
  );

UPDATE public."MaintenanceRequests"
SET started_at = COALESCE(started_at, created_at, now())
WHERE status = 'In Progress' AND started_at IS NULL;

-- In Progress without assignee → Open (cannot invent staff).
UPDATE public."MaintenanceRequests"
SET
  status = 'Open',
  started_at = NULL,
  closed_at = NULL,
  hold_reason = NULL,
  next_follow_up_date = NULL,
  resolution_notes = NULL
WHERE status = 'In Progress' AND assigned_staff_id IS NULL;

UPDATE public."MaintenanceRequests"
SET
  status = 'Open',
  assigned_staff_id = NULL,
  scheduled_for = NULL,
  started_at = NULL,
  closed_at = NULL,
  hold_reason = NULL,
  next_follow_up_date = NULL,
  resolution_notes = NULL
WHERE status = 'On Hold'
  AND (
    hold_reason IS NULL
    OR length(TRIM(BOTH FROM hold_reason)) = 0
    OR next_follow_up_date IS NULL
  );

UPDATE public."MaintenanceRequests"
SET
  status = 'Open',
  assigned_staff_id = NULL,
  scheduled_for = NULL,
  started_at = NULL,
  closed_at = NULL,
  hold_reason = NULL,
  next_follow_up_date = NULL,
  resolution_notes = NULL
WHERE status = 'Scheduled'
  AND (assigned_staff_id IS NULL OR scheduled_for IS NULL);

-- Non-Closed rows must have closed_at null for requests_closed_details.
UPDATE public."MaintenanceRequests"
SET closed_at = NULL
WHERE status <> 'Closed' AND closed_at IS NOT NULL;

-- ── Remap legacy categories ───────────────────────────────────────
UPDATE public."MaintenanceRequests" SET category = 'Plumbing'
WHERE lower(trim(category)) IN ('plumbing', 'plumber');
UPDATE public."MaintenanceRequests" SET category = 'Electrical'
WHERE lower(trim(category)) IN ('electrical', 'electrician');
UPDATE public."MaintenanceRequests" SET category = 'Heating / AC'
WHERE lower(trim(category)) IN ('heating / ac', 'heating/ac', 'hvac', 'heating', 'ac');
UPDATE public."MaintenanceRequests" SET category = 'Appliance'
WHERE lower(trim(category)) IN ('appliance', 'appliances');
UPDATE public."MaintenanceRequests" SET category = 'Pest control'
WHERE lower(trim(category)) IN ('pest control', 'pest');
UPDATE public."MaintenanceRequests" SET category = 'Locks / keys / doors'
WHERE lower(trim(category)) IN ('locks / keys / doors', 'locks', 'doors', 'keys');
UPDATE public."MaintenanceRequests" SET category = 'Windows'
WHERE lower(trim(category)) = 'windows';
UPDATE public."MaintenanceRequests" SET category = 'Roof / leaks'
WHERE lower(trim(category)) IN ('roof / leaks', 'roof', 'leaks');
UPDATE public."MaintenanceRequests" SET category = 'Mold / water damage'
WHERE lower(trim(category)) IN ('mold / water damage', 'mold', 'water damage');
UPDATE public."MaintenanceRequests" SET category = 'Exterior / yard'
WHERE lower(trim(category)) IN ('exterior / yard', 'exterior', 'yard', 'landscaping');
UPDATE public."MaintenanceRequests" SET category = 'General repair'
WHERE lower(trim(category)) IN ('general repair', 'general', 'handyman', 'repair');
UPDATE public."MaintenanceRequests" SET category = 'Other'
WHERE category NOT IN (
  'Plumbing', 'Electrical', 'Heating / AC', 'Appliance', 'Pest control',
  'Locks / keys / doors', 'Windows', 'Roof / leaks', 'Mold / water damage',
  'Exterior / yard', 'General repair', 'Other'
);

-- Priority Title Case
UPDATE public."MaintenanceRequests" SET priority = 'Low'
WHERE lower(trim(priority)) = 'low' AND priority IS DISTINCT FROM 'Low';
UPDATE public."MaintenanceRequests" SET priority = 'Normal'
WHERE lower(trim(priority)) = 'normal' AND priority IS DISTINCT FROM 'Normal';
UPDATE public."MaintenanceRequests" SET priority = 'High'
WHERE lower(trim(priority)) = 'high' AND priority IS DISTINCT FROM 'High';
UPDATE public."MaintenanceRequests" SET priority = 'Urgent'
WHERE lower(trim(priority)) = 'urgent' AND priority IS DISTINCT FROM 'Urgent';
UPDATE public."MaintenanceRequests" SET priority = 'Normal'
WHERE priority NOT IN ('Low', 'Normal', 'High', 'Urgent');

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
