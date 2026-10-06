import { describe, it, expect } from 'vitest';
import {
  buildFormChangesCsv,
  buildSubmissionsCsv,
  declaredColumns,
  EXPORT_META_COLUMNS,
  orderRecordEntries,
  submissionColumns,
  type ExportField,
  type ExportSubmission,
} from '../dataExport';
import { withSystemFields } from '../xml/systemFields';
import type { SurveyQuestion } from '@/types/survey';

/** The header row of a built CSV, BOM stripped and split. */
function headerOf(csv: string): string[] {
  return csv.replace(/^\uFEFF/, '').split('\n')[0].split(',');
}

function submission(
  data: Record<string, unknown>,
  overrides: Partial<ExportSubmission> = {},
): ExportSubmission {
  return {
    local_unique_id: 'row-1',
    surveyor_id: 'prism',
    collected_at: '2026-09-08T13:49:08.820209',
    submitted_at: '2026-09-08T10:50:40.857183+00:00',
    survey_package_id: 'pkg-1',
    data_status: 'deployed',
    data,
    ...overrides,
  };
}

/** The questions a form declares, as `crfs.fields` stores them. */
const HH_INFO_FIELDS: ExportField[] = [
  { fieldname: 'hhid', type: 'automatic' },
  { fieldname: 'enrolled', type: 'radio' },
  { fieldname: 'totals', type: 'information' },
];

describe('submissionColumns', () => {
  it('takes the union across submissions', () => {
    // A v1 row and a v2 row that added a question: both columns appear, and
    // the v1 row is simply blank in the new one -- the same shape the phone's
    // own SQLite reaches after ALTER TABLE.
    expect(
      submissionColumns(
        [
          submission({ hhid: '438020004', enrolled: '1' }),
          submission({ hhid: '438020005', enrolled: '1', nstructures: '2' }),
        ],
        ['hhid', 'enrolled', 'nstructures'],
      ),
    ).toEqual(['hhid', 'enrolled', 'nstructures']);
  });

  it('follows the declared order rather than the alphabet', () => {
    // `submissions.data` is jsonb, so the row itself carries no usable key
    // order -- the form definition is the only source of one.
    expect(
      submissionColumns([submission({ age: '4', nets: '2', hhid: '1' })], [
        'hhid',
        'nets',
        'age',
      ]),
    ).toEqual(['hhid', 'nets', 'age']);
  });

  it('appends a column no version declares, sorted, at the end', () => {
    // A question since renamed or removed still holds data. Dropping it from
    // the export would lose that data silently.
    expect(
      submissionColumns([submission({ hhid: '1', zzz: 'x', aaa: 'y' })], ['hhid']),
    ).toEqual(['hhid', 'aaa', 'zzz']);
  });

  it('omits a declared question that no row ever answered', () => {
    expect(submissionColumns([submission({ hhid: '1' })], ['hhid', 'enrolled'])).toEqual([
      'hhid',
    ]);
  });

  it('falls back to sorted order when nothing is declared', () => {
    expect(submissionColumns([submission({ hhid: '1', enrolled: '1' })])).toEqual([
      'enrolled',
      'hhid',
    ]);
  });

  it('excludes synced_at, which is always empty on the server', () => {
    // The app sets synced_at only AFTER a successful upload, so the value that
    // reaches the server is NULL by construction: an always-empty column in
    // every exported row.
    expect(submissionColumns([submission({ hhid: '1', synced_at: null })])).toEqual(['hhid']);
  });

  it('tolerates a row with no data at all', () => {
    expect(submissionColumns([submission({}, { data: null })])).toEqual([]);
  });
});

