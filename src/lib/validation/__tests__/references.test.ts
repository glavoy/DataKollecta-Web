import { describe, it, expect } from 'vitest';
import { referenceFindings } from '../rules/references';
import { RULE } from '../types';
import type { CalculationConfig, SkipRule, SurveyForm, SurveyQuestion } from '@/types/survey';

const q = (fieldname: string, overrides: Partial<SurveyQuestion> = {}): SurveyQuestion => ({
  id: fieldname,
  type: 'text',
  fieldname,
  fieldtype: 'text',
  text: 'Q',
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

const skip = (fieldname: string, skipToFieldname: string, overrides: Partial<SkipRule> = {}): SkipRule => ({
  id: `${fieldname}-${skipToFieldname}`,
  fieldname,
  condition: '=',
  response: '1',
  skipToFieldname,
  ...overrides,
});

describe('logic checks', () => {
  it('is the regression test for the incident this engine exists because of: a logic check referencing a field defined later in the form', () => {
    // dose_count (index 1) referenced severity (index 2) -- a field
    // answered AFTER dose_count, so the check would fire against an
    // unanswered value every time. Shipped through the designer before
    // anyone noticed.
    const form = formOf([
      q('weight_kg'),
      q('dose_count', {
        logicCheck: [{ condition: 'dose_count > 0 and severity = 0', message: 'check' }],
      }),
      q('severity'),
    ]);

    const findings = referenceFindings(form);
    const forward = findings.filter((f) => f.ruleId === RULE.refForward);
    expect(forward).toHaveLength(1);
    expect(forward[0]).toMatchObject({ fieldname: 'dose_count', subject: 'severity' });
  });

  it('allows a logic check to reference its own field', () => {
    const form = formOf([
      q('age', { logicCheck: [{ condition: 'age >= 18 and age <= 65', message: 'm' }] }),
    ]);
    expect(referenceFindings(form)).toEqual([]);
  });

  it('allows a logic check to reference an EARLIER field', () => {
    const form = formOf([
      q('weight_kg'),
      q('bmi', { logicCheck: [{ condition: 'weight_kg > 0', message: 'm' }] }),
    ]);
    expect(referenceFindings(form)).toEqual([]);
  });

  it('allows reading a leading system field (startdate) in a logic check', () => {
    const form = formOf([
      q('dob', { logicCheck: [{ condition: 'dob < startdate', message: 'm' }] }),
    ]);
    expect(referenceFindings(form)).toEqual([]);
  });

  it('errors when a logic check reads a trailing system field, which is empty during the interview', () => {
    const form = formOf([q('a', { logicCheck: [{ condition: 'a = uniqueid', message: 'm' }] })]);
    const findings = referenceFindings(form);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ ruleId: RULE.refTrailingSystem, subject: 'uniqueid' });
  });

  it('warns (not errors) on an unquoted literal comparison value, since it is indistinguishable from a stale reference', () => {
    const form = formOf([q('status', { logicCheck: [{ condition: 'status = yes', message: 'm' }] })]);
    const findings = referenceFindings(form);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ ruleId: RULE.refUnknownLiteral, severity: 'warning', subject: 'yes' });
  });

  it('does not flag a QUOTED literal comparison value', () => {
    const form = formOf([q('status', { logicCheck: [{ condition: "status = 'yes'", message: 'm' }] })]);
    expect(referenceFindings(form)).toEqual([]);
  });

  it('warns when a validation message contains a [[placeholder]], since messages render literally', () => {
    const form = formOf([
      q('a', { logicCheck: [{ condition: 'a > 0', message: 'Must exceed [[b]]' }] }),
    ]);
    const findings = referenceFindings(form);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ ruleId: RULE.messagePlaceholder, severity: 'warning', subject: 'b' });
  });

  it('warns on a placeholder in a unique-check message too', () => {
    const form = formOf([q('a', { uniqueCheck: { message: 'Duplicate of [[a]]' } })]);
    const findings = referenceFindings(form);
    expect(findings).toEqual([
      expect.objectContaining({ ruleId: RULE.messagePlaceholder, part: 'uniqueCheck' }),
    ]);
  });
});

describe('the Computed Automatic Variable distinction', () => {
  it('a DECLARED yy/doy-style field resolves as authored, with real ordering', () => {
    const form = formOf([
      q('doy'),
      q('a', { logicCheck: [{ condition: 'a > doy', message: 'm' }] }), // reads earlier 'doy' -- fine
    ]);
    expect(referenceFindings(form)).toEqual([]);
  });

  it('an UNDECLARED Computed Automatic Variable is a warning, not silently accepted', () => {
    const form = formOf([q('a', { logicCheck: [{ condition: 'a = doy', message: 'm' }] })]);
    const findings = referenceFindings(form);
    expect(findings).toEqual([
      expect.objectContaining({ ruleId: RULE.refUndeclaredAutomatic, severity: 'warning', subject: 'doy' }),
    ]);
  });
});

