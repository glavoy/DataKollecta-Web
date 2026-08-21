/**
 * Edge cases the real SurveyGen sample doesn't exercise: the calculation types
 * it happens not to use, nested parts, non-constant case results, values of
 * zero, and characters that need escaping.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonical, questionsOf } from '../canonical';
import { generateFormXml, parseSurveyDocument } from '../form';
import type { CalculationConfig, SurveyForm, SurveyQuestion } from '@/types/survey';

const original = readFileSync(join(__dirname, '..', '__fixtures__', 'edge.xml'), 'utf8');

function formOf(questions: SurveyQuestion[], endText?: string): SurveyForm {
  return {
    id: 'edge',
    tablename: 'edge',
    displayname: 'Edge',
    displayOrder: 10,
    autoStartRepeat: 0,
    repeatEnforceCount: 0,
    endOfQuestionsText: endText,
    questions,
  };
}

const parsed = parseSurveyDocument(original);
const regenerated = generateFormXml(formOf(parsed.questions, parsed.endText));

const byName = new Map(parsed.questions.map((q) => [q.fieldname, q]));
const emittedByName = new Map(
  questionsOf(canonical(regenerated)).map((q) => [q.attrs.fieldname, q]),
);

const calcOf = (name: string): CalculationConfig => {
  const c = byName.get(name)?.calculation;
  if (!c) throw new Error(`no calculation on ${name}`);
  return c;
};

describe('round trip', () => {
  it('is idempotent', () => {
    const twice = parseSurveyDocument(regenerated).questions;
    expect(twice).toEqual(parsed.questions);
  });

  it('strips system fields and the end screen from the authored list', () => {
    const names = parsed.questions.map((q) => q.fieldname);
    expect(names).not.toContain('starttime');
    expect(names).not.toContain('uniqueid');
    expect(names).not.toContain('end_of_questions');
    // A Computed Automatic Variable is authored, not generated -- it stays.
    expect(names).toContain('doy');
  });

  it('treats the stock end-screen wording as generated, not custom', () => {
    expect(parsed.endText).toBeUndefined();
  });
});

describe('calculation types', () => {
  it('parses a constant of zero rather than dropping it', () => {
    expect(calcOf('calc_constant')).toEqual({ type: 'constant', value: '0' });
  });

  it('round-trips date_part with its unit', () => {
    expect(calcOf('calc_date_part')).toEqual({
      type: 'date_part',
      field: 'startdate',
      unit: 'doy',
    });
  });

  it('round-trips date_offset', () => {
    expect(calcOf('calc_date_offset')).toEqual({
      type: 'date_offset',
      field: 'startdate',
      value: '+28d',
    });
  });

  it('round-trips preserve', () => {
    expect(calcOf('calc_preserved').preserve).toBe(true);
    expect(emittedByName.get('calc_preserved')?.children[0].attrs.preserve).toBe('true');
  });

  it('round-trips query sql and parameters', () => {
    const c = calcOf('calc_query');
    expect(c.sql).toContain('SELECT group_concat(x)');
    expect(c.params).toEqual([
      { name: '@a', field: 'zero_option' },
      { name: '@b', field: 'zero_floor' },
    ]);
  });
});

describe('structured math and concat', () => {
  it('parses operands into parts', () => {
    const c = calcOf('calc_math');
    expect(c.operator).toBe('*');
    expect(c.parts).toEqual([
      { type: 'lookup', field: 'zero_floor' },
      { type: 'constant', value: '2' },
    ]);
  });

  it('emits operands as <part>, never <result>', () => {
    // The app collects math/concat operands with findElements('part'); a
    // <result> here is silently dropped and the arithmetic runs on the wrong
    // operand list. The Python generator has exactly this bug for constants.
    const calc = emittedByName.get('calc_math')!.children[0];
    expect(calc.children.map((c) => c.name)).toEqual(['part', 'part']);
    expect(calc.children.filter((c) => c.name === 'result')).toHaveLength(0);
  });

  it('handles nesting to arbitrary depth', () => {
    const c = calcOf('calc_nested_math');
    expect(c.parts?.[1]).toEqual({
      type: 'math',
      operator: '*',
      parts: [
        { type: 'lookup', field: 'zero_option' },
        { type: 'constant', value: '3' },
      ],
    });

    const inner = emittedByName.get('calc_nested_math')!.children[0].children[1];
    expect(inner.name).toBe('part');
    expect(inner.attrs.type).toBe('math');
    expect(inner.children.map((c) => c.name)).toEqual(['part', 'part']);
  });

  it('keeps a nested concat separator', () => {
    const c = calcOf('calc_concat');
    expect(c.separator).toBe('-');
    expect(c.parts?.[2]).toMatchObject({ type: 'concat', separator: '/' });
  });
});

describe('case results', () => {
  const c = calcOf('calc_case_nested');

  it('keeps a constant result of zero', () => {
    expect(c.cases?.[0].result).toEqual({ type: 'constant', value: '0' });
  });

  it('supports a non-constant result, which the app has always accepted', () => {
    expect(c.cases?.[1].result).toMatchObject({ type: 'math', operator: '*' });
  });

  it('supports a non-constant else', () => {
    expect(c.defaultResult).toEqual({ type: 'lookup', field: 'zero_floor' });
  });

  it('emits case results as <result>, never <part>', () => {
    const calc = emittedByName.get('calc_case_nested')!.children[0];
    for (const when of calc.children.filter((x) => x.name === 'when')) {
      expect(when.children.map((x) => x.name)).toEqual(['result']);
    }
  });
});

describe('values of zero survive', () => {
  it('keeps a numeric floor of 0', () => {
    expect(byName.get('zero_floor')?.numericCheck?.minValue).toBe(0);
    const values = emittedByName
      .get('zero_floor')!
      .children.find((c) => c.name === 'numeric_check')!.children[0];
    expect(values.attrs.minvalue).toBe('0');
  });

  it('keeps a response option valued 0', () => {
    expect(byName.get('zero_option')?.responses?.[0]).toMatchObject({ value: '0', label: 'No' });
  });

  it("keeps a dynamic list's dont_know value of 0", () => {
    expect(byName.get('village')?.dynamicResponses?.dontKnow).toEqual({
      value: '0',
      label: 'Unknown village',
    });
  });

  it('keeps a filter value of 0', () => {
    expect(byName.get('village')?.dynamicResponses?.filters[1]).toEqual({
      column: 'mrcid',
      operator: '!=',
      value: '0',
    });
  });
});

describe('width encoding', () => {
  it("decodes '=3' as a fixed length and re-encodes it", () => {
    expect(byName.get('tricky_text')).toMatchObject({ maxCharacters: 3, fixedLength: true });
    const el = emittedByName.get('tricky_text')!.children.find((c) => c.name === 'maxCharacters');
    expect(el?.text).toBe('=3');
  });

  it("decodes a plain '10' as a maximum, not a fixed length", () => {
    expect(byName.get('tail_field')).toMatchObject({ maxCharacters: 10 });
    expect(byName.get('tail_field')?.fixedLength).toBeUndefined();
  });

  it('round-trips numeric_range, which no generator wrote before', () => {
    expect(byName.get('tricky_text')?.numericRange).toBe(4);
    const el = emittedByName.get('tricky_text')!.children.find((c) => c.name === 'numeric_range');
    expect(el?.text).toBe('=4');
  });
});

describe('escaping and text', () => {
  it('round-trips text containing every character that needs escaping', () => {
    expect(byName.get('tricky_text')?.text).toBe(
      'Is a < b & c > d? Don\'t guess -- say "no".',
    );
    expect(() => canonical(regenerated)).not.toThrow();
  });

  it('keeps a placeholder reference in a filter value', () => {
    expect(byName.get('village')?.dynamicResponses?.filters[0].value).toBe('[[zero_option]]');
  });
});

describe('logic checks', () => {
  const check = byName.get('village')?.logicCheck?.[0];

  it('collapses the multi-line `or` layout into one expression', () => {
    expect(check?.condition).toBe('zero_floor <> 0 and (zero_option = 1 or zero_option = 0)');
  });

  it('recovers the message from the legacy semicolon form', () => {
    expect(check?.message).toBe('A message; with an awkward semicolon');
  });

  it('re-emits it with the message as an attribute', () => {
    const lc = emittedByName.get('village')!.children.find((c) => c.name === 'logic_check');
    expect(lc?.attrs.message).toBe('A message; with an awkward semicolon');
  });
});

describe('skips and special values', () => {
  it('round-trips preskip and postskip', () => {
    expect(byName.get('village')?.preskip?.[0]).toMatchObject({
      fieldname: 'zero_option',
      condition: '=',
      response: '0',
      skipToFieldname: 'tail_field',
    });
    expect(byName.get('village')?.postskip?.[0]).toMatchObject({ condition: 'contains' });
  });

  it('round-trips dont_know, refuse and na', () => {
    expect(byName.get('zero_option')).toMatchObject({
      dontKnow: '-7',
      refuse: '-8',
      na: '-6',
    });
  });
});

describe('age_at_date normalization', () => {
  it('rewrites the deprecated age_from_date the way the app does at runtime', () => {
    const { questions } = parseSurveyDocument(`<?xml version='1.0'?><survey>
      <question type='automatic' fieldname='age' fieldtype='integer'>
        <calculation type='age_from_date' field='dob' value='years'/>
      </question></survey>`);

    expect(questions[0].calculation).toEqual({
      type: 'age_at_date',
      field: 'dob',
      value: 'years',
      separator: '[[startdate]]',
    });
  });

  it("converts a legacy 'y' unit into the word the app matches on", () => {
    const { questions } = parseSurveyDocument(`<?xml version='1.0'?><survey>
      <question type='automatic' fieldname='age' fieldtype='integer'>
        <calculation type='age_at_date' field='dob' unit='y' separator='[[startdate]]'/>
      </question></survey>`);

    expect(questions[0].calculation).toEqual({
      type: 'age_at_date',
      field: 'dob',
      value: 'years',
      separator: '[[startdate]]',
    });
  });
});
