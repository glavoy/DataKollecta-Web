
import { supabase } from "@/lib/supabase";

export interface Submission {
  id: string; // The database ID (UUID)
  table_name: string;
  local_unique_id: string; // The mobile app's UUID
  data: Record<string, unknown>;
  surveyor_id: string;
  collected_at: string;
  updated_at: string;
  survey_package_id: string;
  survey_name?: string;
  project_id: string;
  device_id?: string;
  app_version?: string;
}

export interface FormChange {
  id: string;
  formchanges_uuid: string;
  record_uuid: string;
  tablename: string;
  fieldname: string;
  oldvalue: string | null;
  newvalue: string | null;
  surveyor_id: string;
  changed_at: string;
  synced_at: string;
}

export interface SyncStats {
  table_name: string;
  total_records: number;
  last_sync: string | null;
}

export const submissionService = {
  /**
   * Fetch submissions for a specific project
   */
  getSubmissions: async (projectId: string, limit = 100): Promise<Submission[]> => {
    // Join with survey_packages to get the survey name
    const { data, error } = await supabase
      .from("submissions")
      .select(`
        *,
        survey_packages:survey_package_id (name)
      `)
      .eq("project_id", projectId)
      .order("collected_at", { ascending: false })
      .limit(limit);

    if (error) {
      console.error("Error fetching submissions:", error);
      throw error;
    }

    // Map the result to flatten the survey name
    type JoinedRow = Omit<Submission, "survey_name"> & {
      survey_packages?: { name?: string } | null;
    };
    return (data as JoinedRow[]).map((item) => ({
      ...item,
      survey_name: item.survey_packages?.name || "Unknown Survey",
    }));
  },

  /**
   * Fetch form changes (audit log) for a specific record
   */
  getFormChanges: async (recordUuid: string): Promise<FormChange[]> => {
    const { data, error } = await supabase
      .from("formchanges")
      .select("*")
      .eq("record_uuid", recordUuid)
      .order("changed_at", { ascending: true });

    if (error) {
      console.error("Error fetching form changes:", error);
      throw error;
    }

    return data as FormChange[];
  },

  /**
   * Fetch sync statistics for a project
   */
  getSyncStats: async (projectId: string): Promise<SyncStats[]> => {
    // Note: Supabase JS doesn't support complex GROUP BY queries easily.
    // We'll use a stored procedure (RPC) if available, or client-side aggregation for now.
    // For this implementation, we will use a simple client-side aggregation for flexibility
    // since we might not be able to create RPCs easily without SQL access.
    
    // Fetch all submissions (lightweight select)
    const { data, error } = await supabase
        .from("submissions")
        .select("table_name, updated_at")
        .eq("project_id", projectId);

    if (error) {
        console.error("Error fetching stats:", error);
        throw error;
    }

    const statsMap = new Map<string, { total: number; lastSync: Date }>();

    data.forEach((item) => {
        const current = statsMap.get(item.table_name) || { total: 0, lastSync: new Date(0) };
        current.total++;
        const itemDate = new Date(item.updated_at);
        if (itemDate > current.lastSync) {
            current.lastSync = itemDate;
        }
        statsMap.set(item.table_name, current);
    });

    return Array.from(statsMap.entries()).map(([table_name, stat]) => ({
        table_name,
        total_records: stat.total,
        last_sync: stat.lastSync.getTime() === 0 ? null : stat.lastSync.toISOString(),
    }));
  },
  
  /**
   * Get a single submission by its local UUID
   */
    getSubmissionByLocalId: async (localUuid: string): Promise<Submission | null> => {
        const { data, error } = await supabase
            .from("submissions")
            .select(`
                *,
                survey_packages:survey_package_id (name)
            `)
            .eq("local_unique_id", localUuid)
            .single();

        if (error) {
            if (error.code === 'PGRST116') return null; // Not found
            console.error("Error fetching submission details:", error);
            throw error;
        }

        return {
            ...data,
            survey_name: data.survey_packages?.name || "Unknown Survey",
        };
    }
};
