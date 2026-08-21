import { describe, it, expect } from 'vitest';
import {
  GENERATED_END_TEXT,
  LEADING_SYSTEM_FIELDS,
  TRAILING_SYSTEM_FIELDS,
  isKnownAutomaticFieldname,
  isReservedFieldname,
  stripGeneratedQuestions,
  withSystemFields,
} from '../systemFields';
import type { SurveyQuestion } from '@/types/survey';

const q = (fieldname: string, text = 'Q'): SurveyQuestion => ({
  id: fieldname,
  type: 'text',
  fieldname,
  fieldtype: 'text',
  text,
});

const names = (list: SurveyQuestion[]) => list.map((x) => x.fieldname);

describe('withSystemFields', () => {
  it('brackets the authored questions and ends with the end screen', () => {
    const out = withSystemFields([q('a'), q('b')]);

    expect(names(out)).toEqual([
      'starttime',
      'startdate',
      'a',
      'b',
      'uniqueid',
      'swver',
      'survey_id',
      'lastmod',
      'stoptime',
      'end_of_questions',
    ]);
  });

  it('is idempotent -- applying it to its own output changes nothing', () => {
    // This is what lets a SurveyGen package be imported, saved and re-exported
    // without accumulating duplicate system rows.
    const once = withSystemFields([q('a')]);
    expect(withSystemFields(once)).toEqual(once);
  });

  it('drops a hand-declared reserved field rather than emitting it twice', () => {
    const out = withSystemFields([q('starttime'), q('a'), q('uniqueid')]);
    expect(names(out).filter((n) => n === 'starttime')).toHaveLength(1);
    expect(names(out).filter((n) => n === 'uniqueid')).toHaveLength(1);
    expect(names(out)[0]).toBe('starttime');
  });

  it('matches reserved names case-insensitively', () => {
    const out = withSystemFields([{ ...q('UniqueID'), fieldname: 'UniqueID' }, q('a')]);
    expect(names(out).filter((n) => n.toLowerCase() === 'uniqueid')).toEqual(['uniqueid']);
  });

  it('never strips a Computed Automatic Variable -- those are authored', () => {
    const out = withSystemFields([q('doy'), q('yy'), q('a')]);
    expect(names(out)).toContain('doy');
    expect(names(out)).toContain('yy');
  });

  it('uses the app-owned wording by default so a French build can translate it', () => {
    const out = withSystemFields([q('a')]);
    expect(out[out.length - 1].text).toBe(GENERATED_END_TEXT);
  });

  it('keeps custom end-screen wording when given', () => {
    const out = withSystemFields([q('a')], 'All done, thank you.');
    expect(out[out.length - 1].text).toBe('All done, thank you.');
  });

  it('gives every system field the fieldtype the app expects', () => {
    const out = withSystemFields([q('a')]);
    const byName = new Map(out.map((x) => [x.fieldname, x.fieldtype]));
    for (const f of [...LEADING_SYSTEM_FIELDS, ...TRAILING_SYSTEM_FIELDS]) {
      expect(byName.get(f.fieldname)).toBe(f.fieldtype);
    }
  });

  it('emits uniqueid even for a form with no questions at all', () => {
    // Without it every collected row is skipped at upload.
    expect(names(withSystemFields([]))).toContain('uniqueid');
  });
});

describe('stripGeneratedQuestions', () => {
  it('is the inverse of withSystemFields for authored content', () => {
    const authored = [q('a'), q('b')];
    expect(stripGeneratedQuestions(withSystemFields(authored)).questions).toEqual(authored);
  });

  it('reports custom end-screen text but not the generated default', () => {
    expect(stripGeneratedQuestions(withSystemFields([q('a')])).endText).toBeUndefined();
    expect(
      stripGeneratedQuestions(withSystemFields([q('a')], 'Custom ending')).endText,
    ).toBe('Custom ending');
  });
});

describe('name classification', () => {
  it('separates reserved from computed-automatic', () => {
    expect(isReservedFieldname('uniqueid')).toBe(true);
    expect(isReservedFieldname('STOPTIME')).toBe(true);
    expect(isReservedFieldname('doy')).toBe(false);

    expect(isKnownAutomaticFieldname('doy')).toBe(true);
    expect(isKnownAutomaticFieldname('yyyy')).toBe(true);
    expect(isKnownAutomaticFieldname('uniqueid')).toBe(false);
  });
});
