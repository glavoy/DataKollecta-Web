/**
 * Calculation existence and required operands.
 *
 * Ported from `_check_automatic_has_calculation` (a `calculated` question
 * with nothing to compute it) and `_validate_calculation_fields` (the
 * required-operand matrix, one branch per `CalculationType`) in
 * `excel_reader.py`.
 *
 * `CALC_REQUIRED` deliberately mirrors `CALC_SPEC` (`lib/xml/calculation.ts`)
 * rather than restating calculation knowledge independently -- see the
 * parity test in `__tests__/calculation.test.ts`, which asserts the two
 * tables cover exactly the same set of types. Adding a calculation type to
 * the generator without adding it here fails that test, which is the point:
 * it forces a validation decision rather than letting one be forgotten.
 */

import type { CalculationConfig, SurveyForm, SurveyQuestion } from '@/types/survey';
import { RULE, type Finding } from '../types';
import { CALC_SPEC } from '@/lib/xml/calculation';
import { isKnownAutomaticFieldname } from '@/lib/xml/systemFields';
import { buildFormScope, type FormScope } from '../scope';

const OFFSET_RE = /^[+-]\d+[dwmy]$/;

interface CalcRequirement {
  field?: boolean;
  /** `value` must be present. */
  value?: boolean;
  /** `value` must additionally be one of `CALC_SPEC[type].units` (age_at_date/age_from_date store their unit word in `value`, not `unit`). */
  valueIsUnit?: boolean;
  /** `value` must match a date-offset expression like '+28d'. */
  valueIsOffset?: boolean;
  separator?: boolean;
  operator?: boolean;
  /** The `unit` attribute must be present. */
  unit?: boolean;
  /** `unit` must be one of `CALC_SPEC[type].units`. */
  unitIsValid?: boolean;
  minParts?: number;
  minCases?: number;
  sql?: boolean;
}

export const CALC_REQUIRED: Record<CalculationConfig['type'], CalcRequirement> = {
  constant: { value: true },
  lookup: { field: true },
  query: { sql: true },
  math: { operator: true, minParts: 2 },
  concat: { minParts: 1 },
  case: { minCases: 1 },
  age_at_date: { field: true, value: true, valueIsUnit: true, separator: true },
  age_from_date: { field: true, value: true, valueIsUnit: true },
  date_offset: { field: true, value: true, valueIsOffset: true },
  date_diff: { field: true, value: true, unit: true, unitIsValid: true },
  date_part: { field: true, unit: true, unitIsValid: true },
};

type CalcBase = {
  scope: 'question';
  questionId: string;
  questionIndex: number;
  fieldname: string;
  part: 'calculation';
  path?: string;
};

function operandMissing(base: CalcBase, key: string, type: string): Finding {
  return {
    ...base,
    ruleId: RULE.calcOperandMissing,
    severity: 'error',
    message: `A '${type}' calculation is missing '${key}'.`,
  };
}

/** Walks a calculation and any nested parts/cases/defaultResult, each checked against its own type's requirements. */
function operandFindings(calc: CalculationConfig, base: Omit<CalcBase, 'path'>, path = ''): Finding[] {
  const findings: Finding[] = [];
  const req = CALC_REQUIRED[calc.type];
  const spec = CALC_SPEC[calc.type];
  const here: CalcBase = { ...base, path: path || undefined };

  if (req.field && !calc.field) findings.push(operandMissing(here, 'field', calc.type));
  if (req.sql && !calc.sql) findings.push(operandMissing(here, 'sql', calc.type));
  if (req.value && !calc.value) findings.push(operandMissing(here, 'value', calc.type));
  if (req.separator && !calc.separator) findings.push(operandMissing(here, 'separator', calc.type));
  if (req.operator && !calc.operator) findings.push(operandMissing(here, 'operator', calc.type));
  if (req.unit && !calc.unit) findings.push(operandMissing(here, 'unit', calc.type));

  if (req.valueIsUnit && calc.value && spec.units && !spec.units.includes(calc.value)) {
    findings.push({
      ...here,
      ruleId: RULE.calcUnitInvalid,
      severity: 'error',
      subject: calc.value,
      message: `'${calc.value}' is not a valid unit for ${calc.type}. Must be one of: ${spec.units.join(', ')}.`,
    });
  }
  if (req.unitIsValid && calc.unit && spec.units && !spec.units.includes(calc.unit)) {
    findings.push({
      ...here,
      ruleId: RULE.calcUnitInvalid,
      severity: 'error',
      subject: calc.unit,
      message: `'${calc.unit}' is not a valid unit for ${calc.type}. Must be one of: ${spec.units.join(', ')}.`,
    });
  }
  if (req.valueIsOffset && calc.value && !OFFSET_RE.test(calc.value)) {
    findings.push({
      ...here,
      ruleId: RULE.calcOffsetFormat,
      severity: 'error',
      subject: calc.value,
      message: `'${calc.value}' is not a valid offset.`,
      hint: "Expected a format like '+28d' or '-1y'.",
    });
  }
  if (req.minParts !== undefined && (calc.parts?.length ?? 0) < req.minParts) {
    findings.push({
      ...here,
      ruleId: RULE.calcOperandMissing,
      severity: 'error',
      message: `A '${calc.type}' calculation needs at least ${req.minParts} part${req.minParts === 1 ? '' : 's'}.`,
    });
  }
  if (req.minCases !== undefined && (calc.cases?.length ?? 0) < req.minCases) {
    findings.push({
      ...here,
      ruleId: RULE.calcOperandMissing,
      severity: 'error',
      message: "A 'case' calculation needs at least one condition.",
    });
  }

  (calc.parts ?? []).forEach((p, i) => {
    findings.push(...operandFindings(p, base, `${path}parts[${i}].`));
  });
  (calc.cases ?? []).forEach((k, i) => {
    findings.push(...operandFindings(k.result, base, `${path}cases[${i}].result.`));
  });
  if (calc.defaultResult) {
    findings.push(...operandFindings(calc.defaultResult, base, `${path}defaultResult.`));
  }

  return findings;
}

function missingCalculationFinding(
  scope: FormScope,
  q: SurveyQuestion,
  index: number,
): Finding | undefined {
  if (q.type !== 'calculated' || q.calculation) return undefined;

  const name = q.fieldname?.trim().toLowerCase() ?? '';
  if (isKnownAutomaticFieldname(name) || scope.suppliedAutoFields.has(name)) return undefined;

  return {
    scope: 'question',
    questionId: q.id,
    questionIndex: index,
    fieldname: q.fieldname,
    part: 'calculation',
    ruleId: RULE.calcMissing,
    severity: 'error',
    message: `'${q.fieldname}' is a Calculated question with no calculation, so it is never given a value.`,
    hint: "Add a calculation, or remove the field. (Fields named for a Computed Automatic Variable, or already supplied by this form's ID/linking configuration, are exempt.)",
  };
}

export function calculationFindings(form: SurveyForm): Finding[] {
  const scope = buildFormScope(form);
  const findings: Finding[] = [];

  form.questions.forEach((q, index) => {
    const missing = missingCalculationFinding(scope, q, index);
    if (missing) {
      findings.push(missing);
      return;
    }
    if (q.calculation) {
      findings.push(
        ...operandFindings(q.calculation, {
          scope: 'question',
          questionId: q.id,
          questionIndex: index,
          fieldname: q.fieldname,
          part: 'calculation',
        }),
      );
    }
  });

  return findings.map((f) => ({ ...f, formId: form.id, tablename: form.tablename }));
}
