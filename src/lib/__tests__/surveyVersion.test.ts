import { describe, it, expect } from 'vitest';
import {
  versionedSurveyId,
  deriveSurveyCode,
  nextVersionNumber,
  formatVersionLabel,
  groupByLineage,
  versionByPackageId,
  type VersionedSurvey,
} from '../surveyVersion';

const survey = (over: Partial<VersionedSurvey> & { id: string }): VersionedSurvey => ({
  name: over.id,
  display_name: over.id,
  survey_code: 'prism_css',
  version: 1,
  version_date: '2026-07-21',
  ...over,
});

describe('versionedSurveyId', () => {
  it('names the designer-minted survey ID for a version', () => {
    expect(versionedSurveyId('prism_css', 2)).toBe('prism_css_v2');
  });
});

describe('deriveSurveyCode', () => {
  it('strips a trailing version suffix so codes do not compound', () => {
    expect(deriveSurveyCode('prism_css_v2')).toBe('prism_css');
    expect(deriveSurveyCode('prism_css_v10')).toBe('prism_css');
  });

  it('leaves an ID with no version suffix alone', () => {
    expect(deriveSurveyCode('prism_css')).toBe('prism_css');
  });

  it('leaves the team\'s dated IDs alone -- an uploaded package keeps its own ID', () => {
    expect(deriveSurveyCode('prism_css_2026_08_14')).toBe('prism_css_2026_08_14');
  });

  it('does not mistake a mid-string _v<N> for a suffix', () => {
    expect(deriveSurveyCode('study_v2_followup')).toBe('study_v2_followup');
  });
});

describe('nextVersionNumber', () => {
  it('starts a fresh lineage at 1', () => {
    expect(nextVersionNumber([])).toBe(1);
  });

  it('takes the max rather than the count, so a deleted draft leaves a gap', () => {
    // v2 was a draft that got deleted; the next version must still be 4, or the
    // (project_id, survey_code, version) unique constraint would reject it.
    expect(nextVersionNumber([{ version: 1 }, { version: 3 }])).toBe(4);
  });

  it('is order-independent', () => {
    expect(nextVersionNumber([{ version: 3 }, { version: 1 }, { version: 2 }])).toBe(4);
  });
});

describe('formatVersionLabel', () => {
  it('leads with the number and carries the date', () => {
    const label = formatVersionLabel(2, '2026-08-14');
    expect(label.startsWith('v2 · ')).toBe(true);
    expect(label).toContain('2026');
  });

  it('degrades to the number alone on an unparseable date', () => {
    expect(formatVersionLabel(3, 'not-a-date')).toBe('v3');
  });
});

describe('groupByLineage', () => {
  const v1 = survey({ id: 'a', version: 1, version_date: '2026-07-21' });
  const v2 = survey({ id: 'b', version: 2, version_date: '2026-08-14' });
  const other = survey({ id: 'c', survey_code: 'avert', version_date: '2026-09-01' });

  it('groups versions of one survey and puts the newest first', () => {
    const [lineage] = groupByLineage([v1, v2]);
    expect(lineage.surveyCode).toBe('prism_css');
    expect(lineage.latest).toBe(v2);
    expect(lineage.versions.map((v) => v.version)).toEqual([2, 1]);
  });

  it('orders by version number, not by date -- two revisions can share a day', () => {
    const sameDay = survey({ id: 'd', version: 3, version_date: '2026-08-14' });
    const [lineage] = groupByLineage([v2, sameDay, v1]);
    expect(lineage.versions.map((v) => v.version)).toEqual([3, 2, 1]);
  });

  it('keeps separate codes as separate lineages', () => {
    const lineages = groupByLineage([v1, v2, other]);
    expect(lineages).toHaveLength(2);
    expect(lineages[0].surveyCode).toBe('avert');
  });

  it('returns nothing for no surveys', () => {
    expect(groupByLineage([])).toEqual([]);
  });
});

describe('versionByPackageId', () => {
  it('maps package ids to version numbers for the merged CSV export', () => {
    expect(
      versionByPackageId([
        { id: 'pkg-1', version: 1 },
        { id: 'pkg-2', version: 2 },
      ])
    ).toEqual({ 'pkg-1': 1, 'pkg-2': 2 });
  });
});
