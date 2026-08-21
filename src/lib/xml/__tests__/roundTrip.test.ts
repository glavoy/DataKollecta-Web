/**
 * Round-trip fidelity against real SurveyGen output.
 *
 * The fixtures are the unmodified contents of
 * `DataKollecta-SurveyGen/sample_outputs/avert_ug_2026_07-13.zip`. If this
 * suite is green, the TypeScript pipeline can read anything the Python
 * generator produces and write it back without losing information -- which is
 * the whole point of having two generators for one format.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonical, canonicalToString, fieldnamesOf, questionsOf } from '../canonical';
import { generateFormXml, parseSurveyDocument } from '../form';
import {
  END_OF_QUESTIONS_FIELDNAME,
  LEADING_SYSTEM_FIELDS,
  TRAILING_SYSTEM_FIELDS,
} from '../systemFields';
import type { SurveyForm } from '@/types/survey';

const FIXTURES = join(__dirname, '..', '__fixtures__');
const NAMES = ['enrollee', 'vaccination_status'] as const;

const load = (name: string) => readFileSync(join(FIXTURES, `${name}.xml`), 'utf8');

function formOf(xml: string, tablename: string): SurveyForm {
  const { questions, endText } = parseSurveyDocument(xml);
  return {
    id: tablename,
    tablename,
    displayname: tablename,
    displayOrder: 10,
    autoStartRepeat: 0,
    repeatEnforceCount: 0,
    endOfQuestionsText: endText,
    questions,
  };
}

/** Parse -> generate -> parse, for asserting the model survives a round trip. */
const reparse = (xml: string, name: string) =>
  parseSurveyDocument(generateFormXml(formOf(xml, name))).questions;

describe.each(NAMES)('%s.xml', (name) => {
  const original = load(name);

  it('parses to a non-trivial question list', () => {
    const { questions } = parseSurveyDocument(original);
    expect(questions.length).toBeGreaterThan(20);
  });

  it('is idempotent: parse(generate(parse(x))) equals parse(x)', () => {
    const once = parseSurveyDocument(original).questions;
    const twice = reparse(original, name);
    expect(twice).toEqual(once);
  });

  it('regenerates every authored question, in order', () => {
    const authored = parseSurveyDocument(original).questions.map((q) => q.fieldname);
    const emitted = fieldnamesOf(canonical(generateFormXml(formOf(original, name))));

    const systemNames = new Set<string>([
      ...LEADING_SYSTEM_FIELDS.map((f) => f.fieldname),
      ...TRAILING_SYSTEM_FIELDS.map((f) => f.fieldname),
      END_OF_QUESTIONS_FIELDNAME,
    ]);

    expect(emitted.filter((f) => !systemNames.has(f))).toEqual(authored);
  });

  it('preserves every calculation node exactly', () => {
    // Calculations are where the attribute-semantics bugs lived, so compare
    // them structurally rather than trusting the model comparison alone.
    const calcsOf = (xml: string) =>
      questionsOf(canonical(xml))
        .flatMap((q) => q.children.filter((c) => c.name === 'calculation'))
        .map((c) => canonicalToString(c));

    const before = calcsOf(original);
    const after = calcsOf(generateFormXml(formOf(original, name)));

    expect(before.length).toBeGreaterThan(0);
    expect(after).toEqual(before);
  });

  it('preserves response blocks exactly', () => {
    const responsesOf = (xml: string) =>
      questionsOf(canonical(xml))
        .flatMap((q) => q.children.filter((c) => c.name === 'responses'))
        .map((c) => canonicalToString(c));

    const before = responsesOf(original);
    const after = responsesOf(generateFormXml(formOf(original, name)));

    expect(before.length).toBeGreaterThan(0);
    expect(after).toEqual(before);
  });

  it('preserves skip logic exactly', () => {
    const skipsOf = (xml: string) =>
      questionsOf(canonical(xml))
        .flatMap((q) => q.children.filter((c) => c.name === 'preskip' || c.name === 'postskip'))
        .map((c) => canonicalToString(c));

    const before = skipsOf(original);
    const after = skipsOf(generateFormXml(formOf(original, name)));

    expect(before.length).toBeGreaterThan(0);
    expect(after).toEqual(before);
  });

  it('never emits two <responses> blocks in one question', () => {
    // The app reads only the first, so a second would be silently discarded.
    for (const q of questionsOf(canonical(generateFormXml(formOf(original, name))))) {
      expect(q.children.filter((c) => c.name === 'responses').length).toBeLessThanOrEqual(1);
    }
  });
});

describe('consumer-shape invariants', () => {
  const xml = generateFormXml(formOf(load('enrollee'), 'enrollee'));
  const doc = canonical(xml);
  const names = fieldnamesOf(doc);

  it('emits uniqueid, without which no record can ever sync', () => {
    expect(names).toContain('uniqueid');
  });

  it('puts starttime and startdate before the first authored question', () => {
    expect(names[0]).toBe('starttime');
    expect(names[1]).toBe('startdate');
  });

  it('puts the trailing system fields after the last authored question and before the end screen', () => {
    const tail = TRAILING_SYSTEM_FIELDS.map((f) => f.fieldname);
    expect(names.slice(-(tail.length + 1), -1)).toEqual(tail);
    expect(names[names.length - 1]).toBe(END_OF_QUESTIONS_FIELDNAME);
  });

  it('gives each system field the fieldtype the app expects', () => {
    const byName = new Map(questionsOf(doc).map((q) => [q.attrs.fieldname, q.attrs.fieldtype]));
    for (const f of [...LEADING_SYSTEM_FIELDS, ...TRAILING_SYSTEM_FIELDS]) {
      expect(byName.get(f.fieldname)).toBe(f.fieldtype);
    }
  });

  it('every <when> has exactly one <result>', () => {
    const whens = questionsOf(doc)
      .flatMap((q) => q.children.filter((c) => c.name === 'calculation'))
      .flatMap((c) => c.children.filter((w) => w.name === 'when'));

    expect(whens.length).toBeGreaterThan(0);
    for (const w of whens) {
      expect(w.children.filter((c) => c.name === 'result')).toHaveLength(1);
    }
  });

  it('every age_at_date carries a separator and a unit the app understands', () => {
    const ages = questionsOf(doc)
      .flatMap((q) => q.children.filter((c) => c.name === 'calculation'))
      .filter((c) => c.attrs.type === 'age_at_date');

    expect(ages.length).toBeGreaterThan(0);
    for (const a of ages) {
      expect(a.attrs.separator ?? '').not.toBe('');
      expect(['years', 'months', 'days']).toContain(a.attrs.value);
    }
  });
});
