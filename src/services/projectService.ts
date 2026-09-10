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
   * Archives or unarchives a project. Archiving leaves `status` untouched --
   * a paused project that gets archived is still recorded as paused
   * underneath, since there's no reason to lose that. Unarchiving, though,
   * also forces `status` back to 'active' in the same update: there's no
   * real scenario where you'd deliberately restore a project to your active
   * list but want it to stay inaccessible to field devices -- if that were
   * the goal you'd simply leave it archived. This keeps the three visible
   * states (Active / Paused / Archived) mutually exclusive from the UI's
   * point of view, with Archived reachable from either of the other two but
   * only leaving back to Active.
   */
  async setProjectArchived(projectId: string, archived: boolean): Promise<void> {
    const { error } = await supabase
      .from('projects')
      .update({
        archived_at: archived ? new Date().toISOString() : null,
        ...(archived ? {} : { status: 'active' as ProjectStatus }),
        updated_at: new Date().toISOString(),
      })
      .eq('id', projectId);

    if (error) throw error;
  },
};
