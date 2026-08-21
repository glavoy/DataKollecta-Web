/**
 * Fieldname legality, uniqueness, question text, and mask placement.
 *
 * Ported from `_check_field_name` / `_check_duplicate_columns` in
 * `excel_reader.py`. The charset SurveyGen actually enforces is Unicode-aware
 * (Python's `str.isalnum()`), but the reference-extraction regex this engine
 * uses (`refs.ts`'s `FIELD_NAME_RE`) is ASCII-only -- a Unicode fieldname
 * would be legal to declare but impossible for any rule here to ever find a
 * reference to. Enforcing ASCII keeps "declarable" and "referenceable" the
 * same set, a deliberate, documented divergence rather than an oversight.
 */

import type { SurveyForm, SurveyQuestion } from '@/types/survey';
import { RULE, type Finding } from '../types';
import { isReservedFieldname } from '@/lib/xml/systemFields';

const CHARSET_RE = /^[a-z0-9_]+$/;

/**
 * One finding per bad fieldname, mirroring SurveyGen's own if/elif chain:
 * only the first problem is reported, so fixing it doesn't just surface the
 * next one in a different shape each time.
 */
function fieldnameFindings(q: SurveyQuestion, index: number): Finding[] {
  const base = {
    scope: 'question' as const,
    questionId: q.id,
    questionIndex: index,
    fieldname: q.fieldname,
    part: 'identity' as const,
  };

  const name = q.fieldname?.trim() ?? '';

  if (name === '') {
    return [{ ...base, ruleId: RULE.fieldnameEmpty, severity: 'error', message: 'Field name is blank.' }];
  }
  if (/^\d/.test(name)) {
    return [
      {
        ...base,
        ruleId: RULE.fieldnameLeadingDigit,
        severity: 'error',
        subject: name,
        message: `Field name '${name}' starts with a number.`,
        hint: 'A field name must start with a letter.',
      },
    ];
  }
  if (!CHARSET_RE.test(name)) {
    return [
      {
        ...base,
        ruleId: RULE.fieldnameCharset,
        severity: 'error',
        subject: name,
        message: `Field name '${name}' contains characters other than lowercase letters, digits, and underscores.`,
      },
    ];
  }
  if (name.startsWith('_')) {
    return [
      {
        ...base,
        ruleId: RULE.fieldnameLeadingUnderscore,
        severity: 'error',
        subject: name,
        message: `Field name '${name}' starts with an underscore.`,
      },
    ];
  }
  if (isReservedFieldname(name)) {
    return [
      {
        ...base,
        ruleId: RULE.fieldnameReserved,
        severity: 'error',
        subject: name,
        message: `Field name '${name}' is reserved -- the app writes this value itself.`,
        hint: 'Use a different field name for your own value.',
      },
    ];
  }

  return [];
}

/**
 * Duplicate fieldnames within one form. `information` questions are exempt,
 * matching SurveyGen -- a display-only row reusing a name that also labels a
 * real question is not ambiguous the way two answerable fields with the same
 * name would be.
 */
function duplicateFindings(form: SurveyForm): Finding[] {
  const counts = new Map<string, number[]>(); // lowercased name -> question indices
  form.questions.forEach((q, index) => {
    if (q.type === 'information') return;
    const key = q.fieldname?.trim().toLowerCase();
    if (!key) return;
    const indices = counts.get(key) ?? [];
    indices.push(index);
    counts.set(key, indices);
  });

  const findings: Finding[] = [];
  for (const [key, indices] of counts) {
    if (indices.length < 2) continue;
    for (const index of indices) {
      const q = form.questions[index];
      findings.push({
        scope: 'question',
        questionId: q.id,
        questionIndex: index,
        fieldname: q.fieldname,
        part: 'identity',
        ruleId: RULE.fieldnameDuplicate,
        severity: 'error',
        subject: key,
        message: `Field name '${q.fieldname}' is used by ${indices.length} questions on this form.`,
        hint: 'Every field name must be unique within a form, or the app cannot tell the answers apart.',
      });
    }
  }
  return findings;
}

function textAndMaskFindings(q: SurveyQuestion, index: number): Finding[] {
  const findings: Finding[] = [];
  const base = {
    scope: 'question' as const,
    questionId: q.id,
    questionIndex: index,
    fieldname: q.fieldname,
  };

  if (q.type !== 'calculated' && (!q.text || q.text.trim() === '')) {
    findings.push({
      ...base,
      part: 'text',
      ruleId: RULE.textRequired,
      severity: 'error',
      message: 'Question text is blank.',
      hint: 'Every question shown to a field worker needs text, except a calculated (automatic) one.',
    });
  }

  if (q.mask && q.type !== 'text') {
    findings.push({
      ...base,
      part: 'mask',
      ruleId: RULE.maskOnNonText,
      severity: 'error',
      message: `An input mask is set, but the question type is '${q.type}', not Text.`,
      hint: 'A mask only applies to free-text input.',
    });
  }

  return findings;
}

export function identityFindings(form: SurveyForm): Finding[] {
  const findings: Finding[] = [];

  form.questions.forEach((q, index) => {
    findings.push(...fieldnameFindings(q, index));
    findings.push(...textAndMaskFindings(q, index));
  });
  findings.push(...duplicateFindings(form));

  return findings.map((f) => ({ ...f, formId: form.id, tablename: form.tablename }));
}
