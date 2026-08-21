/**
 * Reserved system variables and the end-of-survey screen.
 *
 * The app records these itself, but it will only do so if the question is
 * *present in the XML*: an automatic question is computed when navigation
 * reaches it, so its position decides what it records. Nothing in the app adds
 * or moves them -- that is the generator's job alone.
 *
 * Getting this wrong is not cosmetic. Without a `uniqueid` question, nothing
 * populates that column, and `record_uploader.dart` skips every row whose
 * `uniqueid` is not a string. The survey collects data and then silently fails
 * to sync any of it.
 *
 * Injection happens at generation time rather than being materialised into the
 * designer's question list, so that:
 *   - it is idempotent by construction (drop-then-insert), meaning a
 *     SurveyGen package can be imported, saved and re-exported without ever
 *     accumulating duplicates;
 *   - position stays a property of the document, not something a user can
 *     break by dragging a row in the designer.
 */

import type { FieldType, SurveyQuestion } from '@/types/survey';

export interface SystemField {
  fieldname: string;
  fieldtype: FieldType;
}

/**
 * Written before the first real question, so their values are readable by
 * everything that follows -- `[[startdate]]` is a common `age_at_date` target.
 */
export const LEADING_SYSTEM_FIELDS: readonly SystemField[] = [
  { fieldname: 'starttime', fieldtype: 'datetime' },
  { fieldname: 'startdate', fieldtype: 'date' },
];

/**
 * Written after the last real question but before the end screen. They are
 * empty during the interview, which is why a survey must never reference them.
 */
export const TRAILING_SYSTEM_FIELDS: readonly SystemField[] = [
  { fieldname: 'uniqueid', fieldtype: 'text' },
  { fieldname: 'swver', fieldtype: 'text' },
  { fieldname: 'survey_id', fieldtype: 'text' },
  { fieldname: 'lastmod', fieldtype: 'datetime' },
  { fieldname: 'stoptime', fieldtype: 'datetime' },
];

export const RESERVED_SYSTEM_FIELDNAMES: ReadonlySet<string> = new Set(
  [...LEADING_SYSTEM_FIELDS, ...TRAILING_SYSTEM_FIELDS].map((f) => f.fieldname),
);

/**
 * The Computed Automatic Variables. The app computes these, but the *author*
 * declares them -- they are useful anywhere a survey wants today's date, and
 * one common use is immediately before an `idconfig`-generated ID field, a
 * position nothing could infer.
 *
 * Listed here to document that they are NOT reserved: never injected, never
 * stripped. Present for the validation phase.
 */
export const KNOWN_AUTOMATIC_FIELDNAMES: ReadonlySet<string> = new Set([
  'yyyy',
  'yy',
  'mm',
  'dd',
  'doy',
]);

export const END_OF_QUESTIONS_FIELDNAME = 'end_of_questions';

/**
 * The app matches on this exact sentence to decide whether it owns the wording
 * (and may translate it) or whether an author customised it. Changing this
 * string breaks French builds.
 */
export const GENERATED_END_TEXT = "Press the 'Finish' button to save the data.";

export function isReservedFieldname(name: string): boolean {
  return RESERVED_SYSTEM_FIELDNAMES.has(name.trim().toLowerCase());
}

export function isKnownAutomaticFieldname(name: string): boolean {
  return KNOWN_AUTOMATIC_FIELDNAMES.has(name.trim().toLowerCase());
}

function systemQuestion(f: SystemField): SurveyQuestion {
  return {
    id: `system-${f.fieldname}`,
    type: 'calculated',
    fieldname: f.fieldname,
    fieldtype: f.fieldtype,
    text: '',
  };
}

function endOfQuestions(text?: string): SurveyQuestion {
  return {
    id: `system-${END_OF_QUESTIONS_FIELDNAME}`,
    type: 'information',
    fieldname: END_OF_QUESTIONS_FIELDNAME,
    fieldtype: 'n/a',
    text: text && text.trim() !== '' ? text : GENERATED_END_TEXT,
  };
}

function isEndOfQuestions(q: SurveyQuestion): boolean {
  return q.fieldname?.trim().toLowerCase() === END_OF_QUESTIONS_FIELDNAME;
}

/**
 * Produce the full question list for a document: authored questions bracketed
 * by the system variables, with the end screen last.
 *
 * Drops any declared reserved field first, so this is idempotent for any input
 * including its own output. That is what makes an import/export round trip
 * safe without relying on the importer having stripped them.
 */
export function withSystemFields(
  questions: readonly SurveyQuestion[],
  endText?: string,
): SurveyQuestion[] {
  const authored = questions.filter(
    (q) => !isReservedFieldname(q.fieldname ?? '') && !isEndOfQuestions(q),
  );

  // If the author customised the end screen, keep their wording.
  const existingEnd = questions.find(isEndOfQuestions);
  const text = endText ?? existingEnd?.text;

  return [
    ...LEADING_SYSTEM_FIELDS.map(systemQuestion),
    ...authored,
    ...TRAILING_SYSTEM_FIELDS.map(systemQuestion),
    endOfQuestions(text),
  ];
}

/**
 * The import-side inverse: strip the generated rows so what we persist is only
 * what a person actually authored.
 *
 * Returns the end screen's text when it differs from the generated sentence,
 * so a customised one survives the round trip.
 */
export function stripGeneratedQuestions(questions: readonly SurveyQuestion[]): {
  questions: SurveyQuestion[];
  endText?: string;
} {
  const end = questions.find(isEndOfQuestions);
  const endText =
    end && end.text && end.text.trim() !== '' && end.text.trim() !== GENERATED_END_TEXT
      ? end.text
      : undefined;

  return {
    questions: questions.filter(
      (q) => !isReservedFieldname(q.fieldname ?? '') && !isEndOfQuestions(q),
    ),
    endText,
  };
}
