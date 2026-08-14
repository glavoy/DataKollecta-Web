import { supabase } from "@/lib/supabase";

export interface ProjectMember {
  id: string;
  project_id: string;
  user_id: string;
  role: 'owner' | 'editor' | 'viewer';
  invited_at: string;
  accepted_at: string | null;
  profiles: {
    id: string;
    email: string;
    full_name: string | null;
  };
}

export interface UserSearchResult {
  id: string;
  email: string;
  full_name: string | null;
}

export const projectMemberService = {
  /**
   * Get all members of a project
   */
  async getProjectMembers(projectId: string): Promise<ProjectMember[]> {
    const { data, error } = await supabase
      .from('project_members')
      .select(`
        id,
        project_id,
        user_id,
        role,
        invited_at,
        accepted_at,
        profiles:user_id (
          id,
          email,
          full_name
        )
      `)
      .eq('project_id', projectId)
      .order('role', { ascending: true });

    if (error) {
      console.error('Error fetching project members:', error);
      throw error;
    }

    return data as unknown as ProjectMember[];
  },

  /**
   * Search for users by email or name (for adding to project)
   * Searches both email and full_name fields with partial matching.
   *
   * Goes through a SECURITY DEFINER RPC rather than a direct `profiles`
   * select -- profiles' RLS only allows reading your own profile or a
   * profile that shares a project with you, since search intentionally
   * needs to find people outside your projects too (see the
   * 20260814_scope_profiles_visibility migration).
   */
  async searchUsersByEmail(searchTerm: string): Promise<UserSearchResult[]> {
    if (!searchTerm || searchTerm.length < 2) return [];

    const { data, error } = await supabase
      .rpc('search_profiles_for_invite', { p_search_term: searchTerm });

    if (error) {
      console.error('Error searching users:', error);
      throw error;
    }

    return data || [];
  },

  /**
   * Add a member to a project
   */
  async addMember(
    projectId: string,
    userId: string,
    role: 'owner' | 'editor' | 'viewer',
    invitedBy: string
  ): Promise<void> {
    // Check if user is already a member
    const { data: existing } = await supabase
      .from('project_members')
      .select('id')
      .eq('project_id', projectId)
      .eq('user_id', userId)
      .single();

    if (existing) {
      throw new Error('User is already a member of this project');
    }

    const { error } = await supabase
      .from('project_members')
      .insert({
        project_id: projectId,
        user_id: userId,
        role: role,
        invited_by: invitedBy,
        invited_at: new Date().toISOString(),
        accepted_at: new Date().toISOString(), // Auto-accept since we're adding existing users
      });

    if (error) {
      console.error('Error adding member:', error);
      throw error;
    }
  },

  /**
   * Update a member's role
   */
  async updateMemberRole(
    memberId: string,
    newRole: 'owner' | 'editor' | 'viewer'
  ): Promise<void> {
    const { error } = await supabase
      .from('project_members')
      .update({ role: newRole })
      .eq('id', memberId);

    if (error) {
      console.error('Error updating member role:', error);
      throw error;
    }
  },

  /**
   * Remove a member from a project
   */
  async removeMember(memberId: string): Promise<void> {
    const { error } = await supabase
      .from('project_members')
      .delete()
      .eq('id', memberId);

    if (error) {
      console.error('Error removing member:', error);
      throw error;
    }
  },

  /**
   * Get current user's role in a project
   */
  async getUserRole(projectId: string, userId: string): Promise<string | null> {
    const { data, error } = await supabase
      .from('project_members')
      .select('role')
      .eq('project_id', projectId)
      .eq('user_id', userId)
      .single();

    if (error) {
      console.error('Error fetching user role:', error);
      return null;
    }

    return data?.role || null;
  },
};
