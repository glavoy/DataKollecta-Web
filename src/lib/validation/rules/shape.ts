/**
 * Per-question shape: max length, numeric/date ranges, and the Don't
 * Know / Refuse / N/A special-answer sentinels.
 *
 * Ported from `_check_required_max_characters` / `_check_ranges` /
 * `_check_date_range` in `excel_reader.py`, plus `min > max`, which
 * SurveyGen never checks at all.
 *
 * Deliberately NOT ported: `_check_special_button`'s `True`/`False`
 * requirement. That is the *Excel column* value; the web model stores the
 * value the app actually reads on the wire -- `xml_generator.py` converts
 * `True` to `-7`/`-8`/`-6` before it ever reaches XML, and this designer's
 * `dontKnow`/`refuse`/`na` fields hold that emitted sentinel directly. A
 * literal port would flag every correct survey this designer can produce.
 */

import type { SurveyForm, SurveyQuestion } from '@/types/survey';
import { RULE, type Finding } from '../types';

const OFFSET_RE = /^[+-]\d+[dwmy]$/;
const HARDCODED_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Ported from `_check_question_field_type`: which field types a question
 * type may carry. `combobox`/`information`/`calculated` are unconstrained,
 * matching SurveyGen. The designer's own dropdowns (`getAvailableFieldTypes`)
 * already enforce this at authoring time; this rule is the backstop for
 * legacy or imported data the dropdown never touched.
 *
 * `excel_reader.py`'s current `TYPED_FIELD_TYPES` excludes `integer` from a
 * `text` question -- but the real SurveyGen sample this engine's own tests
 * validate against (`enrollee.xml`, genuine production output) uses
 * `type='text' fieldtype='integer'` more than twenty times (deviceid, age,
 * npeople, ...). Rather than a stale doc read, that's direct evidence the
 * rule as currently written in SurveyGen would reject dictionaries the
 * ecosystem already ships at scale -- possibly a newer, stricter check than
 * whatever generated this sample. The app has no functional dependency on
 * the distinction either (`fieldtype` never drives a SQLite column type),
 * so `integer` is allowed here rather than porting a rule caught blocking a
 * real survey by `clean.test.ts`.
 */
const ALLOWED_FIELD_TYPES: Partial<Record<SurveyQuestion['type'], readonly SurveyQuestion['fieldtype'][]>> = {
  text: ['text', 'text_integer', 'text_decimal', 'hourmin', 'integer'],
  radio: ['integer'],
  checkbox: ['text'],
  date: ['date', 'datetime'],
  datetime: ['date', 'datetime'],
};

function fieldTypeFindings(q: SurveyQuestion, index: number): Finding[] {
  const allowed = ALLOWED_FIELD_TYPES[q.type];
  if (!allowed || allowed.includes(q.fieldtype)) return [];

  return [
    {
      scope: 'question',
      questionId: q.id,
      questionIndex: index,
      fieldname: q.fieldname,
      part: 'identity',
      ruleId: RULE.fieldTypeInvalidForQuestionType,
      severity: 'error',
      subject: q.fieldtype,
      message: `A ${q.type} question cannot use the data type '${q.fieldtype}'.`,
      hint: `Use one of: ${allowed.join(', ')}.`,
    },
  ];
}

/** '0', a signed offset ('+6m', '-1y'), or a real calendar date. */
function isValidDateBound(value: string): boolean {
  const v = value.trim();
  if (v === '0' || v === '+0d' || v === '-0d') return true;
  if (OFFSET_RE.test(v)) return true;
  if (HARDCODED_DATE_RE.test(v)) {
    const d = new Date(v + 'T00:00:00Z');
    // Reject '2025-02-30': Date rolls it into March, so re-formatting must
    // round-trip back to the same string for it to be a real calendar date.
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }
  return false;
}

function widthFindings(q: SurveyQuestion, index: number): Finding[] {
  const findings: Finding[] = [];
  const base = {
    scope: 'question' as const,
    questionId: q.id,
    questionIndex: index,
    fieldname: q.fieldname,
  };

  if (q.type !== 'text') return findings;

  if (q.fieldtype === 'hourmin') {
    if (q.maxCharacters !== 5 || !q.fixedLength) {
      findings.push({
        ...base,
        part: 'maxCharacters',
        ruleId: RULE.maxCharsHourmin,
        severity: 'error',
        message: "Max Characters must be exactly 5 ('=5') when the data type is Hour:Minute.",
        hint: 'A time is always hh:mm.',
      });
    }
    if (q.numericCheck?.minValue !== undefined || q.numericCheck?.maxValue !== undefined) {
      findings.push({
        ...base,
        part: 'numericCheck',
        ruleId: RULE.hourminHasRange,
        severity: 'error',
        message: 'A numeric range is set on an Hour:Minute field.',
        hint: 'Clear the range -- it cannot be applied to a time value.',
      });
    }
    return findings;
  }

  if (['text', 'text_integer', 'text_decimal'].includes(q.fieldtype) && q.maxCharacters === undefined) {
    findings.push({
      ...base,
      part: 'maxCharacters',
      ruleId: RULE.maxCharsRequired,
      severity: 'error',
      message: 'Max Characters is required for a text question.',
    });
  }

  return findings;
}

