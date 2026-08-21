import { describe, it, expect } from 'vitest';
import { el, textEl, blankToUndefined, renderDocument } from '../emit';
import { canonical } from '../canonical';

describe('renderDocument escaping', () => {
  it('escapes every attribute, including ones the old generator emitted raw', () => {
    // The old generic-calculation branch escaped nothing, so a `math`
    // expression containing `<` produced XML that would not parse.
    const xml = renderDocument(
      el('survey', {}, [el('calculation', { type: 'math', value: 'a < b & c > d' })]),
    );

    expect(xml).toContain(`value='a &lt; b &amp; c &gt; d'`);
    expect(() => canonical(xml)).not.toThrow();
  });

  it("escapes apostrophes, which would otherwise terminate the attribute", () => {
    const xml = renderDocument(el('r', {}, [el('dont_know', { label: "Don't know" })]));

    expect(xml).toContain(`label='Don&apos;t know'`);
    expect(canonical(xml).children[0].attrs.label).toBe("Don't know");
  });

  it('escapes text content', () => {
    const xml = renderDocument(el('q', {}, [textEl('text', 'Is a < b & c?')!]));

    expect(xml).toContain('Is a &lt; b &amp; c?');
    expect(canonical(xml).children[0].text).toBe('Is a < b & c?');
  });
});

describe('renderDocument value retention', () => {
  it("keeps '0', 0, false and '' -- omitting only undefined and null", () => {
    const xml = renderDocument(
      el('survey', {}, [
        el('result', {
          zeroStr: '0',
          zeroNum: 0,
          no: false,
          empty: '',
          gone: undefined,
          alsoGone: null,
        }),
      ]),
    );

    expect(xml).toContain(`zeroStr='0'`);
    expect(xml).toContain(`zeroNum='0'`);
    expect(xml).toContain(`no='false'`);
    expect(xml).toContain(`empty=''`);
    expect(xml).not.toContain('gone=');
    expect(xml).not.toContain('alsoGone=');
  });

  it('keeps a 0 text node, which a truthiness guard would drop', () => {
    const xml = renderDocument(el('q', {}, [textEl('maxCharacters', 0)!]));
    expect(xml).toContain('<maxCharacters>0</maxCharacters>');
  });

  it('textEl returns undefined only for undefined/null', () => {
    expect(textEl('a', undefined)).toBeUndefined();
    expect(textEl('a', null)).toBeUndefined();
    expect(textEl('a', '')).toBeDefined();
    expect(textEl('a', 0)).toBeDefined();
  });

  it('blankToUndefined is the explicit opt-in for dropping blanks', () => {
    expect(blankToUndefined('')).toBeUndefined();
    expect(blankToUndefined(undefined)).toBeUndefined();
    expect(blankToUndefined('x')).toBe('x');
    expect(blankToUndefined('0')).toBe('0');
  });
});

describe('renderDocument structure', () => {
  it('drops false/null/undefined children so callers can use `cond && el()`', () => {
    const xml = renderDocument(
      el('survey', {}, [el('a'), false, null, undefined, el('b')]),
    );
    const kids = canonical(xml).children.map((c) => c.name);
    expect(kids).toEqual(['a', 'b']);
  });

  it('emits an explicit open/close pair for a childless, textless element', () => {
    // Matches how SurveyGen writes bare automatic questions, which keeps a
    // diff between the two generators readable.
    const xml = renderDocument(
      el('survey', {}, [el('question', { type: 'automatic', fieldname: 'doy' })]),
    );
    expect(xml).toContain(`<question type='automatic' fieldname='doy'></question>`);
  });
});
