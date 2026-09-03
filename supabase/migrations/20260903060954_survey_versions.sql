-- Survey versions: a revision of a deployed survey is a new version of the SAME
-- survey, sharing one dataset -- one SQLite file on the device, one grouped view
-- and one merged export in the portal -- while the deployed version stays locked.
--
-- Before: the only way past the deployed lock was Duplicate, which deliberately
-- minted a new databaseName. On the phone that is a different SQLite file, so
-- subject-ID counters restart and the data lands in a second, unrelated bucket.
--
-- After:  survey_code groups versions; version orders them; every version of a
--         code declares the SAME manifest databaseName, which is what actually
--         gives data continuity on the device (DbService opens one database per
--         databaseName, and _syncSurveyTable ALTER TABLEs new questions in).
--
-- Duplicate survives unchanged in meaning -- it forks a genuinely NEW study, and
-- therefore starts its own survey_code at version 1 with its own databaseName.
--
-- Deliberately NOT added: any "one deployed version per lineage" constraint.
-- Field teams in different regions start at different times, so two versions of
-- one survey being deployed simultaneously is a supported state, not an anomaly.
-- Status stays manual and per-version in both directions (deployed>complete and
-- complete>deployed are both already legal).

-- 1. The lineage columns.
ALTER TABLE public.survey_packages
  ADD COLUMN survey_code text,
  ADD COLUMN version integer NOT NULL DEFAULT 1;

-- Every existing survey becomes v1 of its own lineage, keyed by its own survey
-- ID. Deliberately does NOT fold existing copied_from chains into lineages: a
-- duplicate was created with its own databaseName, so its data genuinely lives
-- in a separate SQLite file on every device and cannot be retro-merged by
-- relabelling rows here.
UPDATE public.survey_packages SET survey_code = name WHERE survey_code IS NULL;

ALTER TABLE public.survey_packages ALTER COLUMN survey_code SET NOT NULL;

ALTER TABLE public.survey_packages
  ADD CONSTRAINT survey_packages_code_version_key UNIQUE (project_id, survey_code, version);

CREATE INDEX idx_survey_packages_code ON public.survey_packages (project_id, survey_code);

COMMENT ON COLUMN public.survey_packages.survey_code IS
  'Stable identifier shared by every version of one survey. Text rather than a '
  'uuid pointing at the first version, because draft/test versions are '
  'deletable and such a pointer would dangle. All rows sharing a code within a '
  'project must declare the same manifest databaseName -- see '
  'enforce_survey_database_binding.';
COMMENT ON COLUMN public.survey_packages.version IS
  'Monotonic version within (project_id, survey_code); the first is 1. The '
  'canonical ordering -- version_date is a display date, not an ordering key.';

-- 2. Extend the locked-content diff with the lineage columns, so a deployed or
--    complete survey cannot be moved into another lineage or renumbered -- which
--    would silently re-point its collected data at a different dataset.
--
--    Otherwise identical to the version in
--    20260823063325_survey_lifecycle_guards.sql: same allowed-transition list,
--    same status::text convention (no enum literal in a function body), same
--    deliberate exclusion of archived_at from the content diff.
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

  IF old_status = ANY (locked) THEN
    IF  NEW.name          IS DISTINCT FROM OLD.name
    OR  NEW.display_name  IS DISTINCT FROM OLD.display_name
    OR  NEW.manifest      IS DISTINCT FROM OLD.manifest
    OR  NEW.zip_file_path IS DISTINCT FROM OLD.zip_file_path
    OR  NEW.version_date  IS DISTINCT FROM OLD.version_date
    OR  NEW.description   IS DISTINCT FROM OLD.description
    OR  NEW.project_id    IS DISTINCT FROM OLD.project_id
    OR  NEW.created_by    IS DISTINCT FROM OLD.created_by
    OR  NEW.survey_code   IS DISTINCT FROM OLD.survey_code
    OR  NEW.version       IS DISTINCT FROM OLD.version
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

-- 3. The invariant the whole feature rests on: within a project, survey_code and
--    the manifest's databaseName are bound one-to-one, in BOTH directions.
--
--    (a) every version of one code must declare the same databaseName -- that
--        shared SQLite file IS what makes versions share a dataset; and
--    (b) no two codes may claim the same databaseName -- two unrelated studies
--        pointed at one file means colliding tables and a shared subject-ID
--        counter, which is corruption rather than a preference. This half is
--        also what makes ZIP-upload lineage matching unambiguous: at most one
--        lineage can ever match an incoming databaseName, so the portal never
--        has to ask the user which survey a package belongs to.
--
--    Enforced here and not only in the client for the usual reason -- the
--    client can be bypassed, and (b) is unrecoverable once data exists.
--    Deliberately no bypass hatch, matching the lifecycle guards migration.
CREATE OR REPLACE FUNCTION public.enforce_survey_database_binding()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  db_name text := NEW.manifest ->> 'databaseName';
  other_db   text;
  other_code text;
  other_name text;
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

  -- (b) No other lineage in this project may claim the same database.
  SELECT sp.survey_code, sp.name
    INTO other_code, other_name
    FROM public.survey_packages sp
   WHERE sp.project_id = NEW.project_id
     AND sp.survey_code IS DISTINCT FROM NEW.survey_code
     AND sp.manifest ->> 'databaseName' = db_name
   LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'Database "%" is already used by survey "%". Two different surveys cannot share one database.',
      db_name, other_name
      USING ERRCODE = 'check_violation',
            HINT    = 'sp_database_in_use',
            DETAIL  = format('database_name=%s incoming_code=%s existing_code=%s',
                             db_name, NEW.survey_code, other_code);
  END IF;

  RETURN NEW;
END;
$$;

-- Named to sort AFTER trg_survey_packages_lifecycle, deliberately: Postgres
-- fires BEFORE triggers in trigger-name order, and both of these reject an
-- attempt to re-lineage a deployed survey. Whichever runs first decides the
-- error the user actually sees, and "this survey is locked" is the useful
-- message there -- "that database is already in use" describes a consequence
-- of the change rather than the reason it was refused.
DROP TRIGGER IF EXISTS trg_survey_packages_database_binding ON public.survey_packages;
DROP TRIGGER IF EXISTS trg_survey_packages_post_lifecycle_database_binding ON public.survey_packages;
CREATE TRIGGER trg_survey_packages_post_lifecycle_database_binding
  BEFORE INSERT OR UPDATE ON public.survey_packages
  FOR EACH ROW EXECUTE FUNCTION public.enforce_survey_database_binding();
