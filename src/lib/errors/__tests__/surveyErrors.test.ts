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
    expect(msg).toContain('Duplicate');
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
    expect(msg).toMatch(/Duplicate/);
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
    expect(err.message).toMatch(/Duplicate/);
  });
});
