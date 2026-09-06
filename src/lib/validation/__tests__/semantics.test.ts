import { describe, it, expect } from 'vitest';
import { semanticsFindings, sameCode } from '../rules/semantics';
import { RULE } from '../types';
import type { CsvFile, SkipRule, SurveyForm, SurveyQuestion } from '@/types/survey';

const q = (fieldname: string, overrides: Partial<SurveyQuestion> = {}): SurveyQuestion => ({
  id: fieldname,
  type: 'text',
  fieldname,
  fieldtype: 'text',
  text: 'Q',
  maxCharacters: 10,
  ...overrides,
});

const radio = (fieldname: string, values: string[], overrides: Partial<SurveyQuestion> = {}): SurveyQuestion =>
  q(fieldname, {
    type: 'radio',
    fieldtype: 'integer',
    responses: values.map((v) => ({ id: `${fieldname}-${v}`, value: v, label: v })),
    ...overrides,
  });

const skip = (fieldname: string, response: string, overrides: Partial<SkipRule> = {}): SkipRule => ({
  id: `${fieldname}-${response}`,
  fieldname,
  condition: '=',
  response,
  skipToFieldname: 'after',
  ...overrides,
});

const formOf = (questions: SurveyQuestion[]): SurveyForm => ({
  id: 'f1',
  tablename: 'form1',
  displayname: 'Form 1',
  displayOrder: 10,
  autoStartRepeat: 0,
  repeatEnforceCount: 0,
  questions,
});

const villages: CsvFile = {
  id: 'c1',
  filename: 'villages.csv',
  content: 'region,vcode,villagename\n1,11,Alpha\n1,12,Beta\n2,21,Gamma\n',
};

const csvQuestion = (fieldname: string, overrides: Partial<SurveyQuestion['dynamicResponses']> = {}): SurveyQuestion =>
  q(fieldname, {
    type: 'radio',
    fieldtype: 'integer',
    responseMode: 'dynamic',
    dynamicResponses: {
      source: 'csv',
      file: 'villages.csv',
      displayColumn: 'villagename',
      valueColumn: 'vcode',
      filters: [{ column: 'region', operator: '=', value: '[[region]]' }],
      ...overrides,
    },
  });

describe('sameCode', () => {
  it('compares numerically when both sides parse, so a padded code matches', () => {
    expect(sameCode('01', '1')).toBe(true);
    expect(sameCode('96', '96.0')).toBe(true);
    expect(sameCode('a', 'a')).toBe(true);
    expect(sameCode('a', 'b')).toBe(false);
  });
});

describe('logic-check operators', () => {
  it('reports an operator the app does not know', () => {
    // The app tokenizes any run of <>=! as an operator and compares as
    // false on one it does not know: the check parses and never fires.
    const findings = semanticsFindings(
      formOf([q('age', { logicCheck: [{ condition: 'age >> 18', message: 'm' }] })]),
    );
    expect(findings).toEqual([
      expect.objectContaining({ ruleId: RULE.logicUnknownOperator, subject: '>>', partIndex: 0 }),
    ]);
  });

  it('accepts every operator the app knows', () => {
    for (const op of ['=', '!=', '<>', '<', '>', '<=', '>=']) {
      const findings = semanticsFindings(
        formOf([q('age', { logicCheck: [{ condition: `age ${op} 18`, message: 'm' }] })]),
      );
      expect(findings, op).toEqual([]);
    }
  });

  it('does not read an operator inside a quoted literal', () => {
    const findings = semanticsFindings(
      formOf([q('note', { logicCheck: [{ condition: "note = 'a >> b'", message: 'm' }] })]),
    );
    expect(findings).toEqual([]);
  });
});