describe('declaredColumns', () => {
  it('adds back the reserved system fields stripped on import, in XML order', () => {
    // surveyPackageUpload strips these because they are re-injected at
    // generation time, so a form's stored `fields` never carries them. They
    // bracket the authored questions exactly as the generator writes them.
    expect(declaredColumns(HH_INFO_FIELDS)).toEqual([
      'starttime',
      'startdate',
      'hhid',
      'enrolled',
      'uniqueid',
      'swver',
      'survey_id',
      'lastmod',
      'stoptime',
    ]);
  });

  it('keeps the authored questions in declaration order, not alphabetical', () => {
    // The whole point: `crfs.fields` is a jsonb ARRAY in document order, and
    // sorting it was what made an exported CSV unreadable against the form.
    expect(
      declaredColumns([
        { fieldname: 'zone', type: 'radio' },
        { fieldname: 'age', type: 'integer' },
        { fieldname: 'name', type: 'text' },
      ]).slice(2, 5),
    ).toEqual(['zone', 'age', 'name']);
  });

  it('matches the order the generator writes into the XML', () => {
    // The assertion that ties the export to the generator. `withSystemFields`
    // is what produces the document; if either side's system-field list moves,
    // this fails rather than the CSV quietly disagreeing with the form.
    const questions = HH_INFO_FIELDS.map((f) => ({
      id: f.fieldname,
      type: f.type,
      fieldname: f.fieldname,
      fieldtype: 'text',
      text: '',
    })) as SurveyQuestion[];

    const fromGenerator = withSystemFields(questions, undefined, { hasParent: true })
      .filter((q) => q.type !== 'information')
      .map((q) => q.fieldname);

    expect(declaredColumns(HH_INFO_FIELDS, { hasParent: true })).toEqual(fromGenerator);
  });

  it('puts parent_uniqueid after the trailing system fields', () => {
    const cols = declaredColumns(HH_INFO_FIELDS, { hasParent: true });
    expect(cols[cols.length - 1]).toBe('parent_uniqueid');
  });

  it('drops information questions, which declare no column', () => {
    // `totals` is a screen, not a field -- the app stores nothing for it.
    expect(declaredColumns(HH_INFO_FIELDS)).not.toContain('totals');
  });

  it('includes parent_uniqueid only for a form with a parent', () => {
    expect(declaredColumns(HH_INFO_FIELDS, { hasParent: true })).toContain('parent_uniqueid');
    expect(declaredColumns(HH_INFO_FIELDS, { hasParent: false })).not.toContain(
      'parent_uniqueid',
    );
  });

  it('never declares synced_at, even if a stored field list names it', () => {
    expect(declaredColumns([{ fieldname: 'synced_at', type: 'automatic' }])).not.toContain(
      'synced_at',
    );
  });

  it('ignores a nameless question rather than emitting a blank column', () => {
    expect(declaredColumns([{ fieldname: '  ', type: 'radio' }, { type: 'radio' }])).toEqual(
      declaredColumns([]),
    );
  });

  it('returns the system fields alone for a null field list', () => {
    expect(declaredColumns(null)).toEqual(declaredColumns([]));
  });
});

