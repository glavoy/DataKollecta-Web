import { supabase } from "@/lib/supabase";
import { SurveyStatus, STATUS_LABEL } from "@/lib/surveyStatus";

/**
 * Thrown when a write is attempted against a survey whose status locks its
 * content (see LOCKED_STATUSES in surveyStatus.ts). Mirrors the DB trigger's
 * `sp_locked` hint -- see translateSurveyWriteError below for the case where
 * this is raised by Postgres instead of caught client-side.
 */
export class SurveyLockedError extends Error {
  constructor(
    readonly surveyId: string,
    readonly displayName: string,
    readonly status: SurveyStatus
  ) {
    super(
      `"${displayName}" is ${STATUS_LABEL[status].toLowerCase()} and can no longer be edited. ` +
      `It is already installed on field devices under this Survey ID, and changing it would ` +
      `leave phones collecting against a different version of the same survey. Use New Version ` +
      `to create an editable copy -- it collects into the same data as this one.`
    );
    this.name = 'SurveyLockedError';
  }
}

export type SurveyIdConflict = {
  /** The row that already holds this survey ID. */
  surveyId: string;
  displayName: string;
  projectName: string;
  /** True when the conflict is within the SAME project as the write being attempted. */
  sameProject: boolean;
};

/**
 * Case-insensitive, exact (non-wildcard) equality check for two survey ids.
 * Pulled out as its own function so it's covered by a unit test without
 * needing a mocked Supabase client -- the thing worth pinning down is that
 * this is plain string comparison, NOT SQL LIKE/ILIKE, because these survey
 * ids are full of underscores and `_` is a single-character wildcard in
 * LIKE. An ilike-based match would report "prism_css" as conflicting with
 * "prismxcss".
 */
