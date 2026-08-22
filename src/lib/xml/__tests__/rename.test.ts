import { describe, it, expect } from 'vitest';
import { renameFieldInForm, renameFieldAcrossPackage } from '../rename';
import { constantOf } from '@/types/survey';
import type { SurveyForm, SurveyPackage, SurveyQuestion } from '@/types/survey';

const q = (fieldname: string, extra: Partial<SurveyQuestion> = {}): SurveyQuestion => ({
  id: fieldname,
  type: 'text',
  fieldname,
  fieldtype: 'text',
  text: `Enter ${fieldname}`,
  ...extra,
});

const formOf = (tablename: string, questions: SurveyQuestion[], extra: Partial<SurveyForm> = {}): SurveyForm => ({
  id: tablename,
  tablename,
  displayname: tablename,
  displayOrder: 10,
  autoStartRepeat: 0,
  repeatEnforceCount: 0,
  questions,
  ...extra,
});

const pkgOf = (forms: SurveyForm[]): SurveyPackage => ({
  id: 'p1',
  surveyId: 'survey_1',
  name: 'Survey',
  forms,
});

describe('renameFieldInForm -- no-op cases', () => {
  it('does nothing when the name is unchanged', () => {
    const form = formOf('t', [q('dob')]);
    expect(renameFieldInForm(form, 'dob', 'dob').count).toBe(0);
    expect(renameFieldInForm(form, 'dob', 'DOB').count).toBe(0); // case-only is still "unchanged"
  });

  it('leaves an unrelated field alone', () => {
    const form = formOf('t', [q('age', { text: 'How old? [[dob]]' })]);
    const { count } = renameFieldInForm(form, 'height', 'stature');
    expect(count).toBe(0);
  });
});

describe('renameFieldInForm -- question text placeholders', () => {
  it('rewrites [[oldName]] in question text, case-insensitively', () => {
    const form = formOf('t', [q('summary', { text: 'You said [[DOB]] was your birthdate.' })]);
    const { form: renamed, count } = renameFieldInForm(form, 'dob', 'birthdate');
    expect(count).toBe(1);
    expect(renamed.questions[0].text).toBe('You said [[birthdate]] was your birthdate.');
  });
});

describe('renameFieldInForm -- logic checks', () => {
  it('rewrites a bareword in the condition but not inside a quoted literal', () => {
    const form = formOf('t', [
      q('age', {
        logicCheck: [{ condition: "age > 18 and status = 'age'", message: 'Check [[age]]' }],
      }),
    ]);
    const { form: renamed, count } = renameFieldInForm(form, 'age', 'ageyears');
    expect(count).toBe(1);
    expect(renamed.questions[0].logicCheck![0].condition).toBe("ageyears > 18 and status = 'age'");
    expect(renamed.questions[0].logicCheck![0].message).toBe('Check [[ageyears]]');
  });

  it('is case-insensitive and only matches whole words', () => {
    const form = formOf('t', [q('x', { logicCheck: [{ condition: 'AGE > 18 and agecat = 1', message: '' }] })]);
    const { form: renamed } = renameFieldInForm(form, 'age', 'ageyears');
    expect(renamed.questions[0].logicCheck![0].condition).toBe('ageyears > 18 and agecat = 1');
  });
});

describe('renameFieldInForm -- unique/numeric check messages', () => {
  it('rewrites placeholders in uniqueCheck and numericCheck messages', () => {
    const form = formOf('t', [
      q('id', {
        uniqueCheck: { message: 'Duplicate of [[id]]' },
        numericCheck: { message: 'Must differ from [[id]]', minValue: 0 },
      }),
    ]);
    const { form: renamed, count } = renameFieldInForm(form, 'id', 'subjid');
    expect(count).toBe(1);
    expect(renamed.questions[0].uniqueCheck!.message).toBe('Duplicate of [[subjid]]');
    expect(renamed.questions[0].numericCheck!.message).toBe('Must differ from [[subjid]]');
  });
});

