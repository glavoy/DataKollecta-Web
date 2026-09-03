/**
 * Survey lifecycle status. This is the single source of truth for the
 * client -- the shape here must match the `enforce_survey_package_lifecycle`
 * trigger's `allowed` transition array in
 * supabase/migrations/<ts+1>_survey_lifecycle_guards.sql. If the two drift,
 * the UI will offer a transition the database then rejects.
 *
 * Archiving is a SEPARATE axis (`survey_packages.archived_at`), not a status.
 * A survey can be archived at any status; it changes nothing except whether
 * it shows in the default surveys list. See DESIGN.md / the survey lifecycle
 * plan for why the two are kept independent.
 */
export type SurveyStatus = 'draft' | 'test' | 'deployed' | 'complete';

export const SURVEY_STATUSES: SurveyStatus[] = ['draft', 'test', 'deployed', 'complete'];

/** Content (questions, forms, manifest) can no longer change at these statuses. */
export const LOCKED_STATUSES: SurveyStatus[] = ['deployed', 'complete'];

/** The row itself can be deleted outright only at these statuses -- it was never in the field. */
export const DELETABLE_STATUSES: SurveyStatus[] = ['draft', 'test'];

/** app-login serves the zip to phones only at these statuses. */
export const DOWNLOADABLE_STATUSES: SurveyStatus[] = ['test', 'deployed'];

export function isSurveyLocked(status: SurveyStatus): boolean {
  return LOCKED_STATUSES.includes(status);
}

export function isSurveyDeletable(status: SurveyStatus): boolean {
  return DELETABLE_STATUSES.includes(status);
}

/**
 * Legal status transitions. Mirrors the `allowed` array in the DB trigger
 * exactly -- keep both in sync by hand, and see surveyStatus.test.ts for the
 * assertion that ties this to the flattened 'from>to' list the trigger uses.
 */
export const LEGAL_TRANSITIONS: Record<SurveyStatus, SurveyStatus[]> = {
  draft: ['test', 'deployed'],
  test: ['draft', 'deployed'],
  deployed: ['complete'],
  complete: ['deployed'],
};

export function isLegalTransition(from: SurveyStatus, to: SurveyStatus): boolean {
  return LEGAL_TRANSITIONS[from]?.includes(to) ?? false;
}

export const STATUS_LABEL: Record<SurveyStatus, string> = {
  draft: 'Draft',
  test: 'Test',
  deployed: 'Deployed',
  complete: 'Complete',
};

export const STATUS_DESCRIPTION: Record<SurveyStatus, string> = {
  draft: 'Being built. Not available on any phone.',
  test: 'Downloadable, shown to testers as "[TEST] ...". Still editable.',
  deployed: 'Live in the field. Locked -- questions can no longer change. Revise with New Version.',
  complete: 'Data collection finished. No longer downloadable. Locked; data is retained.',
};

/**
 * Badge classes, following the convention set by the existing badges in
 * QuestionCard.tsx (bg-{color}-500/80 hover:bg-{color}-500 for status
 * badges). Archived is not a status -- see ARCHIVED_BADGE_CLASS below.
 */
export const STATUS_BADGE_CLASS: Record<SurveyStatus, string> = {
  draft: 'bg-slate-500/80 hover:bg-slate-500',
  test: 'bg-amber-500/80 hover:bg-amber-500',
  deployed: 'bg-green-500/80 hover:bg-green-500',
  complete: 'bg-blue-500/80 hover:bg-blue-500',
};

/** Archiving is its own axis; give it its own muted badge alongside the status badge. */
export const ARCHIVED_BADGE_CLASS = 'text-xs flex-shrink-0';
