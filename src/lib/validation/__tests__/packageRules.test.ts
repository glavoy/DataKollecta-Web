import { describe, it, expect } from 'vitest';
import { packageFindings } from '../rules/packageRules';
import { RULE } from '../types';
import type { SurveyForm, SurveyPackage } from '@/types/survey';

const formOf = (tablename: string, extra: Partial<SurveyForm> = {}): SurveyForm => ({
  id: tablename,
  tablename,
  displayname: tablename,
  displayOrder: 10,
  autoStartRepeat: 0,
  repeatEnforceCount: 0,
  questions: [],
  ...extra,
});

const pkgOf = (forms: SurveyForm[], extra: Partial<SurveyPackage> = {}): SurveyPackage => ({
  id: 'p1',
  surveyId: 'survey_1',
  name: 'Survey',
  forms,
  ...extra,
});

describe('table names', () => {
  it('is silent with a single valid base form', () => {
    expect(packageFindings(pkgOf([formOf('household')]))).toEqual([]);
  });

  it('rejects an invalid table name', () => {
    const findings = packageFindings(pkgOf([formOf('123bad')]));
    expect(findings).toContainEqual(
      expect.objectContaining({ ruleId: RULE.tablenameInvalid, subject: '123bad' }),
    );
  });

  it('flags duplicate table names, case-insensitively', () => {
    const findings = packageFindings(
      pkgOf([formOf('household', { id: 'f1' }), formOf('Household', { id: 'f2' })]),
    );
    const dupes = findings.filter((f) => f.ruleId === RULE.tablenameDuplicate);
    expect(dupes).toHaveLength(2);
  });
});

describe('parent chain', () => {
  it('is silent for a valid two-form parent/child relationship', () => {
    const findings = packageFindings(
      pkgOf([formOf('household'), formOf('member', { parenttable: 'household' })]),
    );
    expect(findings.filter((f) => f.ruleId === RULE.parentMissing || f.ruleId === RULE.parentCycle)).toEqual([]);
  });

  it('errors when parenttable names a form that does not exist', () => {
    const findings = packageFindings(pkgOf([formOf('member', { parenttable: 'nonexistent' })]));
    expect(findings).toContainEqual(
      expect.objectContaining({ ruleId: RULE.parentMissing, subject: 'nonexistent' }),
    );
  });

  it('treats a form naming itself as its own parent as a cycle, not a missing parent', () => {
    const findings = packageFindings(pkgOf([formOf('household', { parenttable: 'household' })]));
    expect(findings).toContainEqual(expect.objectContaining({ ruleId: RULE.parentCycle }));
    expect(findings.filter((f) => f.ruleId === RULE.parentMissing)).toEqual([]);
  });

  it('detects a two-form cycle (A parents B, B parents A)', () => {
    const findings = packageFindings(
      pkgOf([formOf('a', { parenttable: 'b' }), formOf('b', { parenttable: 'a' })]),
    );
    const cycles = findings.filter((f) => f.ruleId === RULE.parentCycle);
    expect(cycles).toHaveLength(2); // both forms are equally implicated
  });

  it('a missing parent is never ALSO reported as a cycle', () => {
    const findings = packageFindings(pkgOf([formOf('member', { parenttable: 'nonexistent' })]));
    expect(findings.filter((f) => f.ruleId === RULE.parentCycle)).toEqual([]);
  });
});

describe('base form count', () => {
  it('accepts exactly one base form', () => {
    const findings = packageFindings(
      pkgOf([formOf('household'), formOf('member', { parenttable: 'household' })]),
    );
    expect(findings.filter((f) => f.ruleId === RULE.baseFormCount)).toEqual([]);
  });

  it('errors when every form has a parent (no base form)', () => {
    const findings = packageFindings(
      pkgOf([formOf('a', { parenttable: 'b' }), formOf('b', { parenttable: 'a' })]),
    );
    expect(findings).toContainEqual(expect.objectContaining({ ruleId: RULE.baseFormCount }));
  });

  it('errors when more than one form has no parent', () => {
    const findings = packageFindings(pkgOf([formOf('household'), formOf('other')]));
    expect(findings).toContainEqual(expect.objectContaining({ ruleId: RULE.baseFormCount }));
  });

  it('respects an explicit isBase override, matching what the manifest actually emits', () => {
    const findings = packageFindings(
      pkgOf([
        formOf('household', { isBase: false, parenttable: undefined }),
        formOf('member', { isBase: true }),
      ]),
    );
    expect(findings.filter((f) => f.ruleId === RULE.baseFormCount)).toEqual([]);
  });

  it('is silent for an empty package (nothing to be wrong yet)', () => {
    expect(packageFindings(pkgOf([]))).toEqual([]);
  });
});

describe('package identity', () => {
  it('requires a surveyId', () => {
    const findings = packageFindings(pkgOf([formOf('a')], { surveyId: '' }));
    expect(findings).toContainEqual(expect.objectContaining({ ruleId: RULE.surveyIdMissing }));
  });

  it('flags a databaseName not ending in .sqlite', () => {
    const findings = packageFindings(pkgOf([formOf('a')], { databaseName: 'survey.db' }));
    expect(findings).toContainEqual(
      expect.objectContaining({ ruleId: RULE.databaseNameInvalid, subject: 'survey.db' }),
    );
  });

  it('is silent when databaseName is unset -- the generator derives one from surveyId', () => {
    const findings = packageFindings(pkgOf([formOf('a')], { databaseName: undefined }));
    expect(findings.filter((f) => f.ruleId === RULE.databaseNameInvalid)).toEqual([]);
  });
});