export function surveyIdsMatch(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * Finds an existing survey that would collide with `surveyId`, covering
 * BOTH unique indexes on survey_packages:
 *   - survey_packages_project_id_name_key: UNIQUE (project_id, name)
 *   - survey_packages_name_created_by_idx: UNIQUE (created_by, lower(name)) -- global per user
 *
 * Deliberately does NOT use .ilike() -- these survey ids are full of
 * underscores, and `_` is a single-character wildcard in SQL LIKE, so
 * .ilike('name', 'a_b') would match 'axb' and report phantom conflicts.
 * Also deliberately avoids .or('and(...),and(...)') -- unescaped '.', ','
 * and '(' in a survey id break the PostgREST filter grammar. Two plain
 * .eq() queries plus a client-side lowercase comparison sidesteps both.
 */
export async function findSurveyIdConflict(
  surveyId: string,
  projectId: string,
  userId: string,
  opts?: { excludeId?: string }
): Promise<SurveyIdConflict | null> {
  const [projectScoped, accountScoped] = await Promise.all([
    supabase
      .from('survey_packages')
      .select('id, name, display_name, project_id, projects(name)')
      .eq('project_id', projectId),
    supabase
      .from('survey_packages')
      .select('id, name, display_name, project_id, projects(name)')
      .eq('created_by', userId),
  ]);

  const candidates = [
    ...(projectScoped.data ?? []),
    ...(accountScoped.data ?? []),
  ];

  for (const row of candidates) {
    if (opts?.excludeId && row.id === opts.excludeId) continue;
    if (!surveyIdsMatch(row.name as string, surveyId)) continue;

    // The Supabase client here has no generated Database type, so the
    // embedded `projects` relation's cardinality is unknown to the type
    // checker and comes back typed as an array either way -- it's a
    // to-one join in practice (survey_packages.project_id -> projects.id).
    const embeddedProject = Array.isArray(row.projects) ? row.projects[0] : row.projects;

    return {
      surveyId: row.name as string,
      displayName: (row.display_name as string) ?? row.name as string,
      projectName: embeddedProject?.name ?? '(unknown project)',
      sameProject: row.project_id === projectId,
    };
  }

  return null;
}

export function surveyIdConflictMessage(c: SurveyIdConflict): string {
  if (c.sameProject) {
    return (
      `Survey ID "${c.surveyId}" is already used by "${c.displayName}" in this project. ` +
      `Survey IDs must be unique: when a phone uploads data, the server finds the right ` +
      `survey by matching this ID against each package's manifest. Two surveys sharing an ` +
      `ID would make submitted records impossible to route -- for both surveys, not just ` +
      `the new one. Choose a different Survey ID, or use New Version on the existing survey ` +
      `to start a revision that collects into the same data.`
    );
  }

  return (
    `You already use Survey ID "${c.surveyId}" for "${c.displayName}", in the project ` +
    `"${c.projectName}". Survey IDs must be unique across all of your projects, because a ` +
    `phone identifies which survey a record belongs to by this ID alone. Pick a different ` +
    `one -- appending the version date is the usual convention, e.g. "${c.surveyId}_${
      new Date().toISOString().split('T')[0].replace(/-/g, '_')
    }".`
  );
}

/**
 * Translates a raw PostgrestError into the same messages surveyIdConflictMessage
 * produces, for the case where findSurveyIdConflict's preflight missed the
 * conflict (RLS hides rows in projects you've been removed from, but the
 * unique index still fires) or where the DB lifecycle trigger rejected the
 * write. Returns null when the error isn't one we recognize, so callers can
 * fall back to error.message.
 */
export function translateSurveyWriteError(err: unknown): string | null {
  const pgErr = err as { code?: string; message?: string; details?: string; hint?: string } | null;
  if (!pgErr || typeof pgErr !== 'object') return null;

  if (pgErr.code === '23505') {
    const text = `${pgErr.message ?? ''} ${pgErr.details ?? ''}`;
    if (text.includes('survey_packages_name_created_by_idx')) {
      return (
        `You already have a survey with this ID (Survey Name) in another project. Survey ` +
        `IDs must be unique across all of your projects, because a phone identifies which ` +
        `survey a record belongs to by this ID alone. Pick a different Survey ID.`
      );
    }
    if (text.includes('survey_packages_project_id_name_key')) {
      return (
        `A survey with this ID already exists in this project. Survey IDs must be unique: ` +
        `the server routes each phone's submitted data by matching this ID against the ` +
        `manifest, so two surveys sharing an ID would break sync for both. Choose a ` +
        `different Survey ID, or use New Version on the existing survey instead.`
      );
    }
  }

  // check_violation raised by the lifecycle/lock triggers -- see the HINT
  // values set in enforce_survey_package_lifecycle / _delete_guard /
  // enforce_crf_parent_unlocked in the survey_lifecycle_guards migration.
  // PostgREST is expected to surface PG's HINT verbatim in `hint`, but as a
  // fallback (in case a proxy or version strips it) also match the `sp_*`
  // marker inside `details`/`message`, since it is always present there too
  // via the DETAIL clause the triggers set alongside HINT.
  if (pgErr.code === '23514' || pgErr.hint?.startsWith('sp_')) {
    const marker = pgErr.hint ?? '';
    if (marker === 'sp_locked') {
      return (
        `This survey is locked and its content can no longer be changed. It is already ` +
        `installed on field devices under this Survey ID. Use New Version to create an ` +
        `editable copy -- it collects into the same data as this one.`
      );
    }
    if (marker === 'sp_lineage_database_mismatch') {
      return (
        `Every version of a survey must use the same database name -- that shared database ` +
        `is what keeps their data together on the device. This package declares a different ` +
        `one, so it cannot be a version of this survey.`
      );
    }
    if (marker === 'sp_database_in_use_elsewhere') {
      // Deliberately says nothing about the other survey -- it belongs to a
      // different account, and the trigger withholds its identity for that
      // reason. See the survey_database_name_global migration.
      return (
        `That database name is already in use by another survey. Database names must be ` +
        `unique across the whole platform: a phone keeps every survey it holds in one ` +
        `folder named by this value, so two surveys sharing a name would write into the ` +
        `same file. Choose a more specific database name.`
      );
    }
    if (marker === 'sp_database_in_use') {
      return (
        `Another survey in this project already uses this database name. Two different ` +
        `surveys cannot share one database: on a phone they would write into the same file, ` +
        `mixing their records and their ID counters. Give this survey a different database ` +
        `name, or add it as a version of the survey that already uses it.`
      );
    }
    if (marker === 'sp_delete_locked') {
      return `This survey is locked and cannot be deleted. Archive it instead.`;
    }
    if (marker === 'sp_illegal_transition') {
      return `That status change isn't allowed for this survey.`;
    }
    // hint present but code wasn't 23514 (defensive) -- generic locked message.
    return (
      `This survey is locked and can no longer be changed. Use New Version to create an ` +
      `editable copy that collects into the same data.`
    );
  }

  return null;
}
