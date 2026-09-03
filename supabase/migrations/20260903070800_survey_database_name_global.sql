-- Widen the "no two surveys share a database" half of
-- enforce_survey_database_binding again: from account-scoped to PLATFORM-WIDE.
--
-- The previous migration scoped it to created_by, reasoning that one person's
-- surveys are the set that can plausibly reach one device. That reasoning was
-- wrong, and the code says so plainly:
--
--     final dbDir = Directory(p.join(baseDbDir.path, AppConfig.storageFolder,
--                                    'databases'));
--     final dbPath = p.join(dbDir.path, dbName);        -- db_service.dart
--
-- One flat folder per install. No project segment, no account segment --
-- databaseName alone IS the filename. A field worker can be a member of two
-- projects owned by two different accounts (two PIs running studies at one
-- site is the ordinary case, not an exotic one), and if those two surveys
-- declare the same databaseName they resolve to the same physical file:
-- colliding tables, one shared subject-ID counter, two studies' records
-- interleaved.
--
-- The app does refuse that -- SurveyConfigService's extraction guard and
-- HttpSyncBackend._guardAgainstCollision both reject a cross-PROJECT
-- databaseName match, and two accounts' projects are different projects. But
-- refusing it only there is precisely the failure this whole check exists to
-- prevent: the portal deploys a survey that phones then silently drop, and it
-- surfaces days later, in the field, as "the survey never appeared".
--
-- So the namespace being defended is global, and the constraint has to be too.
-- Yes, that means one account's databaseName can block another's. That is a
-- real cost, and it is the smaller one: the alternative is a survey that
-- installs for some field workers and not others depending on what else is on
-- their phone. The remedy is also cheap and entirely in the author's hands --
-- pick a more specific name, which the existing convention (<study>.sqlite,
-- e.g. prism_css.sqlite) already tends to produce.
--
-- Error messages are split for this reason: a collision with the caller's OWN
-- survey names the survey and project, because that is actionable and theirs
-- to see. A collision with another account's survey deliberately reveals
-- NOTHING about it -- not the survey name, not the project, not who owns it --
-- since the trigger runs with the table fully visible to it and RLS does not
-- apply inside a trigger body.
--
-- Part (a) -- every version of one survey_code declares the same databaseName
-- -- stays project-scoped, because a survey_code is itself project-scoped by
-- survey_packages_code_version_key.
--
-- KNOWN LIMIT: this is a trigger, so it reads committed rows. Two surveys
-- claiming the same databaseName inserted concurrently can both pass, since
-- neither sees the other's uncommitted row. Making that impossible needs a
-- separate registry table with databaseName as its primary key, which is a
-- larger change; the trigger closes the case that actually happens (a name
-- chosen against what is already there).

CREATE OR REPLACE FUNCTION public.enforce_survey_database_binding()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  db_name text := NEW.manifest ->> 'databaseName';
  other_db         text;
  other_code       text;
  other_name       text;
  other_project    text;
  other_created_by uuid;
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

  -- (b) No other survey anywhere may claim this database.
  SELECT sp.survey_code, sp.name, p.name, sp.created_by
    INTO other_code, other_name, other_project, other_created_by
    FROM public.survey_packages sp
    LEFT JOIN public.projects p ON p.id = sp.project_id
   WHERE sp.manifest ->> 'databaseName' = db_name
     AND sp.id <> NEW.id
     AND NOT (sp.project_id  =                   NEW.project_id
         AND  sp.survey_code IS NOT DISTINCT FROM NEW.survey_code)
   ORDER BY (sp.created_by IS NOT DISTINCT FROM NEW.created_by) DESC
   LIMIT 1;

  IF FOUND THEN
    -- The caller's own survey: name it, that is the actionable part.
    IF other_created_by IS NOT DISTINCT FROM NEW.created_by THEN
      RAISE EXCEPTION
        'Database "%" is already used by survey "%" (project "%"). Two different surveys cannot share one database.',
        db_name, other_name, coalesce(other_project, '?')
        USING ERRCODE = 'check_violation',
              HINT    = 'sp_database_in_use',
              DETAIL  = format('database_name=%s incoming_code=%s existing_code=%s',
                               db_name, NEW.survey_code, other_code);
    END IF;

    -- Someone else's survey: say only that the name is taken. Nothing about
    -- whose it is, which project it lives in, or what it is called.
    RAISE EXCEPTION
      'Database name "%" is already in use. Database names must be unique across the whole platform, because a phone keeps every survey it holds in one folder named by this value. Choose a different one.',
      db_name
      USING ERRCODE = 'check_violation',
            HINT    = 'sp_database_in_use_elsewhere',
            DETAIL  = format('database_name=%s incoming_code=%s', db_name, NEW.survey_code);
  END IF;

  RETURN NEW;
END;
$$;
