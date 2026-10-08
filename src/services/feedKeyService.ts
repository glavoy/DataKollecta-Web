import { supabase } from "@/lib/supabase";

/**
 * A data feed key as the portal sees it. Never includes the key itself or its
 * hash: the plaintext exists only in the response to `createKey`, and
 * `key_hash` is not granted to portal users at all.
 */
export interface FeedKey {
  id: string;
  name: string;
  key_prefix: string;
  survey_codes: string[] | null;
  data_statuses: string[];
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
  revoke_reason: string | null;
}

export interface NewFeedKey {
  id: string;
  /** The full key, shown once. */
  key: string;
  key_prefix: string;
}

/** The URL every feed key is used against. */
export function feedUrl(): string {
  return `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/project-data-feed`;
}

export const feedKeyService = {
  async listKeys(projectId: string): Promise<FeedKey[]> {
    const { data, error } = await supabase
      .from("project_feed_keys")
      .select("id, name, key_prefix, survey_codes, data_statuses, created_at, expires_at, last_used_at, revoked_at, revoke_reason")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []) as FeedKey[];
  },

  async createKey(
    projectId: string,
    options: { name: string; surveyCodes: string[] | null; includeTest: boolean; expiresAt: string | null },
  ): Promise<NewFeedKey> {
    const { data, error } = await supabase.rpc("create_project_feed_key", {
      p_project_id: projectId,
      p_name: options.name,
      p_survey_codes: options.surveyCodes && options.surveyCodes.length > 0 ? options.surveyCodes : null,
      p_data_statuses: options.includeTest ? ["deployed", "test"] : ["deployed"],
      p_expires_at: options.expiresAt,
    });
    if (error) throw error;
    return data as NewFeedKey;
  },

  async revokeKey(keyId: string, reason: string): Promise<void> {
    const { error } = await supabase.rpc("revoke_project_feed_key", { p_key_id: keyId, p_reason: reason });
    if (error) throw error;
  },
};
