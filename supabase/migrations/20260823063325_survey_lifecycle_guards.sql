-- Survey lifecycle guards: lock content edits and deletes once a survey
-- reaches 'deployed' or 'complete', and enforce legal status transitions.
--
-- Mirrors LEGAL_TRANSITIONS / LOCKED_STATUSES in src/lib/surveyStatus.ts.
-- Keep the two in sync by hand -- src/lib/__tests__/surveyStatus.test.ts
-- pins the client-side list to a copy of the `allowed` array below so a
-- drift shows up as a failing test rather than a UI/DB disagreement in
-- production.
--
-- Trigger bodies compare status::text throughout so no enum literal ever
-- appears in a function body (avoids any PG version's "unsafe use of new
-- enum value" restriction, and keeps CREATE OR REPLACE FUNCTION independent
-- of what values the enum currently has).
--
-- Deliberately no bypass hatch (no current_setting() escape for
-- service_role): app-login only SELECTs and app-sync never touches
-- survey_packages, so nothing in production needs one, and a bypass that
-- exists gets used.

-- 3a. Lifecycle + content lock on survey_packages.
CREATE OR REPLACE FUNCTION public.enforce_survey_package_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  old_status text := OLD.status::text;
  new_status text := NEW.status::text;
  locked  constant text[] := ARRAY['deployed','complete'];
  allowed constant text[] := ARRAY[
    'draft>test', 'draft>deployed',
    'test>draft', 'test>deployed',
    'deployed>complete',
    'complete>deployed'
  ];
BEGIN
  IF new_status IS DISTINCT FROM old_status
     AND NOT ((old_status || '>' || new_status) = ANY (allowed)) THEN
    RAISE EXCEPTION 'Survey "%" cannot move from % to %.', OLD.name, old_status, new_status
      USING ERRCODE = 'check_violation',
            HINT    = 'sp_illegal_transition',
            DETAIL  = format('survey_id=%s from=%s to=%s', OLD.name, old_status, new_status);
  END IF;

  -- archived_at is deliberately excluded from this diff -- archiving and
  -- un-archiving a locked survey must stay possible, since it changes
  -- nothing about the survey's content or its status.
  IF old_status = ANY (locked) THEN
    IF  NEW.name          IS DISTINCT FROM OLD.name
    OR  NEW.display_name  IS DISTINCT FROM OLD.display_name
    OR  NEW.manifest      IS DISTINCT FROM OLD.manifest
    OR  NEW.zip_file_path IS DISTINCT FROM OLD.zip_file_path
    OR  NEW.version_date  IS DISTINCT FROM OLD.version_date
    OR  NEW.description   IS DISTINCT FROM OLD.description
    OR  NEW.project_id    IS DISTINCT FROM OLD.project_id
    OR  NEW.created_by    IS DISTINCT FROM OLD.created_by
    THEN
      RAISE EXCEPTION 'Survey "%" is % and its content can no longer be changed.',
        OLD.name, old_status
        USING ERRCODE = 'check_violation',
              HINT    = 'sp_locked',
              DETAIL  = format('survey_id=%s status=%s table=survey_packages',
                                OLD.name, old_status);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_survey_packages_lifecycle ON public.survey_packages;
CREATE TRIGGER trg_survey_packages_lifecycle
  BEFORE UPDATE ON public.survey_packages
  FOR EACH ROW EXECUTE FUNCTION public.enforce_survey_package_lifecycle();