describe('renameFieldInForm -- calculations', () => {
  it('rewrites a bare field reference', () => {
    const form = formOf('t', [q('age', { calculation: { type: 'age_at_date', field: 'dob', separator: 'today' } })]);
    const { form: renamed } = renameFieldInForm(form, 'dob', 'birthdate');
    expect(renamed.questions[0].calculation!.field).toBe('birthdate');
  });

  it('rewrites a [[wrapped]] field reference, keeping the brackets', () => {
    const form = formOf('t', [q('age', { calculation: { type: 'age_at_date', field: '[[dob]]' } })]);
    const { form: renamed } = renameFieldInForm(form, 'dob', 'birthdate');
    expect(renamed.questions[0].calculation!.field).toBe('[[birthdate]]');
  });

  it('rewrites placeholders in sql/value/separator', () => {
    const form = formOf('t', [
      q('x', {
        calculation: { type: 'query', sql: 'select [[dob]] from t', value: '[[dob]]', separator: '[[dob]]' },
      }),
    ]);
    const { form: renamed } = renameFieldInForm(form, 'dob', 'birthdate');
    const calc = renamed.questions[0].calculation!;
    expect(calc.sql).toBe('select [[birthdate]] from t');
    expect(calc.value).toBe('[[birthdate]]');
    expect(calc.separator).toBe('[[birthdate]]');
  });

  it('rewrites params[].field', () => {
    const form = formOf('t', [
      q('x', { calculation: { type: 'query', sql: 's', params: [{ name: 'p1', field: 'dob' }] } }),
    ]);
    const { form: renamed } = renameFieldInForm(form, 'dob', 'birthdate');
    expect(renamed.questions[0].calculation!.params![0].field).toBe('birthdate');
  });

  it('rewrites cases[].field (exact, not [[wrapped]]) and recurses into cases[].result', () => {
    const form = formOf('t', [
      q('x', {
        calculation: {
          type: 'case',
          cases: [{ id: 'c1', field: 'dob', operator: '=', value: '', result: { type: 'query', sql: '[[dob]]' } }],
          defaultResult: constantOf('dob'),
        },
      }),
    ]);
    const { form: renamed, count } = renameFieldInForm(form, 'dob', 'birthdate');
    expect(count).toBe(1);
    const calc = renamed.questions[0].calculation!;
    expect(calc.cases![0].field).toBe('birthdate');
    expect(calc.cases![0].result.sql).toBe('[[birthdate]]');
    // defaultResult is a `constant` -- its `value` is a literal, not a reference, and must NOT be touched.
    expect(calc.defaultResult!.value).toBe('dob');
  });

  it('recurses into parts[] for math/concat', () => {
    const form = formOf('t', [
      q('x', {
        calculation: {
          type: 'math',
          operator: '+',
          parts: [{ type: 'query', field: 'dob' }, constantOf('1')],
        },
      }),
    ]);
    const { form: renamed } = renameFieldInForm(form, 'dob', 'birthdate');
    expect(renamed.questions[0].calculation!.parts![0].field).toBe('birthdate');
  });
});

describe('renameFieldInForm -- skip rules', () => {
  it('rewrites fieldname and skipToFieldname, leaving the "end" sentinel alone', () => {
    const form = formOf('t', [
      q('x', {
        preskip: [{ id: 's1', fieldname: 'dob', condition: '=', response: '1', skipToFieldname: 'end' }],
        postskip: [{ id: 's2', fieldname: 'y', condition: '=', response: '1', skipToFieldname: 'dob' }],
      }),
    ]);
    const { form: renamed, count } = renameFieldInForm(form, 'dob', 'birthdate');
    expect(count).toBe(1);
    expect(renamed.questions[0].preskip![0].fieldname).toBe('birthdate');
    expect(renamed.questions[0].preskip![0].skipToFieldname).toBe('end');
    expect(renamed.questions[0].postskip![0].skipToFieldname).toBe('birthdate');
  });

  it('rewrites a dynamic response value but not a fixed one', () => {
    const form = formOf('t', [
      q('x', {
        preskip: [
          {
            id: 's1',
            fieldname: 'y',
            condition: '=',
            response: 'dob',
            response_type: 'dynamic',
            skipToFieldname: 'end',
          },
          { id: 's2', fieldname: 'z', condition: '=', response: 'dob', skipToFieldname: 'end' },
        ],
      }),
    ]);
    const { form: renamed } = renameFieldInForm(form, 'dob', 'birthdate');
    expect(renamed.questions[0].preskip![0].response).toBe('birthdate');
    expect(renamed.questions[0].preskip![1].response).toBe('dob'); // fixed literal, not a reference
  });
});

describe('renameFieldInForm -- dynamic response filters', () => {
  it('rewrites a placeholder in a filter value', () => {
    const form = formOf('t', [
      q('x', {
        dynamicResponses: {
          source: 'csv',
          displayColumn: 'a',
          valueColumn: 'b',
          filters: [{ column: 'region', operator: '=', value: '[[dob]]' }],
        },
      }),
    ]);
    const { form: renamed } = renameFieldInForm(form, 'dob', 'birthdate');
    expect(renamed.questions[0].dynamicResponses!.filters[0].value).toBe('[[birthdate]]');
  });
});

