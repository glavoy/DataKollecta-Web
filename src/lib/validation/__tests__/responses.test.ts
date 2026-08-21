import { describe, it, expect } from 'vitest';
import { responsesFindings } from '../rules/responses';
import { RULE } from '../types';
import type { SurveyForm, SurveyQuestion } from '@/types/survey';

const q = (fieldname: string, overrides: Partial<SurveyQuestion> = {}): SurveyQuestion => ({
  id: fieldname,
  type: 'radio',
  fieldname,
  fieldtype: 'integer',
  text: 'Q',
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

const noCsvs = new Set<string>();

describe('static responses', () => {
  it('errors on a selection question with no options', () => {
    const findings = responsesFindings(formOf([q('a')]), noCsvs);
    expect(findings).toEqual([expect.objectContaining({ ruleId: RULE.selectionNoOptions })]);
  });

  it('is silent with valid options', () => {
    const findings = responsesFindings(
      formOf([q('a', { responses: [{ id: 'r1', value: '1', label: 'Yes' }, { id: 'r2', value: '2', label: 'No' }] })]),
      noCsvs,
    );
    expect(findings).toEqual([]);
  });

  it('flags a duplicate option value', () => {
    const findings = responsesFindings(
      formOf([
        q('a', {
          responses: [
            { id: 'r1', value: '1', label: 'Yes' },
            { id: 'r2', value: '1', label: 'Also yes' },
          ],
        }),
      ]),
      noCsvs,
    );
    expect(findings).toEqual([
      expect.objectContaining({ ruleId: RULE.optionValueDuplicate, subject: '1' }),
    ]);
  });

  it('flags a blank option label', () => {
    const findings = responsesFindings(
      formOf([q('a', { responses: [{ id: 'r1', value: '1', label: '' }] })]),
      noCsvs,
    );
    expect(findings).toEqual([
      expect.objectContaining({ ruleId: RULE.optionLabelBlank, subject: '1' }),
    ]);
  });

  it('does not apply to non-selection question types', () => {
    const findings = responsesFindings(formOf([{ ...q('a'), type: 'text' }]), noCsvs);
    expect(findings).toEqual([]);
  });
});

describe('dynamic responses', () => {
  const dyn = (overrides: Partial<SurveyQuestion['dynamicResponses']> = {}): SurveyQuestion =>
    q('village', {
      type: 'combobox',
      responseMode: 'dynamic',
      dynamicResponses: {
        source: 'csv',
        file: 'villages.csv',
        displayColumn: 'name',
        valueColumn: 'id',
        filters: [],
        ...overrides,
      },
    });

  it('is silent with a complete, uploaded csv config', () => {
    const findings = responsesFindings(formOf([dyn()]), new Set(['villages.csv']));
    expect(findings).toEqual([]);
  });

  it('errors when a csv source has no file', () => {
    const findings = responsesFindings(formOf([dyn({ file: undefined })]), noCsvs);
    expect(findings).toContainEqual(expect.objectContaining({ ruleId: RULE.dynamicCsvNoFile }));
  });

  it('errors when a database source has no table', () => {
    const findings = responsesFindings(
      formOf([dyn({ source: 'database', file: undefined, table: undefined })]),
      noCsvs,
    );
    expect(findings).toContainEqual(expect.objectContaining({ ruleId: RULE.dynamicDbNoTable }));
  });

  it('errors when display or value columns are missing', () => {
    const findings = responsesFindings(formOf([dyn({ displayColumn: '', valueColumn: '' })]), new Set(['villages.csv']));
    expect(findings).toContainEqual(expect.objectContaining({ ruleId: RULE.dynamicNoColumns }));
  });

  it("errors when the named CSV was never uploaded to this survey -- no SurveyGen equivalent, since Excel just names a file on disk", () => {
    const findings = responsesFindings(formOf([dyn()]), new Set(['other.csv']));
    expect(findings).toContainEqual(
      expect.objectContaining({ ruleId: RULE.dynamicCsvMissing, subject: 'villages.csv' }),
    );
  });

  it('a static-only question is not treated as dynamic just because responseMode is unset and dynamicResponses is absent', () => {
    const findings = responsesFindings(
      formOf([q('a', { responses: [{ id: 'r1', value: '1', label: 'Yes' }] })]),
      noCsvs,
    );
    expect(findings).toEqual([]);
  });
});
