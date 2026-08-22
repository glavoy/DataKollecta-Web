import { describe, it, expect } from 'vitest';
import { identityFindings } from '../rules/identity';
import { RULE } from '../types';
import type { SurveyForm, SurveyQuestion } from '@/types/survey';

const q = (fieldname: string, overrides: Partial<SurveyQuestion> = {}): SurveyQuestion => ({
  id: fieldname || `id-${Math.random()}`,
  type: 'text',
  fieldname,
  fieldtype: 'text',
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

describe('fieldname legality', () => {
  it('accepts a normal lowercase field name', () => {
    expect(identityFindings(formOf([q('weight_kg')]))).toEqual([]);
  });

  it('rejects a blank field name', () => {
    const findings = identityFindings(formOf([q('')]));
    expect(findings).toEqual([expect.objectContaining({ ruleId: RULE.fieldnameEmpty })]);
  });

  it('rejects a field name starting with a digit', () => {
    const findings = identityFindings(formOf([q('1st_dose')]));
    expect(findings).toEqual([
      expect.objectContaining({ ruleId: RULE.fieldnameLeadingDigit, subject: '1st_dose' }),
    ]);
  });

  it('rejects uppercase, spaces, and symbols via the charset rule', () => {
    for (const bad of ['DOB', 'has space', 'weight-kg', "weight's"]) {
      const findings = identityFindings(formOf([q(bad)]));
      expect(findings, bad).toEqual([expect.objectContaining({ ruleId: RULE.fieldnameCharset })]);
    }
  });

  it('rejects a leading underscore', () => {
    const findings = identityFindings(formOf([q('_hidden')]));
    expect(findings).toEqual([
      expect.objectContaining({ ruleId: RULE.fieldnameLeadingUnderscore, subject: '_hidden' }),
    ]);
  });

  it('rejects a reserved system field name', () => {
    const findings = identityFindings(formOf([q('uniqueid')]));
    expect(findings).toEqual([
      expect.objectContaining({ ruleId: RULE.fieldnameReserved, subject: 'uniqueid' }),
    ]);
  });

  it('reports only the first problem for a name with multiple, matching SurveyGen', () => {
    // Starts with a digit AND contains an uppercase letter -- only the
    // leading-digit rule should fire.
    const findings = identityFindings(formOf([q('1Bad')]));
    expect(findings).toEqual([expect.objectContaining({ ruleId: RULE.fieldnameLeadingDigit })]);
  });

  it("rejects 'end' -- reserved as the End of Form skip target", () => {
    const findings = identityFindings(formOf([q('end')]));
    expect(findings).toEqual([
      expect.objectContaining({ ruleId: RULE.fieldnameReserved, subject: 'end' }),
    ]);
  });
});

describe('duplicate fieldnames', () => {
  it('flags every question sharing a duplicated name', () => {
    const findings = identityFindings(formOf([q('dup'), q('other'), q('dup')]));
    const dupes = findings.filter((f) => f.ruleId === RULE.fieldnameDuplicate);
    expect(dupes).toHaveLength(2);
    expect(dupes.map((f) => f.questionIndex)).toEqual([0, 2]);
  });

  it('matches case-insensitively', () => {
    const findings = identityFindings(formOf([q('dob'), q('DOB')]));
    // Both fire fieldnameCharset for the uppercase one AND fieldnameDuplicate
    // for both -- just assert duplicate detection specifically fired.
    expect(findings.filter((f) => f.ruleId === RULE.fieldnameDuplicate)).toHaveLength(2);
  });

  it('exempts information questions from the duplicate check', () => {
    const findings = identityFindings(
      formOf([q('note', { type: 'information' }), q('note', { type: 'information' })]),
    );
    expect(findings.filter((f) => f.ruleId === RULE.fieldnameDuplicate)).toEqual([]);
  });
});

describe('question text', () => {
  it('requires text on an ordinary question', () => {
    const findings = identityFindings(formOf([q('a', { text: '' })]));
    expect(findings).toContainEqual(expect.objectContaining({ ruleId: RULE.textRequired }));
  });

  it('does not require text on a calculated question', () => {
    const findings = identityFindings(formOf([q('a', { type: 'calculated', text: '' })]));
    expect(findings.filter((f) => f.ruleId === RULE.textRequired)).toEqual([]);
  });

  it('treats whitespace-only text as blank', () => {
    const findings = identityFindings(formOf([q('a', { text: '   ' })]));
    expect(findings).toContainEqual(expect.objectContaining({ ruleId: RULE.textRequired }));
  });
});

describe('mask placement', () => {
  it('allows a mask on a text question', () => {
    const findings = identityFindings(formOf([q('a', { mask: '[0-9][0-9]' })]));
    expect(findings.filter((f) => f.ruleId === RULE.maskOnNonText)).toEqual([]);
  });

  it('rejects a mask on a non-text question', () => {
    const findings = identityFindings(formOf([q('a', { type: 'date', fieldtype: 'date', mask: '[0-9][0-9]' })]));
    expect(findings).toContainEqual(expect.objectContaining({ ruleId: RULE.maskOnNonText }));
  });
});

describe('optional placement', () => {
  it('allows optional on a text question', () => {
    const findings = identityFindings(formOf([q('a', { optional: true })]));
    expect(findings.filter((f) => f.ruleId === RULE.optionalOnNonText)).toEqual([]);
  });

  it('rejects optional on a non-text question', () => {
    const findings = identityFindings(
      formOf([q('a', { type: 'radio', fieldtype: 'integer', optional: true })]),
    );
    expect(findings).toContainEqual(expect.objectContaining({ ruleId: RULE.optionalOnNonText }));
  });

  it('is silent when optional is simply unset', () => {
    const findings = identityFindings(formOf([q('a', { type: 'radio', fieldtype: 'integer' })]));
    expect(findings.filter((f) => f.ruleId === RULE.optionalOnNonText)).toEqual([]);
  });
});

describe('formId/tablename are attached', () => {
  it('stamps every finding with the form it came from', () => {
    const findings = identityFindings(formOf([q('')]));
    expect(findings[0]).toMatchObject({ formId: 'f1', tablename: 'form1' });
  });
});
