import { describe, it, expect } from 'vitest';
import { formManifestFindings } from '../rules/formManifest';
import { RULE } from '../types';
import type { SurveyForm, SurveyQuestion } from '@/types/survey';

const q = (fieldname: string): SurveyQuestion => ({
  id: fieldname,
  type: 'text',
  fieldname,
  fieldtype: 'text',
  text: 'Q',
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

describe('primaryKey / displayFields / incrementField', () => {
  it('is silent when every named field exists', () => {
    const findings = formManifestFindings(
      formOf([q('subjid'), q('startdate')], { primaryKey: 'subjid', displayFields: 'subjid,startdate' }),
    );
    expect(findings).toEqual([]);
  });

  it('errors on a primaryKey naming a nonexistent field', () => {
    const findings = formManifestFindings(formOf([q('a')], { primaryKey: 'typo' }));
    expect(findings).toEqual([
      expect.objectContaining({ ruleId: RULE.manifestFieldUnknown, subject: 'typo' }),
    ]);
  });

  it('checks each entry in a comma-separated displayFields list independently', () => {
    const findings = formManifestFindings(formOf([q('a')], { displayFields: 'a, typo' }));
    expect(findings).toEqual([
      expect.objectContaining({ ruleId: RULE.manifestFieldUnknown, subject: 'typo' }),
    ]);
  });

  it('checks each idconfig field name', () => {
    const findings = formManifestFindings(
      formOf([q('country')], {
        idconfig: { prefix: '', fields: [{ name: 'country', length: 1 }, { name: 'typo', length: 2 }], incrementLength: 4 },
      }),
    );
    expect(findings).toEqual([
      expect.objectContaining({ ruleId: RULE.manifestFieldUnknown, subject: 'typo' }),
    ]);
  });

  it('a manifest field may legally name a system field (e.g. startdate in displayFields)', () => {
    const findings = formManifestFindings(formOf([q('a')], { displayFields: 'startdate' }));
    expect(findings).toEqual([]);
  });
});

describe('linkingfield', () => {
  it('is not required on a base form (no parenttable)', () => {
    const findings = formManifestFindings(formOf([q('a')]));
    expect(findings).toEqual([]);
  });

  it('is required once a parenttable is set', () => {
    const findings = formManifestFindings(formOf([q('a')], { parenttable: 'household' }));
    expect(findings).toEqual([expect.objectContaining({ ruleId: RULE.linkingFieldMissing })]);
  });

  it('must name a real field on this form', () => {
    const findings = formManifestFindings(
      formOf([q('a')], { parenttable: 'household', linkingfield: 'typo' }),
    );
    expect(findings).toEqual([
      expect.objectContaining({ ruleId: RULE.linkingFieldUnknown, subject: 'typo' }),
    ]);
  });

  it('is silent when a valid linkingfield is set', () => {
    const findings = formManifestFindings(
      formOf([q('hhid')], { parenttable: 'household', linkingfield: 'hhid' }),
    );
    expect(findings).toEqual([]);
  });
});
