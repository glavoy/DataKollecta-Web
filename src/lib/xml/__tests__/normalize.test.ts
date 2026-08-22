import { describe, it, expect } from 'vitest';
import { normalizeStoredQuestions } from '../normalize';
import { GENERATED_END_TEXT, withSystemFields } from '../systemFields';
import type { SurveyQuestion } from '@/types/survey';

const q = (fieldname: string, text = 'Q'): SurveyQuestion => ({
  id: fieldname,
  type: 'text',
  fieldname,
  fieldtype: 'text',
  text,
});

const names = (list: SurveyQuestion[]) => list.map((x) => x.fieldname);

describe('normalizeStoredQuestions', () => {
  it('strips a stored array that still carries the generated system fields and end screen', () => {
    // The exact shape a package saved before the import-side strip
    // (fc08169) would have persisted: withSystemFields' own output, round-
    // tripped straight into crfs.fields with nothing removed.
    const stored = withSystemFields([q('a'), q('b')]);
    expect(names(stored)).toContain('starttime');
    expect(names(stored)).toContain('end_of_questions');

    const result = normalizeStoredQuestions(stored);

    expect(names(result.questions)).toEqual(['a', 'b']);
  });

  it('recovers a customised end-screen text, but not the generated default', () => {
    const withCustomEnd = withSystemFields([q('a')], 'Thanks for your time');
    expect(normalizeStoredQuestions(withCustomEnd).endText).toBe('Thanks for your time');

    const withDefaultEnd = withSystemFields([q('a')]);
    expect(
      names(withDefaultEnd).includes('end_of_questions') &&
        withDefaultEnd.find((x) => x.fieldname === 'end_of_questions')?.text,
    ).toBe(GENERATED_END_TEXT);
    expect(normalizeStoredQuestions(withDefaultEnd).endText).toBeUndefined();
  });

  it('leaves an already-clean stored array\'s fieldnames and count untouched', () => {
    // upgradeQuestion legitimately adds a default responseMode, so this
    // checks the strip didn't drop or reorder anything, not byte-identity.
    const clean = [q('a'), q('b'), q('c')];
    expect(names(normalizeStoredQuestions(clean).questions)).toEqual(['a', 'b', 'c']);
    expect(normalizeStoredQuestions(clean).endText).toBeUndefined();
  });

  it('still upgrades legacy field shapes on the way through', () => {
    // maxCharacters used to be stored as the raw '=3' string; confirms the
    // pre-existing upgrade step still runs before the new strip.
    const stored = [{ ...q('a'), maxCharacters: '=3' as unknown as number }];
    const result = normalizeStoredQuestions(stored);
    expect(result.questions[0].maxCharacters).toBe(3);
    expect(result.questions[0].fixedLength).toBe(true);
  });

  it('returns an empty result for non-array input', () => {
    expect(normalizeStoredQuestions(null)).toEqual({ questions: [] });
    expect(normalizeStoredQuestions(undefined)).toEqual({ questions: [] });
  });
});
