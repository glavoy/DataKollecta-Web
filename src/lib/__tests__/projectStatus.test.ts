import { describe, it, expect } from 'vitest';
import {
  PROJECT_STATUSES,
  STATUS_LABEL,
  STATUS_DESCRIPTION,
  STATUS_BADGE_CLASS,
} from '../projectStatus';

describe('ProjectStatus maps', () => {
  it('every status has a label', () => {
    for (const status of PROJECT_STATUSES) {
      expect(STATUS_LABEL[status]).toBeTruthy();
    }
  });

  it('every status has a description', () => {
    for (const status of PROJECT_STATUSES) {
      expect(STATUS_DESCRIPTION[status]).toBeTruthy();
    }
  });

  it('every status has a badge class', () => {
    for (const status of PROJECT_STATUSES) {
      expect(STATUS_BADGE_CLASS[status]).toBeTruthy();
    }
  });

  it('is exactly active and paused', () => {
    expect(new Set(PROJECT_STATUSES)).toEqual(new Set(['active', 'paused']));
  });

  it("paused's description explains that live sessions are cut off, not just new logins", () => {
    expect(STATUS_DESCRIPTION.paused).toMatch(/already logged in/i);
    expect(STATUS_DESCRIPTION.paused).toMatch(/syncs|sync/i);
  });
});