describe('calculations', () => {
  it('errors on a calculation field that does not exist on the form', () => {
    const form = formOf([q('result', { type: 'calculated', calculation: { type: 'lookup', field: 'typo_field' } })]);
    const findings = referenceFindings(form);
    expect(findings).toEqual([
      expect.objectContaining({ ruleId: RULE.refUnknown, subject: 'typo_field', part: 'calculation', path: 'field' }),
    ]);
  });

  it('does not treat the "today" sentinel as a field reference', () => {
    const calc: CalculationConfig = { type: 'date_diff', field: 'today', value: 'startdate', unit: 'd' };
    const form = formOf([q('elapsed', { type: 'calculated', calculation: calc })]);
    expect(referenceFindings(form)).toEqual([]);
  });

  it('errors on a forward calculation reference (SurveyGen has no equivalent check at all)', () => {
    const form = formOf([
      q('total', { type: 'calculated', calculation: { type: 'lookup', field: 'weight_kg' } }),
      q('weight_kg'),
    ]);
    const findings = referenceFindings(form);
    expect(findings).toEqual([
      expect.objectContaining({ ruleId: RULE.refForward, fieldname: 'total', subject: 'weight_kg' }),
    ]);
  });

  it('errors on a nested math/concat part reference, with the nested path recorded', () => {
    const calc: CalculationConfig = {
      type: 'math',
      operator: '*',
      parts: [{ type: 'lookup', field: 'weight_kg' }, { type: 'lookup', field: 'missing_field' }],
    };
    const form = formOf([q('weight_kg'), q('total', { type: 'calculated', calculation: calc })]);
    const findings = referenceFindings(form);
    expect(findings).toEqual([
      expect.objectContaining({ ruleId: RULE.refUnknown, subject: 'missing_field', path: 'parts[1].field' }),
    ]);
  });

  it('reads the age_at_date target date correctly: separator is scanned, value (the unit word) is not', () => {
    const calc: CalculationConfig = { type: 'age_at_date', field: 'dob', value: 'years', separator: '[[startdate]]' };
    const form = formOf([q('dob'), q('age', { type: 'calculated', calculation: calc })]);
    expect(referenceFindings(form)).toEqual([]);
  });

  it('errors when a calculation reads a trailing system field', () => {
    const form = formOf([
      q('bad', { type: 'calculated', calculation: { type: 'lookup', field: 'lastmod' } }),
    ]);
    const findings = referenceFindings(form);
    expect(findings).toEqual([
      expect.objectContaining({ ruleId: RULE.refTrailingSystem, subject: 'lastmod' }),
    ]);
  });
});

describe('response filters and question text placeholders', () => {
  it('errors on an unresolvable [[placeholder]] in a response filter value', () => {
    const form = formOf([
      q('village', {
        type: 'combobox',
        responseMode: 'dynamic',
        dynamicResponses: {
          source: 'csv',
          file: 'villages.csv',
          displayColumn: 'name',
          valueColumn: 'id',
          filters: [{ column: 'district', operator: '=', value: '[[district]]' }],
        },
      }),
    ]);
    const findings = referenceFindings(form);
    expect(findings).toEqual([
      expect.objectContaining({ ruleId: RULE.refUnknown, subject: 'district', part: 'dynamicResponses' }),
    ]);
  });

  it('resolves a filter placeholder against an earlier field', () => {
    const form = formOf([
      q('district'),
      q('village', {
        type: 'combobox',
        responseMode: 'dynamic',
        dynamicResponses: {
          source: 'csv',
          file: 'villages.csv',
          displayColumn: 'name',
          valueColumn: 'id',
          filters: [{ column: 'district', operator: '=', value: '[[district]]' }],
        },
      }),
    ]);
    expect(referenceFindings(form)).toEqual([]);
  });

  it('errors on an unresolvable placeholder in question text', () => {
    const form = formOf([q('a', { text: "What is [[missing]]'s age?" })]);
    const findings = referenceFindings(form);
    expect(findings).toEqual([
      expect.objectContaining({ ruleId: RULE.refUnknown, subject: 'missing', part: 'text' }),
    ]);
  });
});

