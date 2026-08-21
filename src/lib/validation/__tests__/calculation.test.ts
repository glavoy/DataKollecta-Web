import { describe, it, expect } from 'vitest';
import { CALC_REQUIRED, calculationFindings } from '../rules/calculation';
import { CALC_SPEC } from '@/lib/xml/calculation';
import { RULE } from '../types';
import type { CalculationConfig, SurveyForm, SurveyQuestion } from '@/types/survey';

const q = (fieldname: string, overrides: Partial<SurveyQuestion> = {}): SurveyQuestion => ({
  id: fieldname,
  type: 'calculated',
  fieldname,
  fieldtype: 'text',
  text: '',
  ...overrides,
});

const formOf = (questions: SurveyQuestion[], extra: Partial<SurveyForm> = {}): SurveyForm => ({
  id: 'f1',
  tablename: 'form1',
  displayname: 'Form 1',
  displayOrder: 10,
  autoStartRepeat: 0,
  repeatEnforceCount: 0,
  questions,
  ...extra,
});

describe('CALC_REQUIRED / CALC_SPEC parity', () => {
  it('covers exactly the same calculation types as the generator, so adding one forces a validation decision', () => {
    expect(Object.keys(CALC_REQUIRED).sort()).toEqual(Object.keys(CALC_SPEC).sort());
  });
});

describe('missing calculation', () => {
  it('errors on a calculated question with no calculation', () => {
    const findings = calculationFindings(formOf([q('total')]));
    expect(findings).toEqual([expect.objectContaining({ ruleId: RULE.calcMissing })]);
  });

  it('exempts a declared Computed Automatic Variable', () => {
    const findings = calculationFindings(formOf([q('doy')]));
    expect(findings.filter((f) => f.ruleId === RULE.calcMissing)).toEqual([]);
  });

  it("exempts a field supplied by this form's manifest configuration (e.g. the primary key)", () => {
    const findings = calculationFindings(formOf([q('subjid')], { primaryKey: 'subjid' }));
    expect(findings.filter((f) => f.ruleId === RULE.calcMissing)).toEqual([]);
  });

  it('does not apply to a non-calculated question', () => {
    const findings = calculationFindings(formOf([{ ...q('a'), type: 'text' }]));
    expect(findings.filter((f) => f.ruleId === RULE.calcMissing)).toEqual([]);
  });
});

describe('required operands, one per calculation type', () => {
  const cases: Array<[CalculationConfig, string[]]> = [
    [{ type: 'constant' }, ['value']],
    [{ type: 'lookup' }, ['field']],
    [{ type: 'query' }, ['sql']],
    [{ type: 'math' }, ['operator']],
    [{ type: 'age_from_date' }, ['field', 'value']],
    [{ type: 'age_at_date', field: 'dob', value: 'years' }, ['separator']],
    [{ type: 'date_offset' }, ['field', 'value']],
    [{ type: 'date_diff' }, ['field', 'value', 'unit']],
    [{ type: 'date_part' }, ['field', 'unit']],
  ];

  it.each(cases)('%s reports each missing operand', (calc, expectedKeys) => {
    const findings = calculationFindings(formOf([q('a', { calculation: calc })]));
    const missing = findings.filter((f) => f.ruleId === RULE.calcOperandMissing);
    expect(missing.length).toBeGreaterThanOrEqual(expectedKeys.length);
    for (const key of expectedKeys) {
      expect(missing.some((f) => f.message.includes(`'${key}'`)), key).toBe(true);
    }
  });

  it('math additionally requires at least 2 parts', () => {
    const findings = calculationFindings(
      formOf([q('a', { calculation: { type: 'math', operator: '+', parts: [{ type: 'constant', value: '1' }] } })]),
    );
    expect(findings).toContainEqual(expect.objectContaining({ ruleId: RULE.calcOperandMissing }));
  });

  it('concat requires at least 1 part', () => {
    const findings = calculationFindings(formOf([q('a', { calculation: { type: 'concat', parts: [] } })]));
    expect(findings).toContainEqual(expect.objectContaining({ ruleId: RULE.calcOperandMissing }));
  });

  it('case requires at least 1 when condition', () => {
    const findings = calculationFindings(formOf([q('a', { calculation: { type: 'case', cases: [] } })]));
    expect(findings).toContainEqual(expect.objectContaining({ ruleId: RULE.calcOperandMissing }));
  });

  it('a fully-specified calculation of every type produces no operand findings', () => {
    const complete: CalculationConfig[] = [
      { type: 'constant', value: '1' },
      { type: 'lookup', field: 'x' },
      { type: 'query', sql: 'SELECT 1' },
      { type: 'math', operator: '+', parts: [{ type: 'constant', value: '1' }, { type: 'constant', value: '2' }] },
      { type: 'concat', parts: [{ type: 'constant', value: 'x' }] },
      {
        type: 'case',
        cases: [{ id: 'c0', field: 'x', operator: '=', value: '1', result: { type: 'constant', value: 'y' } }],
      },
      { type: 'age_from_date', field: 'dob', value: 'years' },
      { type: 'age_at_date', field: 'dob', value: 'years', separator: '[[startdate]]' },
      { type: 'date_offset', field: 'x', value: '+7d' },
      { type: 'date_diff', field: 'x', value: 'today', unit: 'd' },
      { type: 'date_part', field: 'x', unit: 'yyyy' },
    ];
    const findings = calculationFindings(formOf(complete.map((c, i) => q(`f${i}`, { calculation: c }))));
    expect(findings.filter((f) => f.ruleId === RULE.calcOperandMissing)).toEqual([]);
  });
});

