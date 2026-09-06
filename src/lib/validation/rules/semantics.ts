/**
 * Comparison semantics -- whether a comparison the survey writes can ever be
 * true on the values the compared field can hold.
 *
 * Ported from SurveyGen's `_check_logic_operators`, `_check_logic_literals`,
 * `_check_checkbox_skip_values` and the processor's
 * `_check_csv_columns_and_skip_values`. Three of the things they guard
 * against cannot happen here: a skip operator comes from a dropdown, a
 * `fieldname` from a picker, a csv file from the uploaded list. What remains
 * is the free text -- a logic-check condition -- and the values: a skip's
 * comparison value is typed, and nothing until now checked it against the
 * codes of the field it tests.
 *
 * Every check reads the app's own semantics: `FieldComparator.compare` in the
 * app tokenizes a condition with `[<>=!]+` and compares as false on an
 * operator it does not know, so `age >> 18` parses, never fires and never
 * complains; and it compares numerically when both sides parse, so `01`
 * matches `1`.
 */

import type { SurveyForm, SurveyQuestion, SkipRule, CsvFile } from '@/types/survey';
import { RULE, type Finding } from '../types';
import { resolvedResponseMode } from '@/lib/xml/question';
import { parseCsvColumnValues, parseCsvHeaderRow } from '@/lib/csvHeaders';

const KNOWN_COMPARISONS = new Set(['=', '==', '!=', '<>', '<', '>', '<=', '>=']);
const QUOTED_STRING_RE = /'[^']*'/g;
const OPERATOR_TOKEN_RE = /[\w_]+\s*([<>=!]+)\s*/g;
// `field = 3`, `field <> 'x'`, `field contains 99`: a field compared with a
// literal, the shape whose right-hand side can be checked against a code list.
const LITERAL_TEST_RE =
  /([\w_]+)\s*(==|=|<>|!=|contains|does not contain)\s*(?:'([^']*)'|(-?\d+(?:\.\d+)?))(?![\w.])/g;
const EQUALITY_OPERATORS = new Set(['=', '<>', 'contains', 'does not contain']);
const SELECTION_TYPES = new Set(['radio', 'checkbox', 'combobox']);

/** `FieldComparator.compare(code, '=', literal)`: numeric when both parse. */
export function sameCode(code: string, literal: string): boolean {
  const a = Number(code);
  const b = Number(literal);
  if (code.trim() !== '' && literal.trim() !== '' && !Number.isNaN(a) && !Number.isNaN(b)) return a === b;
  return code === literal;
}

/**
 * The codes a selection question can hold, or undefined when they are not
 * knowable here: a static list's values plus the Don't-know / Refuse
 * sentinels; for a csv-backed list, the value column of the uploaded file
 * plus its `not_in_list` / `dont_know` values. A database-backed list is
 * unknowable until the device has data.
 */
export function codesOf(q: SurveyQuestion, csvFiles: readonly CsvFile[]): { codes: Set<string>; source: string } | undefined {
  if (!SELECTION_TYPES.has(q.type)) return undefined;
  const specials = [q.dontKnow, q.refuse].filter((v): v is string => !!v);

  if (resolvedResponseMode(q) === 'static') {
    const values = (q.responses ?? []).map((r) => r.value);
    if (values.length === 0) return undefined;
    return { codes: new Set([...values, ...specials]), source: 'its response list' };
  }

  const dr = q.dynamicResponses;
  if (!dr || dr.source !== 'csv' || !dr.file) return undefined;
  const file = csvFiles.find((f) => f.filename === dr.file);
  if (!file) return undefined;
  const column = dr.valueColumn || dr.displayColumn;
  if (!column || !parseCsvHeaderRow(file.content).includes(column)) return undefined;
  const codes = parseCsvColumnValues(file.content, column);
  for (const v of [dr.notInList?.value, dr.dontKnow?.value, ...specials]) {
    if (v) codes.add(v);
  }
  return { codes, source: `${dr.file} (${column})` };
}

function describeCodes(codes: Set<string>): string {
  const sorted = [...codes].sort((a, b) => {
    const na = Number(a);
    const nb = Number(b);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
    return a.localeCompare(b);
  });
  return sorted.length > 12 ? `${sorted.slice(0, 12).join(', ')}, …` : sorted.join(', ');
}

