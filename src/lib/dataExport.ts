/**
 * Column selection and row building for the data export.
 *
 * Lifted out of `ProjectData.tsx`, where these were inline closures inside a
 * component and so untestable -- which is how both of the defects below
 * survived: a column that is always empty, and a form that vanishes from the
 * export entirely.
 */

import { buildCsv } from '@/lib/csv';
import {
  LEADING_SYSTEM_FIELDS,
  PARENT_LINK_FIELD,
  TRAILING_SYSTEM_FIELDS,
} from '@/lib/xml/systemFields';

/** A question as it arrives from `crfs.fields` (the parsed survey manifest). */
export interface ExportField {
  fieldname?: string;
  id?: string;
  type?: string;
  text?: string;
}

/** The submission shape the export reads. */
export interface ExportSubmission {
  local_unique_id: string;
  data: Record<string, unknown> | null;
  surveyor_id: string;
  collected_at: string;
  submitted_at: string;
  survey_package_id: string;
}

/** One `formchanges` row as the export reads it. */
export interface ExportFormChange {
  formchanges_uuid: string;
  record_uuid: string;
  tablename: string;
  fieldname: string;
  oldvalue: string | null;
  newvalue: string | null;
  surveyor_id: string | null;
  changed_at: string | null;
}

/**
 * The columns that come from the submission row rather than from `data`.
 *
 * `survey_version` leads so a reader can always tell which version produced a
 * row -- without it, a blank cell is ambiguous between "not asked in that
 * version" and "asked and skipped".
 */
export const EXPORT_META_COLUMNS = [
  'survey_version',
  'local_unique_id',
  'surveyor_id',
  'collected_at',
  'submitted_at',
] as const;

/**
 * Device bookkeeping that is carried in `data` but is never worth exporting.
 *
 * `synced_at` is a column the *app* adds to its own SQLite tables
 * (`survey_table_schema.dart`), not a question -- it appears in no package
 * XML. The app sets it only AFTER a row uploads successfully
 * (`record_uploader.dart` marks rows synced in a separate statement once the
 * POST returns), so the value that reaches the server is NULL by
 * construction. Every exported row carried an always-empty column.
 *
 * Dropping it is also what lets `declaredColumns` agree with
 * `submissionColumns`: it is the only key in `data` with no counterpart in the
 * XML, so an empty form's header would otherwise be exactly one column
 * narrower than the same form's header with rows in it.
 */
const DEVICE_ONLY_DATA_KEYS: ReadonlySet<string> = new Set(['synced_at']);

/**
 * Question types that declare no column.
 *
 * An `information` question is a screen, not a field -- the app stores nothing
 * for it, which is why `totals`, `info1` and `end_of_questions` appear in no
 * exported CSV even though they are in the XML.
 */
const NON_COLUMN_QUESTION_TYPES: ReadonlySet<string> = new Set(['information']);

/**
 * The data columns present in a set of submissions: the union across all of
 * them, sorted.
 *
 * The union is the right shape rather than a compromise -- it is exactly what
 * the phone's own SQLite ends up with after `_syncSurveyTable` ALTER TABLEs a
 * new question in, so a v1 row is blank in a v2-only column in both places.
 * Sorted for a deterministic order rather than whichever submission happened
 * to introduce a key first.
 */
export function submissionColumns(submissions: readonly ExportSubmission[]): string[] {
  const names = new Set<string>();
  for (const sub of submissions) {
    if (!sub.data) continue;
    for (const key of Object.keys(sub.data)) {
      if (!DEVICE_ONLY_DATA_KEYS.has(key)) names.add(key);
    }
  }
  return [...names].sort();
}

/**
 * The data columns a form *declares*, for a form that holds no rows.
 *
 * A form with no submissions used to be left out of the export zip altogether,
 * because columns were derived from the rows and there were none. That made
 * "no nets were collected" indistinguishable from a broken export: a manifest
 * declaring four forms would ship three CSVs with nothing to say why. The
 * columns have to come from the form definition instead.
 *
 * `crfs.fields` holds only what the author wrote -- `surveyPackageUpload`
 * strips the reserved system variables on import, since they are re-injected
 * at generation time -- so they are added back here from the single source of
 * truth for that list. `parent_uniqueid` follows from the form having a
 * parent, exactly as it does in the generator.
 */
export function declaredColumns(
  fields: readonly ExportField[] | null | undefined,
  opts: { hasParent?: boolean } = {},
): string[] {
  const names = new Set<string>();

  for (const field of fields ?? []) {
    const name = field.fieldname?.trim();
    if (!name) continue;
    if (NON_COLUMN_QUESTION_TYPES.has(field.type?.toLowerCase() ?? '')) continue;
    if (DEVICE_ONLY_DATA_KEYS.has(name)) continue;
    names.add(name);
  }

  for (const sys of [...LEADING_SYSTEM_FIELDS, ...TRAILING_SYSTEM_FIELDS]) {
    names.add(sys.fieldname);
  }
  if (opts.hasParent) names.add(PARENT_LINK_FIELD.fieldname);

  return [...names].sort();
}

/**
 * One CSV per form, covering every version of the survey.
 *
 * With rows, the columns are the union the rows actually carry. With none,
 * they are the ones the form declares -- so the file is a header-only CSV
 * rather than an absent file, and its shape matches what the same form looks
 * like once it has data.
 */
export function buildSubmissionsCsv(
  submissions: readonly ExportSubmission[],
  versionByPackage: Record<string, number>,
  declared: readonly string[] = [],
): string {
  const fieldNames = submissions.length > 0
    ? submissionColumns(submissions)
    : [...declared];

  const headers = [...EXPORT_META_COLUMNS, ...fieldNames];
  const rows = submissions.map((sub) => [
    versionByPackage[sub.survey_package_id] ?? '',
    sub.local_unique_id,
    sub.surveyor_id,
    sub.collected_at,
    sub.submitted_at,
    ...fieldNames.map((name) => sub.data?.[name]),
  ]);

  return buildCsv(headers, rows);
}

export const FORMCHANGES_COLUMNS = [
  'formchanges_uuid',
  'record_uuid',
  'tablename',
  'fieldname',
  'oldvalue',
  'newvalue',
  'surveyor_id',
  'changed_at',
] as const;

export function buildFormChangesCsv(formchanges: readonly ExportFormChange[]): string {
  return buildCsv(
    [...FORMCHANGES_COLUMNS],
    formchanges.map((fc) => FORMCHANGES_COLUMNS.map((col) => fc[col])),
  );
}