describe('unit and offset format', () => {
  it('rejects an invalid age_at_date unit word', () => {
    const findings = calculationFindings(
      formOf([q('a', { calculation: { type: 'age_at_date', field: 'dob', value: 'decades', separator: '0' } })]),
    );
    expect(findings).toContainEqual(
      expect.objectContaining({ ruleId: RULE.calcUnitInvalid, subject: 'decades' }),
    );
  });

  it('rejects an invalid date_diff unit', () => {
    const findings = calculationFindings(
      formOf([q('a', { calculation: { type: 'date_diff', field: 'x', value: 'today', unit: 'z' as never } })]),
    );
    expect(findings).toContainEqual(expect.objectContaining({ ruleId: RULE.calcUnitInvalid, subject: 'z' }));
  });

  it('rejects a malformed date_offset value', () => {
    const findings = calculationFindings(
      formOf([q('a', { calculation: { type: 'date_offset', field: 'x', value: 'next week' } })]),
    );
    expect(findings).toContainEqual(
      expect.objectContaining({ ruleId: RULE.calcOffsetFormat, subject: 'next week' }),
    );
  });

  it('accepts a valid offset', () => {
    const findings = calculationFindings(
      formOf([q('a', { calculation: { type: 'date_offset', field: 'x', value: '+28d' } })]),
    );
    expect(findings.filter((f) => f.ruleId === RULE.calcOffsetFormat)).toEqual([]);
  });
});

describe('nested parts and cases are checked against their own type', () => {
  it('reports a missing operand inside a nested math part, with the nested path', () => {
    const calc: CalculationConfig = {
      type: 'math',
      operator: '+',
      parts: [{ type: 'constant', value: '1' }, { type: 'lookup' /* missing field */ }],
    };
    const findings = calculationFindings(formOf([q('a', { calculation: calc })]));
    expect(findings).toContainEqual(
      expect.objectContaining({ ruleId: RULE.calcOperandMissing, path: 'parts[1].' }),
    );
  });

  it('reports a missing operand inside a case result', () => {
    const calc: CalculationConfig = {
      type: 'case',
      cases: [{ id: 'c0', field: 'x', operator: '=', value: '1', result: { type: 'lookup' } }],
    };
    const findings = calculationFindings(formOf([q('a', { calculation: calc })]));
    expect(findings).toContainEqual(
      expect.objectContaining({ ruleId: RULE.calcOperandMissing, path: 'cases[0].result.' }),
    );
  });
});