describe('logic-check literals', () => {
  it('reports a literal that is not one of the compared field\'s codes', () => {
    const findings = semanticsFindings(
      formOf([radio('sex', ['1', '2']), q('name', { logicCheck: [{ condition: 'sex = 3', message: 'Men only' }] })]),
    );
    expect(findings).toEqual([
      expect.objectContaining({ ruleId: RULE.logicLiteralNotACode, subject: '3', fieldname: 'name' }),
    ]);
    expect(findings[0].message).toContain('1, 2');
  });

  it('is silent for a real code, a padded code, and a Don\'t-know sentinel', () => {
    const findings = semanticsFindings(
      formOf([
        radio('sex', ['01', '02'], { dontKnow: '-7' }),
        q('name', { logicCheck: [{ condition: "sex = 2 and (sex = -7 or name <> 'x')", message: 'm' }] }),
      ]),
    );
    expect(findings).toEqual([]);
  });

  it('leaves a field whose codes are unknowable alone', () => {
    const findings = semanticsFindings(
      formOf([q('age', { fieldtype: 'text_integer' }), q('name', { logicCheck: [{ condition: 'age = 200', message: 'm' }] })]),
    );
    expect(findings).toEqual([]);
  });
});

describe('skip values', () => {
  it('reports a skip on a static list value the list does not have', () => {
    const findings = semanticsFindings(
      formOf([radio('sex', ['1', '2']), q('preg', { preskip: [skip('sex', '3')] }), q('after')]),
    );
    expect(findings).toEqual([
      expect.objectContaining({ ruleId: RULE.skipValueNotACode, subject: '3', part: 'preskip', partIndex: 0 }),
    ]);
    expect(findings[0].hint).toContain('stay silent');
  });

  it('says a <> rule on a missing code can only ever fire', () => {
    const findings = semanticsFindings(
      formOf([
        q('symptoms', {
          type: 'checkbox',
          fieldtype: 'text',
          responses: ['1', '2', '96'].map((v) => ({ id: v, value: v, label: v })),
        }),
        q('other', { preskip: [skip('symptoms', '99', { condition: 'does not contain' })] }),
        q('after'),
      ]),
    );
    expect(findings).toEqual([expect.objectContaining({ ruleId: RULE.skipValueNotACode, subject: '99' })]);
    expect(findings[0].hint).toContain('only ever fire');
  });

  it('checks a csv-backed field against the uploaded file\'s value column', () => {
    const form = formOf([
      radio('region', ['1', '2']),
      csvQuestion('village'),
      q('place', { preskip: [skip('village', '999')] }),
      q('after'),
    ]);
    const findings = semanticsFindings(form, [villages]);
    expect(findings).toEqual([expect.objectContaining({ ruleId: RULE.skipValueNotACode, subject: '999' })]);
    expect(findings[0].message).toContain('villages.csv (vcode)');
  });

  it('counts a declared not-in-list value as a code', () => {
    const form = formOf([
      radio('region', ['1', '2']),
      csvQuestion('village', { notInList: { value: '999', label: 'Not listed' } }),
      q('place', { preskip: [skip('village', '999')] }),
      q('after'),
    ]);
    expect(semanticsFindings(form, [villages])).toEqual([]);
  });

  it('ignores ordering operators, dynamic comparisons, and a value the csv holds', () => {
    const form = formOf([
      radio('region', ['1', '2']),
      csvQuestion('village'),
      q('place', {
        preskip: [
          skip('village', '21'),
          skip('village', '5', { condition: '>' }),
          skip('village', 'region', { response_type: 'dynamic' }),
        ],
      }),
      q('after'),
    ]);
    expect(semanticsFindings(form, [villages])).toEqual([]);
  });
});

describe('csv columns', () => {
  it('reports a filter, display or value column the file does not have', () => {
    const form = formOf([
      radio('region', ['1', '2']),
      csvQuestion('village', { filters: [{ column: 'regoin', operator: '=', value: '[[region]]' }] }),
    ]);
    const findings = semanticsFindings(form, [villages]);
    expect(findings).toEqual([
      expect.objectContaining({ ruleId: RULE.dynamicCsvColumnMissing, subject: 'regoin', part: 'dynamicResponses' }),
    ]);
    expect(findings[0].message).toContain('region, vcode, villagename');
  });

  it('is silent when every column is present, and when the file is not uploaded (reported elsewhere)', () => {
    const form = formOf([radio('region', ['1', '2']), csvQuestion('village')]);
    expect(semanticsFindings(form, [villages])).toEqual([]);
    expect(semanticsFindings(form, [])).toEqual([]);
  });
});
