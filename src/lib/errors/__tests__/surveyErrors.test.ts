import { describe, it, expect } from 'vitest';
import {
  surveyIdConflictMessage,
  translateSurveyWriteError,
  SurveyLockedError,
  surveyIdsMatch,
} from '../surveyErrors';

describe('surveyIdsMatch', () => {
  it('matches identical ids case-insensitively', () => {
    expect(surveyIdsMatch('prism_css_2026_08_22', 'PRISM_CSS_2026_08_22')).toBe(true);
  });

  it('does not match a different id of the same length (the SQL LIKE wildcard trap)', () => {
    // If this were implemented with .ilike(), '_' being a single-char
    // wildcard would make 'prism_css' match 'prismxcss'. Plain string
    // comparison must not.
    expect(surveyIdsMatch('prism_css', 'prismxcss')).toBe(false);
  });

  it('does not match a prefix or substring', () => {
    expect(surveyIdsMatch('prism_css', 'prism_css_test')).toBe(false);
  });
});

describe('surveyIdConflictMessage', () => {
  it('explains the collision within the same project', () => {
    const msg = surveyIdConflictMessage({
      surveyId: 'prism_css_2026_08_22',
      displayName: 'PRISM CSS Household Survey',
      projectName: 'Burkina Faso 2026',
      sameProject: true,
    });
    expect(msg).toContain('prism_css_2026_08_22');
    expect(msg).toContain('PRISM CSS Household Survey');
    expect(msg).toContain('this project');
    expect(msg).toContain('New Version');
    // Explains WHY -- the routing mechanism -- not just that it's a conflict.
    expect(msg).toMatch(/manifest|rout/i);
  });

  it('explains the collision across projects and names the other project', () => {
    const msg = surveyIdConflictMessage({
      surveyId: 'prism_css_2026_08_22',
      displayName: 'PRISM CSS Household Survey',
      projectName: 'Burkina Faso 2026',
      sameProject: false,
    });
    expect(msg).toContain('Burkina Faso 2026');
    expect(msg).toContain('all of your projects');
    expect(msg).not.toContain('this project');
  });
});

describe('translateSurveyWriteError', () => {
  it('translates the account-scoped unique violation (23505)', () => {
    const msg = translateSurveyWriteError({
      code: '23505',
      message: 'duplicate key value violates unique constraint "survey_packages_name_created_by_idx"',
    });
    expect(msg).toMatch(/unique across all of your projects/i);
  });

  it('translates the project-scoped unique violation (23505)', () => {
    const msg = translateSurveyWriteError({
      code: '23505',
      message: 'duplicate key value violates unique constraint "survey_packages_project_id_name_key"',
    });
    expect(msg).toMatch(/already exists in this project/i);
  });

  it('translates the locked-content check violation via hint', () => {
    const msg = translateSurveyWriteError({
      code: '23514',
      hint: 'sp_locked',
      message: 'Survey "x" is deployed and its content can no longer be changed.',
    });
    expect(msg).toMatch(/locked/i);
    // Points at New Version, not Duplicate: a revision has to keep the same
    // database to keep its data with the original's, which is exactly what
    // Duplicate does not do.
    expect(msg).toMatch(/New Version/);
  });

  it('explains a version declaring a different database name', () => {
    const msg = translateSurveyWriteError({
      code: '23514',
      hint: 'sp_lineage_database_mismatch',
      message: 'Survey "x" declares database "a.sqlite", but version "y" ...',
    });
    expect(msg).toMatch(/same database name/i);
  });

  it('explains a second survey claiming a database already in use', () => {
    const msg = translateSurveyWriteError({
      code: '23514',
      hint: 'sp_database_in_use',
      message: 'Database "a.sqlite" is already used by survey "y".',
    });
    expect(msg).toMatch(/cannot share one database/i);
    // The two ways out, both of which are real: rename, or make it a version.
    expect(msg).toMatch(/different database name/i);
    expect(msg).toMatch(/version of the survey/i);
  });

  it('translates the delete-locked check violation via hint', () => {
    const msg = translateSurveyWriteError({
      code: '23514',
      hint: 'sp_delete_locked',
    });
    expect(msg).toMatch(/cannot be deleted/i);
  });

  it('translates the illegal-transition check violation via hint', () => {
    const msg = translateSurveyWriteError({
      code: '23514',
      hint: 'sp_illegal_transition',
    });
    expect(msg).toMatch(/status change/i);
  });

  it('returns null for an unrecognized error so callers fall back to error.message', () => {
    expect(translateSurveyWriteError({ code: '42601', message: 'syntax error' })).toBeNull();
    expect(translateSurveyWriteError(null)).toBeNull();
    expect(translateSurveyWriteError(undefined)).toBeNull();
    expect(translateSurveyWriteError('a plain string')).toBeNull();
  });

  it('does not misfire on a 23505 for an unrelated constraint', () => {
    const msg = translateSurveyWriteError({
      code: '23505',
      message: 'duplicate key value violates unique constraint "projects_slug_key"',
    });
    expect(msg).toBeNull();
  });
});

describe('SurveyLockedError', () => {
  it('carries the survey identity and produces an explanatory message', () => {
    const err = new SurveyLockedError('prism_css_2026_08_22', 'PRISM CSS Household Survey', 'deployed');
    expect(err.surveyId).toBe('prism_css_2026_08_22');
    expect(err.displayName).toBe('PRISM CSS Household Survey');
    expect(err.status).toBe('deployed');
    expect(err.message).toContain('PRISM CSS Household Survey');
    expect(err.message).toMatch(/deployed/i);
    expect(err.message).toMatch(/New Version/);
  });
});