function logicCheckFindings(
  form: SurveyForm,
  q: SurveyQuestion,
  index: number,
  csvFiles: readonly CsvFile[],
): Finding[] {
  const findings: Finding[] = [];
  const byName = new Map(form.questions.map((other) => [other.fieldname.trim().toLowerCase(), other]));

  (q.logicCheck ?? []).forEach((check, i) => {
    const base = {
      scope: 'question' as const,
      questionId: q.id,
      questionIndex: index,
      fieldname: q.fieldname,
      part: 'logicCheck' as const,
      partIndex: i,
    };
    const expression = check.condition.replace(QUOTED_STRING_RE, "''");

    const unknown = new Set<string>();
    for (const m of expression.matchAll(OPERATOR_TOKEN_RE)) {
      if (!KNOWN_COMPARISONS.has(m[1])) unknown.add(m[1]);
    }
    if (unknown.size > 0) {
      findings.push({
        ...base,
        ruleId: RULE.logicUnknownOperator,
        severity: 'error',
        subject: [...unknown].join(' '),
        message: `Logic check uses '${[...unknown].join("', '")}', which is not a comparison the app knows.`,
        hint: 'The app accepts it and then compares as false, so the check could never fire. Use one of =, <>, !=, <, >, <=, >=.',
      });
    }

    for (const m of check.condition.matchAll(LITERAL_TEST_RE)) {
      const [, field, , quoted, number] = m;
      const literal = quoted ?? number;
      const target = byName.get(field.trim().toLowerCase());
      if (!target) continue;
      const known = codesOf(target, csvFiles);
      if (!known) continue;
      if ([...known.codes].some((code) => sameCode(code, literal))) continue;
      findings.push({
        ...base,
        ruleId: RULE.logicLiteralNotACode,
        severity: 'error',
        subject: literal,
        message: `Logic check compares '${field}' with ${literal}, which is not one of its codes (${describeCodes(known.codes)}).`,
        hint: 'The comparison can never be true, so the check never fires -- or fires on a value the field cannot hold.',
      });
    }
  });

  return findings;
}

function skipValueFindings(
  form: SurveyForm,
  q: SurveyQuestion,
  index: number,
  kind: 'preskip' | 'postskip',
  rules: SkipRule[],
  csvFiles: readonly CsvFile[],
): Finding[] {
  const findings: Finding[] = [];
  const byName = new Map(form.questions.map((other) => [other.fieldname.trim().toLowerCase(), other]));

  rules.forEach((rule, i) => {
    if (rule.response_type === 'dynamic') return;
    if (!EQUALITY_OPERATORS.has(rule.condition)) return;
    const target = byName.get(rule.fieldname.trim().toLowerCase());
    if (!target) return; // references.ts reports an unknown tested field
    const known = codesOf(target, csvFiles);
    if (!known) return;
    if ([...known.codes].some((code) => sameCode(code, rule.response))) return;

    const alwaysFires = rule.condition === '<>' || rule.condition === 'does not contain';
    findings.push({
      scope: 'question',
      questionId: q.id,
      questionIndex: index,
      fieldname: q.fieldname,
      part: kind,
      partIndex: i,
      ruleId: RULE.skipValueNotACode,
      severity: 'error',
      subject: rule.response,
      message: `${kind === 'preskip' ? 'Preskip' : 'Postskip'} tests '${rule.fieldname}' against ${rule.response}, which ${known.source} never holds (${describeCodes(known.codes)}).`,
      hint: alwaysFires
        ? 'The rule can only ever fire.'
        : 'The rule can only ever stay silent.',
    });
  });

  return findings;
}

function csvColumnFindings(q: SurveyQuestion, index: number, csvFiles: readonly CsvFile[]): Finding[] {
  const dr = q.dynamicResponses;
  if (!dr || dr.source !== 'csv' || !dr.file || resolvedResponseMode(q) !== 'dynamic') return [];
  const file = csvFiles.find((f) => f.filename === dr.file);
  if (!file) return []; // responses.ts reports the missing upload
  const header = parseCsvHeaderRow(file.content);
  // No header means the content was not loaded (a file registered by name
  // only), not that every column is absent.
  if (header.length === 0) return [];
  const wanted = [...(dr.filters ?? []).map((f) => f.column), dr.displayColumn, dr.valueColumn].filter(Boolean);
  const missing = [...new Set(wanted.filter((c) => !header.includes(c)))];
  if (missing.length === 0) return [];
  return [
    {
      scope: 'question',
      questionId: q.id,
      questionIndex: index,
      fieldname: q.fieldname,
      part: 'dynamicResponses',
      ruleId: RULE.dynamicCsvColumnMissing,
      severity: 'error',
      subject: missing.join(', '),
      message: `'${q.fieldname}' reads column${missing.length > 1 ? 's' : ''} ${missing.map((c) => `'${c}'`).join(', ')} from ${dr.file}, which has no such column (its header is ${header.join(', ')}).`,
      hint: 'A filter on a missing column matches nothing, so the list is always empty.',
    },
  ];
}

export function semanticsFindings(form: SurveyForm, csvFiles: readonly CsvFile[] = []): Finding[] {
  const findings: Finding[] = [];

  form.questions.forEach((q, index) => {
    findings.push(...logicCheckFindings(form, q, index, csvFiles));
    findings.push(...skipValueFindings(form, q, index, 'preskip', q.preskip ?? [], csvFiles));
    findings.push(...skipValueFindings(form, q, index, 'postskip', q.postskip ?? [], csvFiles));
    findings.push(...csvColumnFindings(q, index, csvFiles));
  });

  return findings.map((f) => ({ ...f, formId: form.id, tablename: form.tablename }));
}
