/**
 * `survey_manifest.gistx` generation.
 *
 * Key order follows `json_generator.py`'s CRF_FIELD_ORDER, and null-valued keys
 * are omitted the same way, purely so a human can diff this against SurveyGen
 * output while both generators exist. Nothing downstream depends on the order.
 */

import type { SurveyForm, SurveyPackage } from '@/types/survey';

/** Matches CRF_FIELD_ORDER in the Python generator. */
const CRF_FIELD_ORDER = [
  'display_order',
  'tablename',
  'displayname',
  'isbase',
  'primarykey',
  'linkingfield',
  'idconfig',
  'parenttable',
  'incrementfield',
  'requireslink',
  'repeat_count_source',
  'repeat_count_field',
  'auto_start_repeat',
  'repeat_enforce_count',
  'display_fields',
  'entry_condition',
] as const;

export interface SurveyManifest {
  surveyName: string;
  surveyId: string;
  databaseName: string;
  xmlFiles: string[];
  crfs: Record<string, unknown>[];
}

function isBaseForm(form: SurveyForm): boolean {
  return form.isBase ?? !form.parenttable;
}

function crfOf(form: SurveyForm): Record<string, unknown> {
  const base = isBaseForm(form);

  // Everything a CRF can carry, in one object; the ordering pass below drops
  // whatever is undefined. `primarykey` is deliberately NOT guessed -- the old
  // `|| 'id'` fallback named a column no form has, and the app reads this to
  // label records, so a wrong value shows blank rows in the field rather than
  // failing loudly.
  const all: Record<string, unknown> = {
    display_order: form.displayOrder,
    tablename: form.tablename,
    displayname: form.displayname,
    isbase: base ? 1 : 0,
    primarykey: form.primaryKey,
    linkingfield: form.linkingfield,
    idconfig: form.idconfig
      ? {
          prefix: form.idconfig.prefix,
          fields: form.idconfig.fields,
          incrementLength: form.idconfig.incrementLength,
        }
      : undefined,

    // display_fields and entry_condition apply to base forms too -- the real
    // SurveyGen sample carries display_fields on its base CRF.
    display_fields: form.displayFields,
    entry_condition: form.entry_condition,
  };

  if (!base) {
    all.parenttable = form.parenttable;
    all.incrementfield = form.incrementField;
    all.requireslink = form.requiresLink ?? 1;
    all.repeat_count_source = form.repeatCountSource;
    all.repeat_count_field = form.repeatCountField;

    // Always emitted, including when 0 -- deliberately unlike SurveyGen, which
    // omits a blank spreadsheet cell. The app reads an ABSENT
    // repeat_enforce_count as 1 (warn), so omitting an explicit 0 would turn a
    // designer choice of "flexible" into "warn". A blank Excel cell means
    // "unspecified"; a dropdown always means something.
    all.auto_start_repeat = form.autoStartRepeat ?? 0;
    all.repeat_enforce_count = form.repeatEnforceCount ?? 1;
  } else if (form.requiresLink !== undefined) {
    all.requireslink = form.requiresLink;
  }

  const ordered: Record<string, unknown> = {};
  for (const key of CRF_FIELD_ORDER) {
    const value = all[key];
    if (value === undefined || value === null || value === '') continue;
    ordered[key] = value;
  }
  return ordered;
}

export function buildManifest(pkg: SurveyPackage): SurveyManifest {
  return {
    surveyName: pkg.name,
    surveyId: pkg.surveyId,
    databaseName: pkg.databaseName || `${pkg.surveyId}.sqlite`,
    xmlFiles: pkg.forms.map((f) => `${f.tablename}.xml`),
    crfs: pkg.forms.map(crfOf),
  };
}

export function generateManifestGistx(pkg: SurveyPackage): string {
  return JSON.stringify(buildManifest(pkg), null, 2);
}
