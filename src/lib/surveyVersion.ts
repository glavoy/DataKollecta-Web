/**
 * Survey versions. A revision of a deployed survey is a new version of the SAME
 * survey, not a new survey: every version of one `survey_code` declares the same
 * manifest `databaseName`, so on the device they open one SQLite file and their
 * data forms one dataset (see the survey_versions migration).
 *
 * `version` is the canonical ordering. `version_date` is a display date -- it is
 * shown alongside the number, never used to order, because two revisions can
 * land on one day.
 *
 * Two naming rules, deliberately different (this file only implements the first):
 *
 *  - The DESIGNER owns the survey ID it creates, so a new version is named
 *    `versionedSurveyId(code, n)`.
 *  - An UPLOADED package keeps its manifest's `surveyId` verbatim. That string
 *    is already the zip filename and the phone's extraction folder, and
 *    db_service.dart resolves a survey's XML at `surveys/<surveyId>/<file>` --
 *    rewriting it to `code_vN` would break that invariant on the device.
 *
 * So `name` and `versionedSurveyId(...)` may legitimately diverge for uploaded
 * versions. `name` only has to be unique; `version` is what orders them.
 */

/** A survey row, reduced to what version grouping actually needs. */
export interface VersionedSurvey {
  id: string;
  name: string;
  display_name: string;
  survey_code: string;
  version: number;
  version_date: string;
}

/** One survey and all its versions, newest first. */
export interface SurveyLineage<T extends VersionedSurvey> {
  surveyCode: string;
  /** The highest-numbered version -- what the collapsed list row represents. */
  latest: T;
  /** Every version, highest first. */
  versions: T[];
}

/** The survey ID the designer mints for version `version` of `code`. */
export function versionedSurveyId(code: string, version: number): string {
  return `${code}_v${version}`;
}

/**
 * The lineage code implied by an existing survey ID, for backfilled rows and
 * for seeding a code when one isn't recorded. Strips a trailing `_v<N>` so a
 * survey already named `prism_css_v2` doesn't become `prism_css_v2_v3`.
 */
export function deriveSurveyCode(name: string): string {
  return name.replace(/_v\d+$/, '');
}

/** Next free version number given a lineage's existing versions. */
export function nextVersionNumber(siblings: readonly { version: number }[]): number {
  if (siblings.length === 0) return 1;
  return Math.max(...siblings.map((s) => s.version)) + 1;
}

/**
 * The display name a version carries, e.g. `PRISM CSS` -> `PRISM CSS v2`.
 *
 * This is NOT cosmetic. It becomes the manifest's `surveyName`, which is the
 * app's own identity key for a survey: getAvailableSurveys lists surveyNames,
 * SettingsService stores the ACTIVE survey as a surveyName, and
 * getActiveSurveyId resolves that name back to a surveyId by scanning
 * manifests and returning the FIRST folder that matches. Two versions sharing
 * a surveyName would therefore show as two identical rows in the phone's
 * survey list, and picking either would resolve to whichever folder the OS
 * happened to list first -- possibly loading v1's questions when the user
 * chose v2.
 *
 * Version 1 is left alone: it may already be deployed and locked (so it
 * cannot be renamed), and existing surveys must not change name under
 * people. The result reads naturally anyway -- `PRISM CSS`, `PRISM CSS v2`,
 * `PRISM CSS v3`.
 */
export function versionedDisplayName(baseName: string, version: number): string {
  const base = stripVersionSuffix(baseName);
  return version <= 1 ? base : `${base} v${version}`;
}

/** Removes a trailing ` v<N>` so versioning a version does not compound it. */
export function stripVersionSuffix(name: string): string {
  return name.replace(/ v\d+$/, '');
}

/**
 * `v2 · 14 Aug 2026`. The number carries the ordering, the date is there
 * because it is what people actually recognise a revision by.
 */
export function formatVersionLabel(version: number, versionDate: string): string {
  const date = new Date(versionDate);
  if (Number.isNaN(date.getTime())) return `v${version}`;
  const formatted = date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  return `v${version} · ${formatted}`;
}

/**
 * Groups survey rows into lineages, newest version first within each, and
 * lineages ordered by their latest version's date (newest first) so the list
 * keeps reading the way it does today.
 */
export function groupByLineage<T extends VersionedSurvey>(surveys: readonly T[]): SurveyLineage<T>[] {
  const byCode = new Map<string, T[]>();
  for (const survey of surveys) {
    const existing = byCode.get(survey.survey_code);
    if (existing) existing.push(survey);
    else byCode.set(survey.survey_code, [survey]);
  }

  const lineages = Array.from(byCode.entries()).map(([surveyCode, rows]) => {
    const versions = [...rows].sort((a, b) => b.version - a.version);
    return { surveyCode, latest: versions[0], versions };
  });

  return lineages.sort((a, b) => {
    const dateDiff =
      new Date(b.latest.version_date).getTime() - new Date(a.latest.version_date).getTime();
    if (dateDiff !== 0 && !Number.isNaN(dateDiff)) return dateDiff;
    return a.surveyCode.localeCompare(b.surveyCode);
  });
}

/**
 * Maps each version's package id to its version number -- what the CSV export
 * needs to stamp a `survey_version` column onto rows merged across versions.
 */
export function versionByPackageId(
  surveys: readonly { id: string; version: number }[]
): Record<string, number> {
  const map: Record<string, number> = {};
  for (const survey of surveys) map[survey.id] = survey.version;
  return map;
}
