/**
 * A `SurveyPackage` built from genuine SurveyGen output -- the same
 * `enrollee.xml` / `vaccination_status.xml` / `survey_manifest.gistx`
 * fixtures `src/lib/xml/__tests__` uses, parsed through the real
 * `parseSurveyDocument` rather than hand-authored.
 *
 * The point is that this fixture cannot be quietly bent to make a rule
 * pass: it is exactly what a real data dictionary produced, run through
 * the real parser. If `clean.test.ts` finds anything wrong with it, the
 * rule is wrong, not the fixture.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSurveyDocument } from '@/lib/xml/form';
import type { IdConfig, SurveyForm, SurveyPackage } from '@/types/survey';

const XML_FIXTURES = join(__dirname, '..', '..', 'xml', '__fixtures__');

interface RawCrf {
  display_order?: number;
  tablename: string;
  displayname: string;
  isbase?: number;
  primarykey?: string;
  linkingfield?: string;
  parenttable?: string;
  idconfig?: IdConfig;
  display_fields?: string;
  entry_condition?: string;
  requireslink?: number;
  auto_start_repeat?: number;
  repeat_enforce_count?: number;
  incrementfield?: string;
}

const manifest = JSON.parse(readFileSync(join(XML_FIXTURES, 'survey_manifest.gistx'), 'utf8')) as {
  surveyName: string;
  surveyId: string;
  databaseName: string;
  crfs: RawCrf[];
};

function formOf(crf: RawCrf): SurveyForm {
  const xml = readFileSync(join(XML_FIXTURES, `${crf.tablename}.xml`), 'utf8');
  const { questions } = parseSurveyDocument(xml);

  return {
    id: crf.tablename,
    tablename: crf.tablename,
    displayname: crf.displayname,
    displayOrder: crf.display_order ?? 10,
    isBase: crf.isbase === 1,
    primaryKey: crf.primarykey,
    linkingfield: crf.linkingfield,
    parenttable: crf.parenttable,
    idconfig: crf.idconfig,
    displayFields: crf.display_fields,
    entry_condition: crf.entry_condition,
    requiresLink: crf.requireslink as 0 | 1 | undefined,
    incrementField: crf.incrementfield,
    autoStartRepeat: (crf.auto_start_repeat ?? 0) as 0 | 1 | 2,
    repeatEnforceCount: (crf.repeat_enforce_count ?? 0) as 0 | 1 | 2 | 3,
    questions,
  };
}

export function buildRealPackage(): SurveyPackage {
  return {
    id: 'real-package',
    surveyId: manifest.surveyId,
    name: manifest.surveyName,
    databaseName: manifest.databaseName,
    forms: manifest.crfs.map(formOf),
    csvFiles: [{ id: 'villages', filename: 'villages.csv', content: '' }],
  };
}
