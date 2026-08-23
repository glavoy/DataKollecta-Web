-- Project-level status/archive axes, mirroring survey_packages' pattern --
-- see 20260823063324_survey_status_lifecycle.sql for the shape this
-- follows. Two independent axes:
--   status:      'active' | 'paused'   -- gates field-device access only
--   archived_at: timestamptz | NULL    -- hides from the default project
--                                         list only; never affects access
--
-- Unlike survey_packages, there is no lock/lifecycle trigger here: pausing
-- a project never locks its content -- surveys, forms, members, and
-- settings remain fully editable in the portal regardless of status. It
-- only gates the two field-facing edge functions, app-login and app-sync.
--
-- Backfills status FROM is_active (the column actually read/written
-- everywhere today), NOT from the existing `status text DEFAULT 'active'`
-- column -- nothing has ever written anything but that literal default
-- into it, so it carries no real signal. `is_active IS TRUE` (not a bare
-- `is_active`) treats NULL as inactive, matching app-login's current
-- `.eq("is_active", true)` filter, which already excludes NULL rows today.
--
-- Deliberately does NOT drop `is_active` -- that is a separate, later
-- migration, applied only once the app-login/app-sync/web code deploy
-- that stops reading it is confirmed live and stable. Dropping it here
-- would break every request between this migration landing and that
-- deploy going out.

-- 1. New enum type.
CREATE TYPE public.project_status AS ENUM ('active', 'paused');

-- 2. Retype the dead `status` column in place. Its existing index
--    (idx_projects_status) is rebuilt automatically by this ALTER, the
--    same way idx_survey_packages_status was in the prior migration.
ALTER TABLE public.projects ALTER COLUMN status DROP DEFAULT;

ALTER TABLE public.projects
  ALTER COLUMN status TYPE public.project_status
  USING (CASE WHEN is_active IS TRUE THEN 'active' ELSE 'paused' END)::public.project_status;

ALTER TABLE public.projects
  ALTER COLUMN status SET DEFAULT 'active',
  ALTER COLUMN status SET NOT NULL;

-- 3. Archiving becomes its own axis, exactly mirroring
--    survey_packages.archived_at.
ALTER TABLE public.projects ADD COLUMN archived_at timestamptz;

COMMENT ON COLUMN public.projects.status IS
  'active | paused. Gates field-device access only (app-login, app-sync) -- '
  'portal editing (surveys, members, settings, data) remains fully '
  'available at any status. Independent of archived_at.';
COMMENT ON COLUMN public.projects.archived_at IS
  'When the project was archived. Independent of status: hides it from '
  'the default projects list and changes nothing else -- not field '
  'access, not downloads, not data.';