function numericRangeFindings(q: SurveyQuestion, index: number): Finding[] {
  if (!q.numericCheck || q.fieldtype === 'hourmin') return [];
  const { minValue, maxValue } = q.numericCheck;
  const hasMin = minValue !== undefined;
  const hasMax = maxValue !== undefined;
  if (!hasMin && !hasMax) return [];

  const base = {
    scope: 'question' as const,
    questionId: q.id,
    questionIndex: index,
    fieldname: q.fieldname,
    part: 'numericCheck' as const,
  };

  if (hasMin !== hasMax) {
    const missing = hasMin ? 'a maximum' : 'a minimum';
    return [
      {
        ...base,
        ruleId: RULE.numericRangeHalfSet,
        severity: 'error',
        message: `Only ${hasMin ? 'a minimum' : 'a maximum'} is set for this range.`,
        hint: `Set ${missing} too, or clear both -- a half-set range rejects every answer.`,
      },
    ];
  }

  if (hasMin && hasMax && minValue! > maxValue!) {
    return [
      {
        ...base,
        ruleId: RULE.numericRangeInverted,
        severity: 'error',
        message: `The minimum (${minValue}) is greater than the maximum (${maxValue}).`,
      },
    ];
  }

  return [];
}

function dateRangeFindings(q: SurveyQuestion, index: number): Finding[] {
  if (q.type !== 'date' && q.type !== 'datetime') return [];

  const findings: Finding[] = [];
  const base = {
    scope: 'question' as const,
    questionId: q.id,
    questionIndex: index,
    fieldname: q.fieldname,
    part: 'dateRange' as const,
  };

  const min = q.dateRange?.minDate;
  const max = q.dateRange?.maxDate;

  if (!min || !max) {
    findings.push({
      ...base,
      ruleId: RULE.dateRangeMissing,
      severity: 'error',
      message: `${!min && !max ? 'Both a minimum and a maximum date are' : !min ? 'A minimum date is' : 'A maximum date is'} required for a date question.`,
    });
    return findings;
  }

  for (const [label, value] of [
    ['minimum', min],
    ['maximum', max],
  ] as const) {
    if (!isValidDateBound(value)) {
      findings.push({
        ...base,
        ruleId: RULE.dateRangeFormat,
        severity: 'error',
        subject: value,
        message: `The ${label} date '${value}' is not a valid value.`,
        hint: "Use '0' for today, a signed offset like '-1y' or '+6m', or a real date like '2025-03-31'.",
      });
    }
  }

  return findings;
}

const CONVENTIONAL_SPECIAL_VALUES: Record<'dontKnow' | 'refuse' | 'na', string> = {
  dontKnow: '-7',
  refuse: '-8',
  na: '-6',
};

/**
 * `dontKnow`/`refuse`/`na` collide with a static response option value, or
 * simply aren't one of the app's conventional sentinels. Both warning-only:
 * neither breaks anything mechanically, but a collision means the special
 * answer is indistinguishable from a real one, and an unconventional value
 * is very likely a typo rather than a deliberate choice.
 */
function specialAnswerFindings(q: SurveyQuestion, index: number): Finding[] {
  const findings: Finding[] = [];
  const optionValues = new Set((q.responses ?? []).map((r) => r.value));

  const base = {
    scope: 'question' as const,
    questionId: q.id,
    questionIndex: index,
    fieldname: q.fieldname,
    part: 'specialAnswers' as const,
  };

  (['dontKnow', 'refuse', 'na'] as const).forEach((key) => {
    const value = q[key];
    if (!value) return;

    if (optionValues.has(value)) {
      findings.push({
        ...base,
        ruleId: RULE.specialAnswerCollides,
        severity: 'warning',
        subject: value,
        message: `The ${key} value '${value}' is the same as one of this question's response options.`,
        hint: 'The special answer would be indistinguishable from a real one.',
      });
      return;
    }

    if (value !== CONVENTIONAL_SPECIAL_VALUES[key]) {
      findings.push({
        ...base,
        ruleId: RULE.specialAnswerUnconventional,
        severity: 'warning',
        subject: value,
        message: `The ${key} value '${value}' is not the conventional '${CONVENTIONAL_SPECIAL_VALUES[key]}'.`,
      });
    }
  });

  return findings;
}

export function shapeFindings(form: SurveyForm): Finding[] {
  const findings: Finding[] = [];

  form.questions.forEach((q, index) => {
    findings.push(...fieldTypeFindings(q, index));
    findings.push(...widthFindings(q, index));
    findings.push(...numericRangeFindings(q, index));
    findings.push(...dateRangeFindings(q, index));
    findings.push(...specialAnswerFindings(q, index));
  });

  return findings.map((f) => ({ ...f, formId: form.id, tablename: form.tablename }));
}