describe('buildSubmissionsCsv', () => {
  it('leads with the meta columns, then the data columns', () => {
    const csv = buildSubmissionsCsv([submission({ hhid: '438020004' })], { 'pkg-1': 3 });
    expect(headerOf(csv)).toEqual([...EXPORT_META_COLUMNS, 'hhid']);
  });

  it('stamps survey_version from the package map', () => {
    const csv = buildSubmissionsCsv([submission({ hhid: '438020004' })], { 'pkg-1': 3 });
    const firstCell = csv.replace(/^\uFEFF/, '').split('\n')[1].split(',')[0];
    expect(firstCell).toBe('3');
  });

  it('labels every row test or deployed, whatever the export filter was', () => {
    const csv = buildSubmissionsCsv(
      [
        submission({ hhid: '1' }, { local_unique_id: 'row-1', data_status: 'test' }),
        submission({ hhid: '2' }, { local_unique_id: 'row-2', data_status: 'deployed' }),
      ],
      { 'pkg-1': 1 },
    );
    const [header, ...rows] = csv.replace(/^\uFEFF/, '').split('\n');
    const column = header.split(',').indexOf('data_status');
    expect(column).toBe(1);
    expect(rows.map((row) => row.split(',')[column])).toEqual(['test', 'deployed']);
  });

  it('writes a header-only CSV for a form with no rows', () => {
    // The defect this replaces: a form with no submissions was left out of the
    // export zip entirely, so "no nets were collected" and "the export is
    // broken" looked identical to whoever received the file.
    const csv = buildSubmissionsCsv([], {}, declaredColumns(HH_INFO_FIELDS));
    const lines = csv.replace(/^\uFEFF/, '').split('\n');

    expect(lines).toHaveLength(1);
    expect(lines[0].split(',')).toEqual([
      ...EXPORT_META_COLUMNS,
      ...declaredColumns(HH_INFO_FIELDS),
    ]);
  });

  it('gives an empty form the same header as the same form with a row', () => {
    // This is what excluding synced_at buys: it is the only key in `data` with
    // no counterpart in the XML, so without that exclusion the empty header
    // would be exactly one column narrower than the populated one.
    const declared = declaredColumns(HH_INFO_FIELDS);
    const populated = buildSubmissionsCsv(
      [
        submission({
          hhid: '438020004',
          enrolled: '1',
          starttime: '2026-09-08T13:46:25.896627',
          startdate: '2026-09-08',
          stoptime: '2026-09-08T13:49:08.820209',
          lastmod: '2026-09-08T13:50:21.414899',
          uniqueid: 'e7f15122',
          swver: 'DataKollecta 1.4.0+18',
          survey_id: 'prism_css_2026_09_08',
          synced_at: null,
        }),
      ],
      { 'pkg-1': 3 },
      declared,
    );

    expect(headerOf(buildSubmissionsCsv([], {}, declared))).toEqual(headerOf(populated));
  });

  it('takes membership from the rows and order from the declared columns', () => {
    // Real rows are the better authority on WHICH columns exist -- `enrolled`
    // is declared but unanswered, so it stays out -- while the declared list
    // decides what order the ones that do exist appear in.
    const csv = buildSubmissionsCsv(
      [submission({ age: '4', hhid: '438020004' })],
      { 'pkg-1': 3 },
      ['hhid', 'enrolled', 'age'],
    );
    expect(headerOf(csv)).toEqual([...EXPORT_META_COLUMNS, 'hhid', 'age']);
  });

  it('writes each row\'s cells under the header they belong to', () => {
    // The ordering change touches the header and the cells together; this is
    // what catches them drifting apart.
    const csv = buildSubmissionsCsv(
      [submission({ age: '4', hhid: '438020004' })],
      { 'pkg-1': 3 },
      ['hhid', 'age'],
    );
    const [header, row] = csv.replace(/^\uFEFF/, '').split('\n');
    expect(header.split(',').slice(-2)).toEqual(['hhid', 'age']);
    expect(row.split(',').slice(-2)).toEqual(['438020004', '4']);
  });
});

describe('orderRecordEntries', () => {
  it('reads a record in question order rather than jsonb key order', () => {
    expect(
      orderRecordEntries({ age: 4, hhid: '1', starttime: 't' }, [
        'starttime',
        'hhid',
        'age',
      ]).map(([k]) => k),
    ).toEqual(['starttime', 'hhid', 'age']);
  });

  it('drops synced_at, which is NULL on the server by construction', () => {
    expect(orderRecordEntries({ hhid: '1', synced_at: null }, ['hhid'])).toEqual([['hhid', '1']]);
  });

  it('keeps a value no version declares, at the end', () => {
    expect(orderRecordEntries({ legacy: 'x', hhid: '1' }, ['hhid'])).toEqual([
      ['hhid', '1'],
      ['legacy', 'x'],
    ]);
  });
});

describe('buildFormChangesCsv', () => {
  it('writes the audit columns in a fixed order', () => {
    const csv = buildFormChangesCsv([
      {
        formchanges_uuid: '25cc6710',
        record_uuid: 'e7f15122',
        tablename: 'hh_info',
        fieldname: 'nmembers',
        oldvalue: '5',
        newvalue: '1',
        surveyor_id: 'prism',
        changed_at: '2026-09-08T13:50:21.414899',
      },
    ]);
    const lines = csv.replace(/^\uFEFF/, '').split('\n');

    expect(lines[0]).toBe(
      'formchanges_uuid,record_uuid,tablename,fieldname,oldvalue,newvalue,surveyor_id,changed_at,event_time_utc,device_utc_offset_minutes,reason_for_change',
    );
    expect(lines[1]).toBe(
      '25cc6710,e7f15122,hh_info,nmembers,5,1,prism,2026-09-08T13:50:21.414899,,,',
    );
  });
});
