import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildManifest } from '../manifest';
import type { SurveyForm, SurveyPackage } from '@/types/survey';

const sample = JSON.parse(
  readFileSync(join(__dirname, '..', '__fixtures__', 'survey_manifest.gistx'), 'utf8'),
);

/** The two forms of the AVERT sample, as the designer would hold them. */
const enrollee: SurveyForm = {
  id: 'f1',
  tablename: 'enrollee',
  displayname: 'Enrollee',
  displayOrder: 10,
  primaryKey: 'subjid',
  linkingfield: 'barcode',
  displayFields: 'startdate,participantsname',
  idconfig: {
    prefix: '',
    fields: [
      { name: 'country', length: 1 },
      { name: 'deviceid', length: 3 },
      { name: 'mrc', length: 3 },
    ],
    incrementLength: 4,
  },
  autoStartRepeat: 0,
  repeatEnforceCount: 0,
  questions: [],
};

const vaccination: SurveyForm = {
  id: 'f2',
  tablename: 'vaccination_status',
  displayname: 'Vaccination Status',
  displayOrder: 20,
  primaryKey: 'barcode',
  linkingfield: 'barcode',
  parenttable: 'enrollee',
  displayFields: 'barcode,participantsname',
  entry_condition: 'need_vac_cov=1',
  autoStartRepeat: 0,
  repeatEnforceCount: 1,
  questions: [],
};

const pkg: SurveyPackage = {
  id: 'p1',
  surveyId: 'avert_ug_2026_07-13',
  name: 'AVERT UG 2026-07-13',
  databaseName: 'avert_ug_2026_07-13.sqlite',
  forms: [enrollee, vaccination],
};

const manifest = buildManifest(pkg);
const base = manifest.crfs[0];
const child = manifest.crfs[1];

describe('manifest header', () => {
  it('matches the SurveyGen sample', () => {
    expect(manifest.surveyName).toBe(sample.surveyName);
    expect(manifest.surveyId).toBe(sample.surveyId);
    expect(manifest.databaseName).toBe(sample.databaseName);
    expect(manifest.xmlFiles).toEqual(sample.xmlFiles);
  });

  it('derives databaseName from surveyId only when not given', () => {
    expect(buildManifest({ ...pkg, databaseName: undefined }).databaseName).toBe(
      'avert_ug_2026_07-13.sqlite',
    );
  });
});

describe('base CRF', () => {
  it('carries display_fields -- which the old generator dropped on base forms', () => {
    expect(base.display_fields).toBe('startdate,participantsname');
  });

  it('matches the sample on every key the sample has', () => {
    for (const [key, value] of Object.entries(sample.crfs[0])) {
      expect({ [key]: base[key] }).toEqual({ [key]: value });
    }
  });

  it('omits requireslink, as the sample does', () => {
    expect(base).not.toHaveProperty('requireslink');
  });

  it('omits child-only repeat settings', () => {
    expect(base).not.toHaveProperty('auto_start_repeat');
    expect(base).not.toHaveProperty('repeat_enforce_count');
    expect(base).not.toHaveProperty('parenttable');
  });

  it('keeps an empty idconfig prefix rather than dropping it', () => {
    expect((base.idconfig as { prefix: string }).prefix).toBe('');
  });

  it('follows the reference generator key order, for diffability', () => {
    expect(Object.keys(base)).toEqual(Object.keys(sample.crfs[0]));
  });
});

describe('child CRF', () => {
  it('matches the sample on every key the sample has', () => {
    for (const [key, value] of Object.entries(sample.crfs[1])) {
      expect({ [key]: child[key] }).toEqual({ [key]: value });
    }
  });

  it('always states the repeat settings explicitly', () => {
    // Absent repeat_enforce_count means 1 (warn) to the app, so an explicit
    // designer choice of 0 (flexible) must be written, not omitted.
    expect(child.auto_start_repeat).toBe(0);
    expect(child.repeat_enforce_count).toBe(1);

    const flexible = buildManifest({
      ...pkg,
      forms: [enrollee, { ...vaccination, repeatEnforceCount: 0 }],
    }).crfs[1];
    expect(flexible.repeat_enforce_count).toBe(0);
  });
});

describe('primarykey is never guessed', () => {
  it('is omitted when unset rather than defaulting to a column no form has', () => {
    const out = buildManifest({ ...pkg, forms: [{ ...enrollee, primaryKey: undefined }] });
    expect(out.crfs[0]).not.toHaveProperty('primarykey');
  });
});
