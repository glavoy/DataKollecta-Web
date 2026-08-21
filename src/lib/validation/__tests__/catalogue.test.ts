/**
 * Every rule in `RULE` must be reachable from `validatePackage`. This is a
 * completeness guarantee, not a correctness one -- the individual rule-module
 * test files (`identity.test.ts`, `shape.test.ts`, etc.) already assert each
 * rule's exact behaviour. What this file catches is different: a rule id
 * declared in the catalogue but never wired into any rule module (exactly
 * what happened with `fieldTypeInvalidForQuestionType`, found while writing
 * this file -- it existed in `RULE` from the initial design but the actual
 * check was never added to `shape.ts` until this test would have caught it).
 */

import { describe, it, expect } from 'vitest';
import { validatePackage } from '..';
import { RULE, type RuleId } from '../types';
import type { CalculationConfig, SkipRule, SurveyForm, SurveyPackage, SurveyQuestion } from '@/types/survey';

/** Accumulates every rule id seen across every package built below. */
const covered = new Set<RuleId>();

function q(fieldname: string, overrides: Partial<SurveyQuestion> = {}): SurveyQuestion {
  return {
    id: fieldname || `id-${Math.random()}`,
    type: 'text',
    fieldname,
    fieldtype: 'text',
    text: 'Q',
    maxCharacters: 10,
    ...overrides,
  };
}

function formOf(tablename: string, questions: SurveyQuestion[], extra: Partial<SurveyForm> = {}): SurveyForm {
  return {
    id: tablename,
    tablename,
    displayname: tablename,
    displayOrder: 10,
    autoStartRepeat: 0,
    repeatEnforceCount: 0,
    questions,
    ...extra,
  };
}

function pkgOf(forms: SurveyForm[], extra: Partial<SurveyPackage> = {}): SurveyPackage {
  return { id: 'p1', surveyId: 's1', name: 'Survey', forms, ...extra };
}

const skip = (fieldname: string, skipToFieldname: string, overrides: Partial<SkipRule> = {}): SkipRule => ({
  id: `${fieldname}-${skipToFieldname}-${Math.random()}`,
  fieldname,
  condition: '=',
  response: '1',
  skipToFieldname,
  ...overrides,
});

/** Runs the package, records every rule id it produced. */
function record(pkg: SurveyPackage): void {
  for (const f of validatePackage(pkg).findings) covered.add(f.ruleId);
}

describe('per-question identity, shape, responses, calculation', () => {
  it('covers fieldname, text, and mask rules', () => {
    record(
      pkgOf([
        formOf('t1', [
          q(''),
          q('1bad'),
          q('bad name'),
          q('_bad'),
          q('uniqueid'),
          q('dup'),
          q('dup'),
          q('a', { text: '' }),
          q('a2', {
            type: 'date',
            fieldtype: 'date',
            mask: 'X',
            dateRange: { minDate: '0', maxDate: '0' },
          }),
        ]),
      ]),
    );
  });

  it('covers width, range, field-type, and special-answer rules', () => {
    record(
      pkgOf([
        formOf('t2', [
          q('a', { fieldtype: 'text', maxCharacters: undefined }),
          q('b', { fieldtype: 'hourmin', maxCharacters: 4, fixedLength: true }),
          q('c', {
            fieldtype: 'hourmin',
            maxCharacters: 5,
            fixedLength: true,
            numericCheck: { minValue: 0, message: 'm' },
          }),
          q('d', { fieldtype: 'text_integer', maxCharacters: 3, numericCheck: { minValue: 0, message: 'm' } }),
          q('e', {
            fieldtype: 'text_integer',
            maxCharacters: 3,
            numericCheck: { minValue: 10, maxValue: 0, message: 'm' },
          }),
          q('f', { type: 'date', fieldtype: 'date' }),
          q('g', { type: 'date', fieldtype: 'date', dateRange: { minDate: 'bad', maxDate: '0' } }),
          q('h', { type: 'checkbox', fieldtype: 'integer' as never }),
          q('i', {
            type: 'radio',
            fieldtype: 'integer',
            dontKnow: '2',
            responses: [
              { id: 'r1', value: '1', label: 'Y' },
              { id: 'r2', value: '2', label: 'N' },
            ],
          }),
          q('j', { dontKnow: '99' }),
        ]),
      ]),
    );
  });

  it('covers response-list rules', () => {
    record(
      pkgOf(
        [
          formOf('t3', [
            q('a', { type: 'radio', fieldtype: 'integer', responses: [] }),
            q('b', {
              type: 'radio',
              fieldtype: 'integer',
              responses: [
                { id: 'r1', value: '1', label: 'Y' },
                { id: 'r2', value: '1', label: 'Y2' },
              ],
            }),
            q('c', { type: 'radio', fieldtype: 'integer', responses: [{ id: 'r1', value: '1', label: '' }] }),
            q('d', {
              type: 'combobox',
              fieldtype: 'text',
              responseMode: 'dynamic',
              dynamicResponses: {
                source: 'csv',
                file: undefined,
                displayColumn: 'd',
                valueColumn: 'v',
                filters: [],
              },
            }),
            q('e', {
              type: 'combobox',
              fieldtype: 'text',
              responseMode: 'dynamic',
              dynamicResponses: {
                source: 'database',
                table: undefined,
                displayColumn: 'd',
                valueColumn: 'v',
                filters: [],
              },
            }),
            q('f', {
              type: 'combobox',
              fieldtype: 'text',
              responseMode: 'dynamic',
              dynamicResponses: {
                source: 'csv',
                file: 'x.csv',
                displayColumn: '',
                valueColumn: '',
                filters: [],
              },
            }),
            q('g', {
              type: 'combobox',
              fieldtype: 'text',
              responseMode: 'dynamic',
              dynamicResponses: {
                source: 'csv',
                file: 'missing.csv',
                displayColumn: 'd',
                valueColumn: 'v',
                filters: [],
              },
            }),
          ]),
        ],
        { csvFiles: [] },
      ),
    );
  });

  it('covers calculation-missing and operand rules', () => {
    const calcs: CalculationConfig[] = [
      { type: 'lookup' },
      { type: 'age_at_date', field: 'dob', value: 'decades', separator: '0' },
      { type: 'date_offset', field: 'x', value: 'bad' },
    ];
    record(
      pkgOf([
        formOf('t4', [
          q('missing', { type: 'calculated', text: '' }),
          ...calcs.map((c, i) => q(`calc${i}`, { type: 'calculated', text: '', calculation: c })),
        ]),
      ]),
    );
  });
});

