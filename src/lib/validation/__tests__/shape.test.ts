import { describe, it, expect } from 'vitest';
import { shapeFindings } from '../rules/shape';
import { RULE } from '../types';
import type { SurveyForm, SurveyQuestion } from '@/types/survey';

const q = (overrides: Partial<SurveyQuestion> = {}): SurveyQuestion => ({
  id: 'q1',
  type: 'text',
  fieldname: 'f',
  fieldtype: 'text',
  text: 'Q',
  maxCharacters: 10, // so tests unrelated to width don't trip maxCharsRequired
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

describe('QuestionType x FieldType pairing', () => {
  it('allows integer on a text question, despite excel_reader.py currently rejecting it', () => {
    // The real SurveyGen sample this engine validates against
    // (enrollee.xml) uses type='text' fieldtype='integer' more than twenty
    // times -- direct evidence overriding what the doc/source reads,
    // found by clean.test.ts blocking a real, already-shipped survey.
    const findings = shapeFindings(formOf([q({ type: 'text', fieldtype: 'integer' as never, maxCharacters: 3 })]));
    expect(findings.filter((f) => f.ruleId === RULE.fieldTypeInvalidForQuestionType)).toEqual([]);
  });

  it('requires integer on a radio question', () => {
    const findings = shapeFindings(
      formOf([q({ type: 'radio', fieldtype: 'text' as never, responses: [{ id: 'r1', value: '1', label: 'Yes' }] })]),
    );
    expect(findings).toContainEqual(
      expect.objectContaining({ ruleId: RULE.fieldTypeInvalidForQuestionType, subject: 'text' }),
    );
  });

  it('requires text on a checkbox question', () => {
    const findings = shapeFindings(formOf([q({ type: 'checkbox', fieldtype: 'integer' as never })]));
    expect(findings).toContainEqual(
      expect.objectContaining({ ruleId: RULE.fieldTypeInvalidForQuestionType, subject: 'integer' }),
    );
  });

  it('requires date or datetime on a date/datetime question', () => {
    const findings = shapeFindings(formOf([q({ type: 'date', fieldtype: 'text' as never })]));
    expect(findings).toContainEqual(expect.objectContaining({ ruleId: RULE.fieldTypeInvalidForQuestionType }));
  });

  it('leaves combobox, information, and calculated unconstrained, matching SurveyGen', () => {
    const findings = shapeFindings(
      formOf([
        q({ type: 'combobox', fieldtype: 'text', responses: [{ id: 'r1', value: '1', label: 'Yes' }] }),
        q({ type: 'information', fieldtype: 'n/a', text: 'Info' }),
        q({ type: 'calculated', fieldtype: 'integer', text: '' }),
      ]),
    );
    expect(findings.filter((f) => f.ruleId === RULE.fieldTypeInvalidForQuestionType)).toEqual([]);
  });
});

describe('max characters', () => {
  it('requires it on a plain text question', () => {
    const findings = shapeFindings(formOf([q({ fieldtype: 'text', maxCharacters: undefined })]));
    expect(findings).toEqual([expect.objectContaining({ ruleId: RULE.maxCharsRequired })]);
  });

  it('is satisfied once set', () => {
    const findings = shapeFindings(formOf([q({ fieldtype: 'text', maxCharacters: 80 })]));
    expect(findings).toEqual([]);
  });

  it('is not required for non-text question types', () => {
    const findings = shapeFindings(formOf([q({ type: 'radio', fieldtype: 'integer' })]));
    expect(findings.filter((f) => f.ruleId === RULE.maxCharsRequired)).toEqual([]);
  });

  it('requires exactly =5 for an hourmin field', () => {
    const tooShort = shapeFindings(formOf([q({ fieldtype: 'hourmin', maxCharacters: 4, fixedLength: true })]));
    expect(tooShort).toContainEqual(expect.objectContaining({ ruleId: RULE.maxCharsHourmin }));

    const notFixed = shapeFindings(formOf([q({ fieldtype: 'hourmin', maxCharacters: 5 })]));
    expect(notFixed).toContainEqual(expect.objectContaining({ ruleId: RULE.maxCharsHourmin }));

    const correct = shapeFindings(formOf([q({ fieldtype: 'hourmin', maxCharacters: 5, fixedLength: true })]));
    expect(correct.filter((f) => f.ruleId === RULE.maxCharsHourmin)).toEqual([]);
  });

  it('rejects a numeric range on an hourmin field', () => {
    const findings = shapeFindings(
      formOf([
        q({
          fieldtype: 'hourmin',
          maxCharacters: 5,
          fixedLength: true,
          numericCheck: { minValue: 0, maxValue: 100, message: 'm' },
        }),
      ]),
    );
    expect(findings).toEqual([expect.objectContaining({ ruleId: RULE.hourminHasRange })]);
  });
});

describe('numeric range', () => {
  it('is silent when neither bound is set', () => {
    expect(shapeFindings(formOf([q({ fieldtype: 'text_integer', maxCharacters: 3 })]))).toEqual([]);
  });

  it('flags a half-set range, either direction', () => {
    const minOnly = shapeFindings(
      formOf([q({ fieldtype: 'text_integer', maxCharacters: 3, numericCheck: { minValue: 0, message: 'm' } })]),
    );
    expect(minOnly).toEqual([expect.objectContaining({ ruleId: RULE.numericRangeHalfSet })]);

    const maxOnly = shapeFindings(
      formOf([q({ fieldtype: 'text_integer', maxCharacters: 3, numericCheck: { maxValue: 100, message: 'm' } })]),
    );
    expect(maxOnly).toEqual([expect.objectContaining({ ruleId: RULE.numericRangeHalfSet })]);
  });

  it('flags an inverted range -- a check SurveyGen never runs at all', () => {
    const findings = shapeFindings(
      formOf([
        q({ fieldtype: 'text_integer', maxCharacters: 3, numericCheck: { minValue: 100, maxValue: 0, message: 'm' } }),
      ]),
    );
    expect(findings).toEqual([expect.objectContaining({ ruleId: RULE.numericRangeInverted })]);
  });

  it('accepts min === max (a fixed single allowed value)', () => {
    const findings = shapeFindings(
      formOf([
        q({ fieldtype: 'text_integer', maxCharacters: 3, numericCheck: { minValue: 5, maxValue: 5, message: 'm' } }),
      ]),
    );
    expect(findings.filter((f) => f.ruleId === RULE.numericRangeInverted)).toEqual([]);
  });

  it('accepts a real minimum of 0, not confusing it with "unset"', () => {
    const findings = shapeFindings(
      formOf([
        q({ fieldtype: 'text_integer', maxCharacters: 3, numericCheck: { minValue: 0, maxValue: 10, message: 'm' } }),
      ]),
    );
    expect(findings).toEqual([]);
  });
});

describe('date range', () => {
  it('requires both bounds on a date question', () => {
    const findings = shapeFindings(formOf([q({ type: 'date', fieldtype: 'date' })]));
    expect(findings).toEqual([expect.objectContaining({ ruleId: RULE.dateRangeMissing })]);
  });

  it('accepts 0, a signed offset, and a real calendar date', () => {
    const findings = shapeFindings(
      formOf([
        q({ type: 'date', fieldtype: 'date', dateRange: { minDate: '-100y', maxDate: '0' } }),
        q({ type: 'date', fieldtype: 'date', dateRange: { minDate: '2000-01-01', maxDate: '+6m' } }),
      ]),
    );
    expect(findings).toEqual([]);
  });

  it('rejects an impossible calendar date', () => {
    const findings = shapeFindings(
      formOf([q({ type: 'date', fieldtype: 'date', dateRange: { minDate: '2025-02-30', maxDate: '0' } })]),
    );
    expect(findings).toEqual([
      expect.objectContaining({ ruleId: RULE.dateRangeFormat, subject: '2025-02-30' }),
    ]);
  });

  it('rejects a nonsense value', () => {
    const findings = shapeFindings(
      formOf([q({ type: 'date', fieldtype: 'date', dateRange: { minDate: 'yesterday', maxDate: '0' } })]),
    );
    expect(findings).toEqual([expect.objectContaining({ ruleId: RULE.dateRangeFormat, subject: 'yesterday' })]);
  });

  it('applies to datetime questions too', () => {
    const findings = shapeFindings(formOf([q({ type: 'datetime', fieldtype: 'datetime' })]));
    expect(findings).toEqual([expect.objectContaining({ ruleId: RULE.dateRangeMissing })]);
  });

  it('does not apply to non-date questions', () => {
    expect(shapeFindings(formOf([q({ type: 'text', fieldtype: 'text', maxCharacters: 10 })]))).toEqual([]);
  });
});

describe('special answers', () => {
  it('is silent when none are set', () => {
    expect(shapeFindings(formOf([q()]))).toEqual([]);
  });

  it('accepts the conventional sentinels', () => {
    const findings = shapeFindings(formOf([q({ dontKnow: '-7', refuse: '-8' })]));
    expect(findings).toEqual([]);
  });

  it('warns on an unconventional value', () => {
    const findings = shapeFindings(formOf([q({ dontKnow: '99' })]));
    expect(findings).toEqual([
      expect.objectContaining({ ruleId: RULE.specialAnswerUnconventional, severity: 'warning', subject: '99' }),
    ]);
  });

  it('warns when a special value collides with a static response option', () => {
    const findings = shapeFindings(
      formOf([
        q({
          type: 'radio',
          fieldtype: 'integer',
          dontKnow: '2',
          responses: [
            { id: 'r1', value: '1', label: 'Yes' },
            { id: 'r2', value: '2', label: 'No' },
          ],
        }),
      ]),
    );
    expect(findings).toEqual([
      expect.objectContaining({ ruleId: RULE.specialAnswerCollides, severity: 'warning', subject: '2' }),
    ]);
  });

  it('does not port the Excel True/False rule -- the web model stores the emitted sentinel, not the source column value', () => {
    // -7/-8 are the values xml_generator.py actually WRITES; the web
    // model's dontKnow/refuse fields hold that, never 'True'/'False'.
    const findings = shapeFindings(formOf([q({ dontKnow: '-7' })]));
    expect(findings).toEqual([]);
  });
});
