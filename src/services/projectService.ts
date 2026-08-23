import { supabase } from "@/lib/supabase";
import { ProjectStatus } from "@/lib/projectStatus";

export const projectService = {
  /**
   * Flips a project between active and paused. This is the ONLY place
   * status should be written. Unlike surveyService.updateSurveyStatus,
   * there is no DB trigger backstopping legal transitions -- it's a plain
   * two-state toggle -- and no content lock: pausing never blocks portal
   * edits, it only gates app-login/app-sync, checked live on every call
   * rather than by revoking already-issued tokens.
   */
  async setProjectStatus(projectId: string, next: ProjectStatus): Promise<void> {
    const { error } = await supabase
      .from('projects')
      .update({ status: next, updated_at: new Date().toISOString() })
      .eq('id', projectId);

    if (error) throw error;
  },

  /**
   * Archives or unarchives a project. Independent of status -- works at
   * either status, and unlike survey_packages there is no lock to work
   * around, since a project is never locked. Mirrors
   * surveyService.setSurveyArchived exactly.
   */
  async setProjectArchived(projectId: string, archived: boolean): Promise<void> {
    const { error } = await supabase
      .from('projects')
      .update({
        archived_at: archived ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', projectId);

    if (error) throw error;
  },
};