-- 3b. Delete guard. Without this, "you can't edit a deployed survey" is
-- defeated by delete-then-reupload under the same survey ID -- and
-- handleDeleteSurvey (ProjectDetail.tsx) deletes submissions before the
-- row, so the FK on submissions.survey_package_id never blocks it either.
--
-- Exempts a survey_packages row being removed because its whole PROJECT is
-- being deleted (survey_packages.project_id -> projects is itself
-- ON DELETE CASCADE): deleting a project is a legitimate way to take a
-- deployed survey down along with everything else, confirmed explicitly by
-- the project owner (ProjectSettings.tsx requires typing the project slug).
-- Detected by the parent project no longer existing -- by the time this
-- cascade fires, Postgres has already removed the projects row.
CREATE OR REPLACE FUNCTION public.enforce_survey_package_delete_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = OLD.project_id) THEN
    RETURN OLD;
  END IF;

  IF OLD.status::text = ANY (ARRAY['deployed','complete']) THEN
    RAISE EXCEPTION 'Survey "%" is % and cannot be deleted. Archive it instead.',
      OLD.name, OLD.status
      USING ERRCODE = 'check_violation',
            HINT    = 'sp_delete_locked',
            DETAIL  = format('survey_id=%s status=%s', OLD.name, OLD.status);
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_survey_packages_delete_guard ON public.survey_packages;
CREATE TRIGGER trg_survey_packages_delete_guard
  BEFORE DELETE ON public.survey_packages
  FOR EACH ROW EXECUTE FUNCTION public.enforce_survey_package_delete_guard();

-- 3c. crfs guard. Question content lives in crfs, a separate table with its
-- own FK to survey_packages -- a trigger on survey_packages alone never sees
-- edits made here, and saveSurveyPackage upserts every crf row on every
-- save.
--
-- crfs has TWO independent cascade edges to worry about:
--   crfs.survey_package_id -> survey_packages  (ON DELETE CASCADE)
--   crfs.project_id        -> projects         (ON DELETE CASCADE, directly)
-- Deleting a project cascades through BOTH. The naive "is the
-- survey_packages parent already gone" check (IF FOUND) only recognises the
-- first edge -- but Postgres does not guarantee that edge resolves before
-- the second one fires. In practice the direct crfs.project_id cascade can
-- run WHILE the survey_packages row is still sitting there with a locked
-- status, so that check alone still blocks a whole-project delete. The
-- reliable signal is whether crfs's own project_id still exists: if it
-- doesn't, this row is being removed by a project-level cascade no matter
-- which edge triggered it, and must never be blocked.
CREATE OR REPLACE FUNCTION public.enforce_crf_parent_unlocked()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  locked constant text[] := ARRAY['deployed','complete'];
  p_name text;
  p_status text;
BEGIN
  -- INSERT/UPDATE: the destination parent must be unlocked.
  IF TG_OP IN ('INSERT','UPDATE')
     AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = NEW.project_id) THEN
    SELECT sp.name, sp.status::text
      INTO p_name, p_status
      FROM public.survey_packages sp
     WHERE sp.id = NEW.survey_package_id;

    IF FOUND AND p_status = ANY (locked) THEN
      RAISE EXCEPTION 'Survey "%" is % and its forms can no longer be changed.',
        p_name, p_status
        USING ERRCODE = 'check_violation', HINT = 'sp_locked',
              DETAIL  = format('survey_id=%s status=%s table=crfs', p_name, p_status);
    END IF;
  END IF;

  -- UPDATE that re-parents a form, and DELETE: the ORIGINAL parent must
  -- also be unlocked -- otherwise a form could be moved off a locked survey.
  --
  -- The project-existence check is what makes a whole-project delete work
  -- (see the function comment above) -- NOT the survey_packages lookup
  -- alone. The survey_packages "IF FOUND" check still matters on its own
  -- for a direct `DELETE FROM survey_packages` of a draft/test survey
  -- (single cascade edge, parent genuinely gone by the time this fires),
  -- but cannot be trusted as the ONLY guard once a second, independent
  -- edge into the same child table exists.
  IF TG_OP IN ('UPDATE','DELETE')
     AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = OLD.project_id) THEN
    SELECT sp.name, sp.status::text
      INTO p_name, p_status
      FROM public.survey_packages sp
     WHERE sp.id = OLD.survey_package_id;

    IF FOUND AND p_status = ANY (locked) THEN
      RAISE EXCEPTION 'Survey "%" is % and its forms can no longer be changed.',
        p_name, p_status
        USING ERRCODE = 'check_violation', HINT = 'sp_locked',
              DETAIL  = format('survey_id=%s status=%s table=crfs', p_name, p_status);
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_crfs_parent_lock ON public.crfs;
CREATE TRIGGER trg_crfs_parent_lock
  BEFORE INSERT OR UPDATE OR DELETE ON public.crfs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_crf_parent_unlocked();
