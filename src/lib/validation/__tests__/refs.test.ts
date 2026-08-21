import { describe, it, expect } from 'vitest';
import { calculationRefs, expressionRefs, placeholderRefs, unwrapRef } from '../refs';
import type { CalculationConfig } from '@/types/survey';

describe('expressionRefs', () => {
  it('finds a single field reference', () => {
    expect(expressionRefs('age >= 18')).toEqual(['age']);
  });

  it('drops boolean and contains vocabulary, including the split-up words of "does not contain"', () => {
    // Quote-stripping tokenizes 'does not contain' into three separate
    // words, which is why 'contain' (not 'containing') is in the keyword set.
    expect(expressionRefs("symptoms does not contain 'fever' and age > 5")).toEqual([
      'symptoms',
      'age',
    ]);
  });

  it('never matches a bare number', () => {
    expect(expressionRefs('age >= 18 and weight <= 200')).toEqual(['age', 'weight']);
  });

  it('strips quoted literals before matching, so a quoted comparison value is not a reference', () => {
    // Matches the Python's known false-positive: an UNQUOTED literal like
    // "q1 = yes" reports 'yes' as a field. Quoting it is the escape hatch.
    expect(expressionRefs("status = 'yes'")).toEqual(['status']);
  });

  it('deduplicates repeated references', () => {
    expect(expressionRefs('age > 5 and age < 65')).toEqual(['age']);
  });

  it('is case-insensitive about keywords but preserves reference casing', () => {
    expect(expressionRefs('Age > 5 AND Age < 65')).toEqual(['Age']);
  });
});

describe('placeholderRefs', () => {
  it('extracts a bracketed reference', () => {
    expect(placeholderRefs("What is [[child_name]]'s age?")).toEqual(['child_name']);
  });

  it('extracts multiple distinct placeholders in order', () => {
    expect(placeholderRefs('[[a]] and [[b]] and [[a]] again')).toEqual(['a', 'b']);
  });

  it('returns empty for text with no placeholders, undefined, or empty string', () => {
    expect(placeholderRefs('no brackets here')).toEqual([]);
    expect(placeholderRefs(undefined)).toEqual([]);
    expect(placeholderRefs('')).toEqual([]);
  });
});

describe('unwrapRef', () => {
  it('unwraps a bracketed reference', () => {
    expect(unwrapRef('[[dob]]')).toBe('dob');
  });

  it('leaves a bare field name untouched', () => {
    expect(unwrapRef('dob')).toBe('dob');
  });

  it('leaves a literal date untouched', () => {
    expect(unwrapRef('2025-03-31')).toBe('2025-03-31');
  });
});

describe('calculationRefs', () => {
  it('extracts a bare lookup field', () => {
    expect(calculationRefs({ type: 'lookup', field: 'dob' })).toEqual([
      { name: 'dob', path: 'field', origin: 'field' },
    ]);
  });

  it('unwraps a hand-typed [[field]] reference, since the editor is free text', () => {
    // The parser only unwraps `field` for calc types whose spec marks
    // fieldIsRef; CalculationEditor's inputs don't enforce that, so an
    // author can type the brackets themselves.
    expect(calculationRefs({ type: 'lookup', field: '[[dob]]' })).toEqual([
      { name: 'dob', path: 'field', origin: 'field' },
    ]);
  });

  it('scans separator for placeholders only, matching age_at_date\'s target-date usage', () => {
    const calc: CalculationConfig = {
      type: 'age_at_date',
      field: 'dob',
      value: 'years',
      separator: '[[startdate]]',
    };
    expect(calculationRefs(calc)).toEqual([
      { name: 'dob', path: 'field', origin: 'field' },
      { name: 'startdate', path: 'separator', origin: 'placeholder' },
    ]);
  });

  it('does not treat an age unit word or a date offset as a reference', () => {
    expect(calculationRefs({ type: 'age_at_date', field: 'dob', value: 'years', separator: '2025-03-31' }))
      .toEqual([{ name: 'dob', path: 'field', origin: 'field' }]);
    expect(calculationRefs({ type: 'date_offset', field: 'startdate', value: '+28d' })).toEqual([
      { name: 'startdate', path: 'field', origin: 'field' },
    ]);
  });

  it('walks nested math/concat parts with a positional path', () => {
    const calc: CalculationConfig = {
      type: 'math',
      operator: '*',
      parts: [
        { type: 'lookup', field: 'weight_kg' },
        {
          type: 'math',
          operator: '+',
          parts: [
            { type: 'lookup', field: 'dose_count' },
            { type: 'constant', value: '1' },
          ],
        },
      ],
    };
    expect(calculationRefs(calc)).toEqual([
      { name: 'weight_kg', path: 'parts[0].field', origin: 'field' },
      { name: 'dose_count', path: 'parts[1].parts[0].field', origin: 'field' },
    ]);
  });

  it('walks case branches, their results, and the else default', () => {
    const calc: CalculationConfig = {
      type: 'case',
      cases: [
        { id: 'c0', field: 'severity', operator: '=', value: '0', result: { type: 'constant', value: 'Low' } },
        {
          id: 'c1',
          field: 'severity',
          operator: '>=',
          value: '1',
          result: { type: 'lookup', field: 'weight_kg' },
        },
      ],
      defaultResult: { type: 'lookup', field: 'fallback_field' },
    };
    expect(calculationRefs(calc)).toEqual([
      { name: 'severity', path: 'cases[0]', origin: 'case' },
      { name: 'severity', path: 'cases[1]', origin: 'case' },
      { name: 'weight_kg', path: 'cases[1].result.field', origin: 'field' },
      { name: 'fallback_field', path: 'defaultResult.field', origin: 'field' },
    ]);
  });

  it('extracts query parameter fields and placeholders in sql', () => {
    const calc: CalculationConfig = {
      type: 'query',
      sql: 'SELECT x FROM t WHERE hhid = [[hhid]] AND a = @a',
      params: [{ name: '@a', field: 'zero_option' }],
    };
    expect(calculationRefs(calc)).toEqual([
      { name: 'hhid', path: 'sql', origin: 'placeholder' },
      { name: 'zero_option', path: 'params[0]', origin: 'param' },
    ]);
  });

  it('returns empty for an undefined calculation', () => {
    expect(calculationRefs(undefined)).toEqual([]);
  });
});
