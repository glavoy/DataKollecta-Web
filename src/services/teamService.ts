
import { supabase } from "@/lib/supabase";

export interface FieldWorker {
  id: string;
  username: string;
  project_id: string;
  // Nullable, not just optional -- that's what Postgres actually returns
  // for these columns (see app_credentials in the schema migration), and a
  // stricter local type in ProjectFieldTeam.tsx used to silently disagree
  // with this one, breaking the type check the moment their two shapes met.
  description?: string | null;
  is_active: boolean;
  last_used_at?: string | null;
  created_at: string;
}

export const teamService = {
  /**
   * Fetch all field workers (app credentials) for a specific project.
   */
  async getFieldWorkers(projectId: string): Promise<FieldWorker[]> {
    const { data, error } = await supabase
      .from("app_credentials")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return data || [];
  },

  /**
   * Fetch all field workers across all projects (with project name).
   */
  async getAllFieldWorkers() {
    const { data, error } = await supabase
      .from("app_credentials")
      .select("*, projects(name)")
      .order("created_at", { ascending: false });

    if (error) throw error;
    return data || [];
  },

  /**
   * Create a new field worker credential using the server-side RPC.
   */
  async createCredential(projectId: string, username: string, password: string, description: string) {
    const { data, error } = await supabase.rpc("create_app_credential", {
      p_project_id: projectId,
      p_username: username,
      p_password: password,
      p_description: description,
    });

    if (error) throw error;
    return data;
  },

  /**
   * Update a credential's username and/or description. Never touches the
   * password -- that's bcrypt-hashed server-side by create_app_credential
   * and the plaintext never reaches the client, so resetting it needs its
   * own RPC, not a plain update.
   */
  async updateCredential(credentialId: string, updates: { username?: string; description?: string | null }) {
    const { error } = await supabase
      .from("app_credentials")
      .update(updates)
      .eq("id", credentialId);

    // (project_id, username) is unique -- a rename that collides with an
    // existing credential on the same project surfaces here rather than
    // being swallowed, so the caller can show the real reason it failed.
    if (error) throw error;
  },

  /**
   * Revoke (delete or deactivate) a credential.
   * For now, we'll hard delete, or we can soft delete if you prefer.
   * Let's start with hard delete to keep it simple, or update is_active.
   */
  async deleteCredential(credentialId: string) {
    const { error } = await supabase
      .from("app_credentials")
      .delete()
      .eq("id", credentialId);

    if (error) throw error;
  },
  
  /**
   * Toggle active status
   */
  /**
   * Toggle active status
   */
    async toggleStatus(credentialId: string, isActive: boolean) {
        const { error } = await supabase
        .from("app_credentials")
        .update({ is_active: isActive })
        .eq("id", credentialId);
    
        if (error) throw error;
    },

  /**
   * Fetch all projects
   */
    async getProjects() {
        const { data, error } = await supabase
            .from("projects")
            .select("*")
            .order("name");

        if (error) throw error;
        return data || [];
    }
};