describe('reference integrity and ordering', () => {
  it('covers logic-check, calculation, and placeholder reference rules', () => {
    record(
      pkgOf([
        formOf('t5', [
          q('weight_kg'),
          q('dose_count', { logicCheck: [{ condition: 'dose_count > 0 and severity = 0', message: 'check' }] }),
          q('severity'),
          q('status', { logicCheck: [{ condition: 'status = yes', message: 'm' }] }),
          q('sees_trailing', { logicCheck: [{ condition: 'sees_trailing = uniqueid', message: 'm' }] }),
          q('sees_auto', { logicCheck: [{ condition: 'sees_auto = doy', message: 'm' }] }),
          q('has_msg_placeholder', { logicCheck: [{ condition: 'has_msg_placeholder > 0', message: 'See [[x]]' }] }),
          q('bad_calc', { type: 'calculated', text: '', calculation: { type: 'lookup', field: 'typo_field' } }),
        ]),
      ]),
    );
  });

  it('covers every skip tested-field and target rule', () => {
    record(
      pkgOf([
        formOf('t6', [
          q('a', { postskip: [skip('startdate', 'b')] }),
          q('b', { postskip: [skip('typo', 'c')] }),
          q('c', { preskip: [skip('c', 'd')] }), // preskip tests own field
          q('d', { postskip: [skip('later', 'e')] }),
          q('later'),
          q('e', { postskip: [skip('e', 'uniqueid')] }),
          q('f', { postskip: [skip('f', 'typo')] }),
          q('g', { postskip: [skip('g', 'g')] }), // skip to self
          q('h', { postskip: [skip('earlier2', 'earlier2')] }),
        ]),
      ]),
    );
    // 'earlier' comes before its own skip target in the chain above; add a
    // dedicated backwards-target case separately for clarity.
    record(
      pkgOf([formOf('t6b', [q('earlier'), q('a', { postskip: [skip('a', 'earlier')] })])]),
    );
  });
});

describe('cross-form and package rules', () => {
  it('covers manifest field and linking-field rules', () => {
    record(
      pkgOf([
        formOf('t7', [q('a')], { primaryKey: 'typo', parenttable: 'parent1' }), // linkingFieldMissing
        formOf('t7b', [q('a')], { parenttable: 'parent1', linkingfield: 'typo' }), // linkingFieldUnknown
        formOf('parent1', [q('pk')]),
      ]),
    );
  });

  it('covers table-name, parent-chain, base-form, and package-identity rules', () => {
    record(
      pkgOf(
        [
          formOf('123bad', []),
          formOf('dup1', [], { id: 'd1' }),
          formOf('Dup1', [], { id: 'd2' }),
          formOf('orphan', [], { parenttable: 'nonexistent' }),
          formOf('selfparent', [], { parenttable: 'selfparent' }),
        ],
        { surveyId: '', databaseName: 'survey.db' },
      ),
    );
  });
});

it('every declared rule id was produced by at least one package above', () => {
  const missing = Object.values(RULE).filter((id) => !covered.has(id));
  expect(missing, `Rules never triggered: ${missing.join(', ')}`).toEqual([]);
});
