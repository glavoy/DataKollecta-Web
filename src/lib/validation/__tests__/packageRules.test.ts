import { describe, it, expect } from 'vitest';
import { packageFindings } from '../rules/packageRules';
import { RULE } from '../types';
import type { SurveyForm, SurveyPackage, SurveyQuestion } from '@/types/survey';

const q = (fieldname: string): SurveyQuestion => ({
  id: fieldname,
  type: 'text',
  fieldname,
  fieldtype: 'text',
  text: '',
});

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

  it('is silent for an empty package (nothing to be wrong yet)', () => {
    expect(packageFindings(pkgOf([]))).toEqual([]);
  });
});

describe('parent field references (entry_condition / repeatCountField)', () => {
  it('is silent when both resolve against the parent', () => {
    const findings = packageFindings(
      pkgOf([
        formOf('household', { questions: [q('enrolled'), q('num_members')] }),
        formOf('member', {
          parenttable: 'household',
          entry_condition: 'enrolled=1',
          repeatCountField: 'num_members',
        }),
      ]),
    );
    expect(
      findings.filter((f) => f.ruleId === RULE.entryConditionUnknown || f.ruleId === RULE.repeatCountFieldUnknown),
    ).toEqual([]);
  });

  it("errors when entry_condition's field is not on the parent", () => {
    const findings = packageFindings(
      pkgOf([
        formOf('household'),
        formOf('member', { parenttable: 'household', entry_condition: 'typo=1' }),
      ]),
    );
    expect(findings).toContainEqual(
      expect.objectContaining({ ruleId: RULE.entryConditionUnknown, subject: 'typo' }),
    );
  });

  it('never flags the literal value on the right of "="', () => {
    const findings = packageFindings(
      pkgOf([
        formOf('household', { questions: [q('status')] }),
        formOf('member', { parenttable: 'household', entry_condition: 'status=typo' }),
      ]),
    );
    expect(findings.filter((f) => f.ruleId === RULE.entryConditionUnknown)).toEqual([]);
  });

  it('errors when repeatCountField is not on the parent', () => {
    const findings = packageFindings(
      pkgOf([formOf('household'), formOf('member', { parenttable: 'household', repeatCountField: 'typo' })]),
    );
    expect(findings).toContainEqual(
      expect.objectContaining({ ruleId: RULE.repeatCountFieldUnknown, subject: 'typo' }),
    );
  });

  it('is silent when the parent itself is missing -- parentChainFindings owns that error', () => {
    const findings = packageFindings(
      pkgOf([formOf('member', { parenttable: 'nonexistent', entry_condition: 'typo=1', repeatCountField: 'typo' })]),
    );
    expect(
      findings.filter((f) => f.ruleId === RULE.entryConditionUnknown || f.ruleId === RULE.repeatCountFieldUnknown),
    ).toEqual([]);
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

describe('foreign-key viability (linkingfield against the parent)', () => {
  // The app creates each child table with
  // FOREIGN KEY (linkingfield) REFERENCES parent(...) ON UPDATE CASCADE, so a
  // correction to a parent's key carries to its children. Two conditions have
  // to hold for that to be declarable, and neither was checked anywhere --
  // formManifest.ts only ever resolved linkingfield against the *child's* own
  // fields.
  const parent = formOf('hh_info', {
    primaryKey: 'hhid',
    questions: [q('hhid'), q('nmembers')],
  });

  it('is silent when the linking field is exactly the parent key', () => {
    const child = formOf('hh_members', {
      primaryKey: 'hhid,linenum',
      parenttable: 'hh_info',
      linkingfield: 'hhid',
      questions: [q('hhid'), q('linenum')],
    });

    expect(packageFindings(pkgOf([parent, child]))).toEqual([]);
  });

  it('errors when the linking field is not a field on the parent', () => {
    const child = formOf('hh_members', {
      primaryKey: 'household_id,linenum',
      parenttable: 'hh_info',
      linkingfield: 'household_id',
      questions: [q('household_id'), q('linenum')],
    });

    const findings = packageFindings(pkgOf([parent, child]));
    expect(findings).toContainEqual(
      expect.objectContaining({
        ruleId: RULE.linkingFieldNotOnParent,
        subject: 'household_id',
      }),
    );
  });

  it('accepts a linking field that is not the parent primary key', () => {
    // A real dictionary links vaccination_status to enrollee on `barcode` (a
    // scanned physical label) while enrollee is keyed on `subjid`. The app
    // declares the uniqueness the foreign key needs over whichever columns
    // children reference, so this must not be an error.
    const enrollee = formOf('enrollee', {
      primaryKey: 'subjid',
      linkingfield: 'barcode',
      questions: [q('subjid'), q('barcode')],
    });
    const vaccination = formOf('vaccination_status', {
      primaryKey: 'barcode',
      parenttable: 'enrollee',
      linkingfield: 'barcode',
      questions: [q('barcode')],
    });

    expect(packageFindings(pkgOf([enrollee, vaccination]))).toEqual([]);
  });

  it('accepts a composite linking field naming real parent columns', () => {
    const middle = formOf('hh_members', {
      primaryKey: 'hhid,linenum',
      parenttable: 'hh_info',
      linkingfield: 'hhid',
      questions: [q('hhid'), q('linenum')],
    });
    const grandchild = formOf('member_visits', {
      primaryKey: 'hhid,linenum,visitnum',
      parenttable: 'hh_members',
      linkingfield: 'hhid,linenum',
      questions: [q('hhid'), q('linenum'), q('visitnum')],
    });

    expect(packageFindings(pkgOf([parent, middle, grandchild]))).toEqual([]);
  });

  it('is silent when the parent is missing -- parentChainFindings owns that', () => {
    const orphan = formOf('hh_members', {
      primaryKey: 'hhid,linenum',
      parenttable: 'not_here',
      linkingfield: 'hhid',
      questions: [q('hhid'), q('linenum')],
    });

    const findings = packageFindings(pkgOf([parent, orphan]));
    expect(findings.map((f) => f.ruleId)).not.toContain(RULE.linkingFieldNotOnParent);
    expect(findings.map((f) => f.ruleId)).toContain(RULE.parentMissing);
  });
});

describe('fields redefined across forms', () => {
  const radio = (fieldname: string, values: string[]): SurveyQuestion => ({
    ...q(fieldname),
    type: 'radio',
    fieldtype: 'integer',
    responses: values.map((v) => ({ id: `${fieldname}-${v}`, value: v, label: v })),
  });

  it('warns, on both forms, when the same field has different codes', () => {
    const findings = packageFindings(
      pkgOf([
        formOf('first', { questions: [radio('sex', ['1', '2'])] }),
        formOf('second', { parenttable: 'first', linkingfield: 'hhid', questions: [q('hhid'), radio('sex', ['1', '2', '9'])] }),
      ]),
    );
    const redefined = findings.filter((f) => f.ruleId === RULE.fieldRedefinedAcrossForms);
    expect(redefined).toHaveLength(2);
    expect(redefined.every((f) => f.severity === 'warning')).toBe(true);
    expect(redefined[0].message).toContain("'first'");
    expect(redefined[0].message).toContain("'second'");
  });

  it('is silent for the same definition twice, for the linking field, and for a calculated copy', () => {
    const findings = packageFindings(
      pkgOf([
        formOf('first', { questions: [q('hhid'), radio('sex', ['1', '2']), radio('region', ['1', '2'])] }),
        formOf('second', {
          parenttable: 'first',
          linkingfield: 'hhid',
          questions: [
            { ...q('hhid'), type: 'calculated' },
            radio('sex', ['1', '2']),
            { ...q('region'), type: 'calculated', calculation: { type: 'lookup', field: 'region' } },
          ],
        }),
      ]),
    );
    expect(findings.filter((f) => f.ruleId === RULE.fieldRedefinedAcrossForms)).toEqual([]);
  });
});