describe('skip rules -- tested field', () => {
  it('errors when a postskip tests a reserved variable (leading OR trailing, unlike logic checks)', () => {
    const form = formOf([q('a', { postskip: [skip('startdate', 'b')] }), q('b')]);
    const findings = referenceFindings(form);
    expect(findings).toEqual([
      expect.objectContaining({ ruleId: RULE.skipTestsReserved, subject: 'startdate' }),
    ]);
  });

  it('errors when a postskip tests a field that comes AFTER the current question', () => {
    const form = formOf([q('a', { postskip: [skip('later', 'c')] }), q('later'), q('c')]);
    const findings = referenceFindings(form);
    expect(findings).toContainEqual(
      expect.objectContaining({ ruleId: RULE.skipTestsForward, subject: 'later' }),
    );
  });

  it('errors when a skip tests a nonexistent field', () => {
    const form = formOf([q('a', { postskip: [skip('typo', 'b')] }), q('b')]);
    const findings = referenceFindings(form);
    expect(findings).toContainEqual(
      expect.objectContaining({ ruleId: RULE.skipTestsUnknown, subject: 'typo' }),
    );
  });

  it('a postskip testing its own field is normal and not an error', () => {
    const form = formOf([q('a', { postskip: [skip('a', 'b')] }), q('b')]);
    expect(referenceFindings(form)).toEqual([]);
  });

  it('a preskip testing its own field IS an error: it cannot fire on a new record, and erases the answer on an existing one', () => {
    const form = formOf([q('a', { preskip: [skip('a', 'b')] }), q('b')]);
    const findings = referenceFindings(form);
    expect(findings).toEqual([
      expect.objectContaining({ ruleId: RULE.preskipTestsSelf, subject: 'a' }),
    ]);
  });

  it('a preskip testing an EARLIER field is fine', () => {
    const form = formOf([q('gate'), q('a', { preskip: [skip('gate', 'b')] }), q('b')]);
    expect(referenceFindings(form)).toEqual([]);
  });
});

describe('skip rules -- target field', () => {
  it("'end' is the app's own sentinel, never resolved as a fieldname", () => {
    const form = formOf([q('a', { postskip: [skip('a', 'end')] })]);
    expect(referenceFindings(form)).toEqual([]);
  });

  it('errors when a skip targets a reserved variable', () => {
    const form = formOf([q('a', { postskip: [skip('a', 'uniqueid')] })]);
    const findings = referenceFindings(form);
    expect(findings).toEqual([
      expect.objectContaining({ ruleId: RULE.skipToReserved, subject: 'uniqueid' }),
    ]);
  });

  it('errors when a skip targets the CURRENT question', () => {
    const form = formOf([q('a', { postskip: [skip('a', 'a')] })]);
    const findings = referenceFindings(form);
    expect(findings).toEqual([expect.objectContaining({ ruleId: RULE.skipToSelf, subject: 'a' })]);
  });

  it('errors when a skip targets an EARLIER question -- a loop back is never valid', () => {
    const form = formOf([q('earlier'), q('a', { postskip: [skip('a', 'earlier')] })]);
    const findings = referenceFindings(form);
    expect(findings).toEqual([
      expect.objectContaining({ ruleId: RULE.skipToBackwards, subject: 'earlier' }),
    ]);
  });

  it('errors when a skip targets a nonexistent field', () => {
    const form = formOf([q('a', { postskip: [skip('a', 'typo')] })]);
    const findings = referenceFindings(form);
    expect(findings).toEqual([
      expect.objectContaining({ ruleId: RULE.skipToUnknown, subject: 'typo' }),
    ]);
  });

  it('a forward target is exactly what is required and produces no finding', () => {
    const form = formOf([q('a', { postskip: [skip('a', 'later')] }), q('later')]);
    expect(referenceFindings(form)).toEqual([]);
  });
});

describe('skip rules -- dynamic comparison value', () => {
  it('resolves rule.response as a field reference only when response_type is dynamic', () => {
    const form = formOf([
      q('a', { postskip: [skip('a', 'end', { response_type: 'dynamic', response: 'typo_field' })] }),
    ]);
    const findings = referenceFindings(form);
    expect(findings).toEqual([
      expect.objectContaining({ ruleId: RULE.refUnknown, subject: 'typo_field' }),
    ]);
  });

  it('does NOT resolve rule.response as a field when response_type is fixed (the default) -- a literal "1" must not be reported as a missing field', () => {
    const form = formOf([q('a', { postskip: [skip('a', 'end')] })]); // response: '1', fixed by default
    expect(referenceFindings(form)).toEqual([]);
  });
});
