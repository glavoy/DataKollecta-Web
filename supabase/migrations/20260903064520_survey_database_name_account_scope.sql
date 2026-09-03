-- Widen the "no two surveys share a database" half of
-- enforce_survey_database_binding from project-scoped to account-scoped.
--
-- Why the project scope was not enough: databaseName is a DEVICE-GLOBAL key,
-- not a per-project one. A phone can hold several projects' surveys at once
-- (see ProjectSessionsDocument in the app), and DbService opens one SQLite
-- file per databaseName under a single shared databases/ folder. So two
-- surveys in DIFFERENT projects that declare the same databaseName collide on
-- the device exactly as badly as two in one project -- colliding tables, one
-- shared subject-ID counter.
--
-- The app already refuses that collision (SurveyConfigService's extraction
-- guard and HttpSyncBackend._guardAgainstCollision both reject a cross-project
-- databaseName match). But refusing it only there means the portal happily
-- lets someone build and deploy a survey that phones then silently drop --
-- the failure surfaces in the field, days later, as "the survey never
-- appeared". Catching it at authoring time is the point.
--
-- Scoped to created_by rather than the whole table, matching the precedent
-- already set by survey_packages_name_created_by_idx (UNIQUE (created_by,
-- lower(name))) for survey IDs: one person's surveys are the set that can
-- plausibly end up on one device, and a table-wide rule would have one
-- tenant's rows blocking another's for reasons they could never see.
--
-- Part (a) -- every version of one survey_code declares the same
-- databaseName -- stays project-scoped, because a survey_code is itself
-- project-scoped by survey_packages_code_version_key.

CREATE OR REPLACE FUNCTION public.enforce_survey_database_binding()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  db_name text := NEW.manifest ->> 'databaseName';
  other_db      text;
  other_code    text;
  other_name    text;
  other_project text;
BEGIN
  -- A package with no manifest databaseName carries no binding to enforce.
  -- Legacy rows and mid-save states both look like this; failing them here
  -- would block edits that have nothing to do with versioning.
  IF db_name IS NULL OR db_name = '' THEN
    RETURN NEW;
  END IF;

  -- (a) Siblings in this lineage must agree.
  SELECT sp.manifest ->> 'databaseName', sp.name
    INTO other_db, other_name
    FROM public.survey_packages sp
   WHERE sp.project_id  = NEW.project_id
     AND sp.survey_code = NEW.survey_code
     AND sp.id         <> NEW.id
     AND sp.manifest ->> 'databaseName' IS DISTINCT FROM db_name
   LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'Survey "%" declares database "%", but version "%" of the same survey uses "%".',
      NEW.name, db_name, other_name, other_db
      USING ERRCODE = 'check_violation',
            HINT    = 'sp_lineage_database_mismatch',
            DETAIL  = format('survey_code=%s incoming=%s existing=%s',
                             NEW.survey_code, db_name, other_db);
  END IF;

  -- (b) No other survey may claim this database -- in this project, or in any
  --     other project belonging to the same account. Both reach one device.
  SELECT sp.survey_code, sp.name, p.name
    INTO other_code, other_name, other_project
    FROM public.survey_packages sp
    LEFT JOIN public.projects p ON p.id = sp.project_id
   WHERE sp.manifest ->> 'databaseName' = db_name
     AND sp.id <> NEW.id
     AND NOT (sp.project_id  =           NEW.project_id
         AND  sp.survey_code IS NOT DISTINCT FROM NEW.survey_code)
     AND (sp.project_id = NEW.project_id
          OR (NEW.created_by IS NOT NULL AND sp.created_by = NEW.created_by))
   LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'Database "%" is already used by survey "%" (project "%"). Two different surveys cannot share one database.',
      db_name, other_name, coalesce(other_project, '?')
      USING ERRCODE = 'check_violation',
            HINT    = 'sp_database_in_use',
            DETAIL  = format('database_name=%s incoming_code=%s existing_code=%s',
                             db_name, NEW.survey_code, other_code);
  END IF;

  RETURN NEW;
END;
$$;
