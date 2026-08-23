/**
 * Project-level status. Two states only -- unlike SurveyStatus, there is no
 * ordered lifecycle and no content lock: pausing a project never locks
 * anything in the portal (surveys, forms, members, settings all stay fully
 * editable at any status).
 *
 * Field access (app-login, app-sync -- see
 * supabase/functions/app-login/index.ts and app-sync/index.ts) requires
 * BOTH `status === 'active'` AND `archived_at === null`. Pausing and
 * archiving are independent controls that happen to produce the same
 * access outcome: either one alone is enough to block field devices, and
 * app-sync checks both live on every call (not just at login), so a device
 * that's already logged in is cut off the next time it syncs, not just
 * blocked from a fresh login.
 *
 * What tells them apart is list visibility and how each is normally used.
 * `archived_at` (`projects.archived_at`) hides a project from the default
 * projects list -- pausing does not. Archiving is the "I'm done with this"
 * action and doesn't touch `status`: archiving a Paused project and later
 * unarchiving it leaves it Paused, exactly as it was left. Pausing is for
 * "I need field access off right now while I keep working on this" --
 * unlike surveys, where archived_at NEVER gates access (see
 * src/lib/surveyStatus.ts); projects deliberately work differently because,
 * for a whole project, disappearing from your list while still silently
 * collecting field data is worse than for a single archived survey.
 */
export type ProjectStatus = 'active' | 'paused';

export const PROJECT_STATUSES: ProjectStatus[] = ['active', 'paused'];

export const STATUS_LABEL: Record<ProjectStatus, string> = {
  active: 'Active',
  paused: 'Paused',
};

export const STATUS_DESCRIPTION: Record<ProjectStatus, string> = {
  active: 'Field workers can log in, download surveys, and upload data from the mobile app.',
  paused: 'Field access is fully revoked. New logins are blocked, and any device already ' +
    'logged in loses access the next time it syncs. Portal access -- editing surveys, ' +
    'managing members, viewing data -- is not affected.',
};

/** Badge classes, following the same convention as STATUS_BADGE_CLASS in surveyStatus.ts. */
export const STATUS_BADGE_CLASS: Record<ProjectStatus, string> = {
  active: 'bg-green-500/80 hover:bg-green-500',
  paused: 'bg-slate-500/80 hover:bg-slate-500',
};

/** Archiving is its own axis; give it its own muted badge alongside the status badge. */
export const ARCHIVED_BADGE_CLASS = 'text-xs flex-shrink-0';
