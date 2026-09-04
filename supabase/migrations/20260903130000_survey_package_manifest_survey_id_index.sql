-- app-sync resolves a submission's survey package by the surveyId inside the
-- package's manifest. That filter had no index of any kind, so every lookup was
-- a sequential scan of survey_packages -- and app-sync ran one per submission,
-- inside the per-row loop. An enumerator returning from two weeks offline with
-- 800 records therefore caused 800 sequential scans, and the cost grew with
-- every version a project accumulated.
--
-- Two changes remove that, and this migration is the half the database owns:
-- the Edge Function now resolves the whole batch's distinct surveyIds in ONE
-- query, and this index makes that query a btree lookup.
--
-- Why an expression index and not a generated column:
--
--   PostgREST already filters on JSON paths directly -- surveyService.ts's
--   findLineageByDatabaseName does `.eq('manifest->>databaseName', ...)` -- and
--   emits `(manifest ->> 'surveyId') = ...`, which an expression index on that
--   exact expression serves. A `manifest_survey_id text GENERATED ALWAYS AS ...
--   STORED` column would work too, but it rewrites the table, and it shows up
--   in the several `select('*')` reads of this table in src/, where a column
--   that cannot be written is a trap for any future read-modify-write. The
--   index needs neither.
--
-- project_id leads the index because app-sync always scopes the lookup to the
-- session's project (that scoping is what stops a device writing into another
-- project's data, so it is not optional), and the surveyId follows it.
CREATE INDEX IF NOT EXISTS idx_survey_packages_manifest_survey_id
  ON public.survey_packages (project_id, (manifest ->> 'surveyId'));

COMMENT ON INDEX public.idx_survey_packages_manifest_survey_id IS
  'Serves app-sync''s per-batch survey-package resolution: '
  'project_id = $1 AND manifest ->> ''surveyId'' IN (...). The expression must '
  'stay character-identical to the one PostgREST emits for a '
  'manifest->>surveyId filter, or the planner will not use this index.';
