import { describe, it, expect } from 'vitest';
import { buildFormScope } from '../scope';
import type { SurveyForm, SurveyQuestion } from '@/types/survey';

const q = (fieldname: string): SurveyQuestion => ({
  id: fieldname,
  type: 'text',
  fieldname,
  fieldtype: 'text',
  text: 'Q',
});

const formOf = (questions: SurveyQuestion[], extra: Partial<SurveyForm> = {}): SurveyForm => ({
  id: 'f1',
  tablename: 't',
  displayname: 'T',
  displayOrder: 10,
  autoStartRepeat: 0,
  repeatEnforceCount: 0,
  questions,
  ...extra,
});

describe('buildFormScope resolve', () => {
  it('resolves an authored field to its index', () => {
    const scope = buildFormScope(formOf([q('a'), q('b'), q('c')]));
    expect(scope.resolve('b')).toEqual({ kind: 'authored', index: 1 });
  });

  it('resolves leading system fields as legal to read, without an index', () => {
    const scope = buildFormScope(formOf([q('a')]));
    expect(scope.resolve('starttime')).toEqual({ kind: 'leadingSystem' });
    expect(scope.resolve('startdate')).toEqual({ kind: 'leadingSystem' });
  });

  it('resolves trailing system fields distinctly -- these are the ones still empty during the interview', () => {
    const scope = buildFormScope(formOf([q('a')]));
    for (const name of ['uniqueid', 'swver', 'survey_id', 'lastmod', 'stoptime']) {
      expect(scope.resolve(name)).toEqual({ kind: 'trailingSystem' });
    }
  });

  it('resolves a declared Computed Automatic Variable as authored, since it has a real position', () => {
    const scope = buildFormScope(formOf([q('a'), q('doy'), q('b')]));
    expect(scope.resolve('doy')).toEqual({ kind: 'authored', index: 1 });
  });

  it('resolves an UNdeclared Computed Automatic Variable to the automatic kind, not authored', () => {
    const scope = buildFormScope(formOf([q('a')]));
    expect(scope.resolve('doy')).toEqual({ kind: 'automatic' });
  });

  it('resolves an unknown name', () => {
    const scope = buildFormScope(formOf([q('a')]));
    expect(scope.resolve('nonexistent')).toEqual({ kind: 'unknown' });
  });

  it('is case-insensitive', () => {
    const scope = buildFormScope(formOf([q('dob')]));
    expect(scope.resolve('DOB')).toEqual({ kind: 'authored', index: 0 });
    expect(scope.resolve('UniqueID')).toEqual({ kind: 'trailingSystem' });
  });

  it('a hand-declared reserved field still resolves as reserved, not authored', () => {
    // withSystemFields drops a hand-declared 'uniqueid' and re-injects its
    // own at generation time -- declaring one must not make a reference to
    // it legal, or an author could read a value that was never actually
    // computed from their row.
    const scope = buildFormScope(formOf([q('a'), q('uniqueid'), q('b')]));
    expect(scope.resolve('uniqueid')).toEqual({ kind: 'trailingSystem' });
  });

  it('a duplicate fieldname resolves to the FIRST occurrence', () => {
    const scope = buildFormScope(formOf([q('a'), q('dup'), q('b'), q('dup')]));
    expect(scope.resolve('dup')).toEqual({ kind: 'authored', index: 1 });
  });
});

describe('buildFormScope.suppliedAutoFields', () => {
  it('collects primaryKey and displayFields as comma-split lists', () => {
    const scope = buildFormScope(
      formOf([], { primaryKey: 'subjid, barcode', displayFields: 'startdate,name' }),
    );
    expect(scope.suppliedAutoFields).toEqual(new Set(['subjid', 'barcode', 'startdate', 'name']));
  });

  it('collects linkingfield and incrementField', () => {
    const scope = buildFormScope(
      formOf([], { linkingfield: 'hhid', incrementField: 'linenum' }),
    );
    expect(scope.suppliedAutoFields).toEqual(new Set(['hhid', 'linenum']));
  });

  it('collects idconfig field names', () => {
    const scope = buildFormScope(
      formOf([], {
        idconfig: {
          prefix: '',
          fields: [{ name: 'country', length: 1 }, { name: 'yy', length: 2 }],
          incrementLength: 4,
        },
      }),
    );
    expect(scope.suppliedAutoFields).toEqual(new Set(['country', 'yy']));
  });

  it('is empty when the form declares no manifest configuration', () => {
    const scope = buildFormScope(formOf([q('a')]));
    expect(scope.suppliedAutoFields.size).toBe(0);
  });
});