describe('renameFieldInForm -- manifest fields', () => {
  it('rewrites a name inside comma-separated primaryKey/displayFields', () => {
    const form = formOf('t', [], { primaryKey: 'dob,subjid', displayFields: 'name, dob' });
    const { form: renamed, count } = renameFieldInForm(form, 'dob', 'birthdate');
    expect(count).toBe(2);
    expect(renamed.primaryKey).toBe('birthdate,subjid');
    expect(renamed.displayFields).toBe('name,birthdate');
  });

  it('rewrites incrementField, linkingfield, and idconfig.fields[].name', () => {
    const form = formOf('t', [], {
      incrementField: 'dob',
      linkingfield: 'dob',
      idconfig: { prefix: '', fields: [{ name: 'dob', length: 2 }], incrementLength: 4 },
    });
    const { form: renamed, count } = renameFieldInForm(form, 'dob', 'birthdate');
    expect(count).toBe(3);
    expect(renamed.incrementField).toBe('birthdate');
    expect(renamed.linkingfield).toBe('birthdate');
    expect(renamed.idconfig!.fields[0].name).toBe('birthdate');
  });
});

describe('renameFieldAcrossPackage', () => {
  it("renames references within the target form itself, e.g. another question's skip", () => {
    // `dob` is renamed; `fieldname` renaming is the caller's job (the
    // question being edited already carries its new name by the time this
    // runs) -- this checks that OTHER questions' references follow it.
    const parent = formOf('household', [
      q('dob'),
      q('age', { preskip: [{ id: 's1', fieldname: 'dob', condition: '=', response: '', skipToFieldname: 'end' }] }),
    ]);
    const pkg = pkgOf([parent]);
    const { pkg: renamed, count } = renameFieldAcrossPackage(pkg, 'household', 'dob', 'birthdate');
    expect(count).toBe(1);
    expect(renamed.forms[0].questions[1].preskip![0].fieldname).toBe('birthdate');
  });

  it("rewrites a child form's entry_condition LHS but never its RHS literal", () => {
    const parent = formOf('household', [q('enrolled')]);
    const child = formOf('member', [q('name')], { parenttable: 'household', entry_condition: 'enrolled=1' });
    const pkg = pkgOf([parent, child]);
    const { pkg: renamed, count } = renameFieldAcrossPackage(pkg, 'household', 'enrolled', 'is_enrolled');
    expect(count).toBe(1);
    expect(renamed.forms[1].entry_condition).toBe('is_enrolled=1');
  });

  it('leaves entry_condition alone when its LHS does not match', () => {
    const parent = formOf('household', [q('enrolled')]);
    const child = formOf('member', [q('name')], { parenttable: 'household', entry_condition: 'other=1' });
    const pkg = pkgOf([parent, child]);
    const { count } = renameFieldAcrossPackage(pkg, 'household', 'enrolled', 'is_enrolled');
    expect(count).toBe(0);
  });

  it("rewrites a child form's repeatCountField", () => {
    const parent = formOf('household', [q('num_members')]);
    const child = formOf('member', [q('name')], { parenttable: 'household', repeatCountField: 'num_members' });
    const pkg = pkgOf([parent, child]);
    const { pkg: renamed, count } = renameFieldAcrossPackage(pkg, 'household', 'num_members', 'member_count');
    expect(count).toBe(1);
    expect(renamed.forms[1].repeatCountField).toBe('member_count');
  });

  it('never touches a form that is not a direct child of the renamed form', () => {
    const grandparent = formOf('household', [q('num_members')]);
    const parent = formOf('member', [q('x')], { parenttable: 'household' });
    const grandchild = formOf('visit', [q('y')], {
      parenttable: 'member',
      repeatCountField: 'num_members', // stale even before the rename -- not this rule's job to fix
    });
    const pkg = pkgOf([grandparent, parent, grandchild]);
    const { pkg: renamed, count } = renameFieldAcrossPackage(pkg, 'household', 'num_members', 'member_count');
    expect(count).toBe(0);
    expect(renamed.forms[2].repeatCountField).toBe('num_members');
  });

  it('is a no-op for an unknown formId', () => {
    const pkg = pkgOf([formOf('household', [q('dob')])]);
    const { count } = renameFieldAcrossPackage(pkg, 'nonexistent', 'dob', 'birthdate');
    expect(count).toBe(0);
  });
});
