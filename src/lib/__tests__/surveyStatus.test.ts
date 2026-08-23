import { describe, it, expect } from 'vitest';
import {
  SURVEY_STATUSES,
  LEGAL_TRANSITIONS,
  LOCKED_STATUSES,
  DELETABLE_STATUSES,
  DOWNLOADABLE_STATUSES,
  isLegalTransition,
  isSurveyLocked,
  isSurveyDeletable,
} from '../surveyStatus';

// Mirrors the `allowed` array in enforce_survey_package_lifecycle() in
// supabase/migrations/<ts+1>_survey_lifecycle_guards.sql. If this list and
// LEGAL_TRANSITIONS ever disagree, the UI will offer a transition the
// database then rejects (or vice versa, hiding one it would allow).
const DB_TRIGGER_ALLOWED = [
  'draft>test',
  'draft>deployed',
  'test>draft',
  'test>deployed',
  'deployed>complete',
  'complete>deployed',
];

describe('LEGAL_TRANSITIONS', () => {
  it('matches the DB trigger\'s allowed transition list exactly', () => {
    const flattened = SURVEY_STATUSES.flatMap((from) =>
      LEGAL_TRANSITIONS[from].map((to) => `${from}>${to}`)
    );
    expect(new Set(flattened)).toEqual(new Set(DB_TRIGGER_ALLOWED));
  });

  it('forbids deployed -> draft (the core safety property)', () => {
    expect(isLegalTransition('deployed', 'draft')).toBe(false);
  });

  it('forbids deployed -> test', () => {
    expect(isLegalTransition('deployed', 'test')).toBe(false);
  });

  it('allows draft -> deployed directly (test is an optional stage)', () => {
    expect(isLegalTransition('draft', 'deployed')).toBe(true);
  });

  it('allows test -> draft (freely editable, can be demoted)', () => {
    expect(isLegalTransition('test', 'draft')).toBe(true);
  });

  it('allows complete -> deployed (reopening collection)', () => {
    expect(isLegalTransition('complete', 'deployed')).toBe(true);
  });

  it('has no transition out of complete back to draft or test', () => {
    expect(isLegalTransition('complete', 'draft')).toBe(false);
    expect(isLegalTransition('complete', 'test')).toBe(false);
  });

  it('every status has a defined (possibly empty) transition list', () => {
    for (const status of SURVEY_STATUSES) {
      expect(LEGAL_TRANSITIONS[status]).toBeDefined();
    }
  });
});

describe('isSurveyLocked', () => {
  it('locks deployed and complete', () => {
    expect(isSurveyLocked('deployed')).toBe(true);
    expect(isSurveyLocked('complete')).toBe(true);
  });

  it('leaves draft and test unlocked', () => {
    expect(isSurveyLocked('draft')).toBe(false);
    expect(isSurveyLocked('test')).toBe(false);
  });

  it('LOCKED_STATUSES matches isSurveyLocked for every status', () => {
    for (const status of SURVEY_STATUSES) {
      expect(LOCKED_STATUSES.includes(status)).toBe(isSurveyLocked(status));
    }
  });
});

describe('isSurveyDeletable', () => {
  it('draft and test are deletable; deployed and complete are not', () => {
    expect(isSurveyDeletable('draft')).toBe(true);
    expect(isSurveyDeletable('test')).toBe(true);
    expect(isSurveyDeletable('deployed')).toBe(false);
    expect(isSurveyDeletable('complete')).toBe(false);
  });

  it('DELETABLE_STATUSES is exactly the complement of LOCKED_STATUSES', () => {
    for (const status of SURVEY_STATUSES) {
      expect(DELETABLE_STATUSES.includes(status)).toBe(!LOCKED_STATUSES.includes(status));
    }
  });
});

describe('DOWNLOADABLE_STATUSES', () => {
  it('is exactly test and deployed', () => {
    expect(new Set(DOWNLOADABLE_STATUSES)).toEqual(new Set(['test', 'deployed']));
  });
});
