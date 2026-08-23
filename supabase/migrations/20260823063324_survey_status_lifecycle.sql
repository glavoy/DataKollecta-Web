-- Survey lifecycle: rename the survey_status enum and split archiving out
-- into its own axis.
--
-- Before: draft | active | complete | archived
-- After:  draft | test | deployed | complete   (status -- where the survey is in its life)
--         + archived_at timestamptz            (independent -- whether it's hidden from the list)
--
-- Rationale for splitting archived out: the old single enum forced a false
-- choice -- you couldn't tidy away an abandoned draft without pretending it
-- was deployed, and un-archiving had to guess which lifecycle state to
-- restore. Archiving now changes nothing except the default surveys-list
-- filter: it does not stop downloads (that's what 'complete' is for), does
-- not hide data (ProjectData.tsx has no status filter and must keep none),
-- and does not block Duplicate or Download.
--
-- MUST ship after the app-login edge function change that filters
-- downloadable surveys in TypeScript rather than via `.eq("status","active")`
-- -- otherwise this migration makes every phone see zero surveys the moment
-- it runs, with no error anywhere (see the comment in app-login/index.ts).

-- 1. Normalise NULLs first. A NULL status is already excluded by today's
--    .eq('status','active'), so mapping it to draft preserves exactly what
--    phones can currently download.
UPDATE public.survey_packages SET status = 'draft' WHERE status IS NULL;

-- 2. Archiving becomes its own axis. Capture the fact for any existing
--    'archived' row before that value leaves the enum.
ALTER TABLE public.survey_packages ADD COLUMN archived_at timestamptz;

UPDATE public.survey_packages
   SET archived_at = coalesce(updated_at, now())
 WHERE status::text = 'archived';

-- 3. Recreate the type. 'active' -> 'deployed'; 'archived' -> 'complete',
--    which is what it meant on the lifecycle axis now that the visibility
--    half lives in archived_at.
ALTER TABLE public.survey_packages ALTER COLUMN status DROP DEFAULT;

ALTER TYPE public.survey_status RENAME TO survey_status_old;

CREATE TYPE public.survey_status AS ENUM ('draft', 'test', 'deployed', 'complete');

ALTER TABLE public.survey_packages
  ALTER COLUMN status TYPE public.survey_status
  USING (CASE status::text
           WHEN 'active'   THEN 'deployed'
           WHEN 'archived' THEN 'complete'
           ELSE status::text
         END)::public.survey_status;

ALTER TABLE public.survey_packages
  ALTER COLUMN status SET DEFAULT 'draft',
  ALTER COLUMN status SET NOT NULL;

DROP TYPE public.survey_status_old;

-- 4. Lineage for the duplicate-survey feature.
ALTER TABLE public.survey_packages
  ADD COLUMN copied_from uuid REFERENCES public.survey_packages(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.survey_packages.archived_at IS
  'When the survey was archived. Independent of status: hides it from the default '
  'surveys list and changes nothing else -- not downloads, data, or duplication.';
COMMENT ON COLUMN public.survey_packages.copied_from IS
  'Survey this package was duplicated from. Nullable; SET NULL if the source is deleted.';
