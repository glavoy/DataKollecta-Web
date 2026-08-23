/**
 * Project-level status. Two states only -- unlike SurveyStatus, there is no
 * ordered lifecycle and no content lock: pausing a project never locks
 * anything in the portal (surveys, forms, members, settings all stay fully
 * editable at any status). Status gates ONLY the two field-facing edge
 * functions, app-login and app-sync -- see
 * supabase/functions/app-login/index.ts and app-sync/index.ts. app-sync
 * checks it live on every call (not just at login), so a device that is
 * already logged in is cut off the next time it syncs, not just blocked
 * from a fresh login.
 *
 * Archiving is a SEPARATE axis (`projects.archived_at`), exactly mirroring
 * survey_packages' archived_at (see src/lib/surveyStatus.ts). A project can
 * be archived at either status; archiving changes nothing except whether it
 * shows in the default projects list -- never field access, never data.
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
