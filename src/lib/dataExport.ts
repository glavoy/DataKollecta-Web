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
 * `present` arranged into declared order, with whatever `declared` does not
 * name appended and sorted.
 *
 * The tail is the point: a column a row carries but no version declares -- a
 * question since renamed or removed -- still has to appear, or an export would
 * silently lose it. Putting those together at the end makes them obvious
 * rather than scattered through the questions.
 */
function inDeclaredOrder(present: ReadonlySet<string>, declared: readonly string[]): string[] {
  const known = declared.filter((name) => present.has(name));
  const undeclared = [...present].filter((name) => !declared.includes(name)).sort();
  return [...known, ...undeclared];
}

/**
 * The data columns a form declares, in exactly the order the package XML puts
 * the questions in.
 *
 * This is also what gives a form holding no rows a header. Such a form used to
 * be left out of the export zip altogether, because columns were derived from
 * the rows and there were none -- which made "no nets were collected"
 * indistinguishable from a broken export.
 *
 * This mirrors `withSystemFields` in `xml/systemFields.ts`, which is what the
 * generator uses to write the XML -- leading system variables, then the
 * authored questions in the order they were written, then the trailing system
 * variables, then the parent link. (The end-of-questions screen is the one
 * thing that differs, and only because it declares no column.)
 *
 * `crfs.fields` is a jsonb ARRAY written in document order by `xml/form.ts`,
 * so the authored segment needs no sorting -- it needs only to be left alone.
 * The reserved system variables are stripped on import by
 * `surveyPackageUpload`, which is why they are added back here rather than
 * read out of the stored list, and why the four segments below cannot overlap.
 */
export function declaredColumns(
  fields: readonly ExportField[] | null | undefined,
  opts: { hasParent?: boolean } = {},
): string[] {
  const authored: string[] = [];
  for (const field of fields ?? []) {
    const name = field.fieldname?.trim();
    if (!name) continue;
    if (NON_COLUMN_QUESTION_TYPES.has(field.type?.toLowerCase() ?? '')) continue;
    if (DEVICE_ONLY_DATA_KEYS.has(name)) continue;
    authored.push(name);
  }

  return [
    ...LEADING_SYSTEM_FIELDS.map((f) => f.fieldname),
    ...authored,
    ...TRAILING_SYSTEM_FIELDS.map((f) => f.fieldname),
    ...(opts.hasParent ? [PARENT_LINK_FIELD.fieldname] : []),
  ];
}

/**
 * The data columns present in a set of submissions: the union across all of
 * them, ordered by `declared`.
 *
 * The union is the right membership rather than a compromise -- it is exactly
 * what the phone's own SQLite ends up with after `_syncSurveyTable` ALTER
 * TABLEs a new question in, so a v1 row is blank in a v2-only column in both
 * places. But the rows themselves carry no usable order: `submissions.data` is
 * jsonb, and Postgres does not preserve the key order the device wrote. The
 * order has to come from the form definition, which is what `declared` is.
 */
export function submissionColumns(
  submissions: readonly ExportSubmission[],
  declared: readonly string[] = [],
): string[] {
  const names = new Set<string>();
  for (const sub of submissions) {
    if (!sub.data) continue;
    for (const key of Object.keys(sub.data)) {
      if (!DEVICE_ONLY_DATA_KEYS.has(key)) names.add(key);
    }
  }

  return inDeclaredOrder(names, declared);
}

/**
 * One CSV per form, covering every version of the survey.
 *
 * `declared` decides the ORDER in both branches; the rows decide the
 * membership when there are any. A question a version declares but no row ever
 * answered stays out of a populated CSV, and a column the rows carry but no
 * version declares still appears -- at the end, where `submissionColumns` puts
 * it.
 */
export function buildSubmissionsCsv(
  submissions: readonly ExportSubmission[],
  versionByPackage: Record<string, number>,
  declared: readonly string[] = [],
): string {
  const fieldNames = submissions.length > 0
    ? submissionColumns(submissions, declared)
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

/**
 * One record's `data` as entries, in the same order the export puts its
 * columns: the declared questions first, then anything the row carries that no
 * version declares, sorted.
 *
 * Used by the record detail view. `submissions.data` is jsonb, so
 * `Object.entries` alone returns whatever key order Postgres stored -- which is
 * not the order the questions were asked in, and not stable between rows.
 *
 * Drops the same device-only keys the export does, for the same reason: they
 * are NULL on the server by construction, so showing them adds a row that can
 * only ever be empty.
 */
export function orderRecordEntries(
  data: Record<string, unknown>,
  declared: readonly string[],
): [string, unknown][] {
  const keys = new Set(
    Object.keys(data).filter((key) => !DEVICE_ONLY_DATA_KEYS.has(key)),
  );
  return inDeclaredOrder(keys, declared).map((key) => [key, data[key]]);
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
