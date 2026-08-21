/**
 * Response options -- static lists and dynamic (CSV/database-backed) lists.
 *
 * Ported from `_check_responses_are_answerable` (a selection question with
 * no options) and the duplicate-value check inside the static-response
 * parser in `excel_reader.py`. The CSV-file-exists check has no SurveyGen
 * equivalent at all -- Excel just names a file on disk, so there's nothing
 * to cross-check against; the designer's uploaded-files list makes that
 * check possible for the first time.
 */

import type { SurveyForm, SurveyQuestion } from '@/types/survey';
import { RULE, type Finding } from '../types';
import { resolvedResponseMode } from '@/lib/xml/question';

const SELECTION_TYPES = new Set(['radio', 'checkbox', 'combobox']);

function staticResponseFindings(q: SurveyQuestion, index: number): Finding[] {
  const findings: Finding[] = [];
  const base = {
    scope: 'question' as const,
    questionId: q.id,
    questionIndex: index,
    fieldname: q.fieldname,
    part: 'responses' as const,
  };

  const options = q.responses ?? [];

  if (options.length === 0) {
    findings.push({
      ...base,
      ruleId: RULE.selectionNoOptions,
      severity: 'error',
      message: `'${q.fieldname}' is a ${q.type} question with no response options, so it cannot be answered.`,
      hint: 'Add response options, or switch to a dynamic (CSV/database) source.',
    });
    return findings;
  }

  const seen = new Map<string, number>(); // value -> first index
  options.forEach((opt, i) => {
    if (seen.has(opt.value)) {
      findings.push({
        ...base,
        partIndex: i,
        ruleId: RULE.optionValueDuplicate,
        severity: 'error',
        subject: opt.value,
        message: `Response option value '${opt.value}' is used more than once.`,
      });
    } else {
      seen.set(opt.value, i);
    }

    if (!opt.label || opt.label.trim() === '') {
      findings.push({
        ...base,
        partIndex: i,
        ruleId: RULE.optionLabelBlank,
        severity: 'error',
        subject: opt.value,
        message: `Response option '${opt.value}' has a blank label.`,
        hint: 'The field worker would see nothing for this choice.',
      });
    }
  });

  return findings;
}

function dynamicResponseFindings(
  q: SurveyQuestion,
  index: number,
  csvFilenames: ReadonlySet<string>,
): Finding[] {
  const dr = q.dynamicResponses;
  if (!dr) return [];

  const findings: Finding[] = [];
  const base = {
    scope: 'question' as const,
    questionId: q.id,
    questionIndex: index,
    fieldname: q.fieldname,
    part: 'dynamicResponses' as const,
  };

  if (dr.source === 'csv' && !dr.file) {
    findings.push({
      ...base,
      ruleId: RULE.dynamicCsvNoFile,
      severity: 'error',
      message: 'A CSV-backed response list has no file selected.',
    });
  }
  if (dr.source === 'database' && !dr.table) {
    findings.push({
      ...base,
      ruleId: RULE.dynamicDbNoTable,
      severity: 'error',
      message: 'A database-backed response list has no table selected.',
    });
  }
  if (!dr.displayColumn || !dr.valueColumn) {
    findings.push({
      ...base,
      ruleId: RULE.dynamicNoColumns,
      severity: 'error',
      message: `${!dr.displayColumn && !dr.valueColumn ? 'A display column and a value column are' : !dr.displayColumn ? 'A display column is' : 'A value column is'} required.`,
    });
  }
  if (dr.source === 'csv' && dr.file && !csvFilenames.has(dr.file)) {
    findings.push({
      ...base,
      ruleId: RULE.dynamicCsvMissing,
      severity: 'error',
      subject: dr.file,
      message: `The CSV file '${dr.file}' is not among the files uploaded to this survey.`,
      hint: 'Upload it in Survey Settings, or choose a different file.',
    });
  }

  return findings;
}

export function responsesFindings(form: SurveyForm, csvFilenames: ReadonlySet<string>): Finding[] {
  const findings: Finding[] = [];

  form.questions.forEach((q, index) => {
    if (!SELECTION_TYPES.has(q.type)) return;

    const mode = resolvedResponseMode(q);
    if (mode === 'dynamic') {
      findings.push(...dynamicResponseFindings(q, index, csvFilenames));
    } else {
      findings.push(...staticResponseFindings(q, index));
    }
  });

  return findings.map((f) => ({ ...f, formId: form.id, tablename: form.tablename }));
}
