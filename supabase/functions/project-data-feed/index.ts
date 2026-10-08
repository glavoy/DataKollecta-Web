// project-data-feed: read-only, project-scoped access to collected data for
// dashboards and scheduled analysis.
//
// Callers present a data feed key (`Authorization: Bearer dkf_…`) minted by a
// project owner in the portal. The key is hashed here and resolved by
// feed_authenticate (migration 20261008090000); every read after that passes
// only the key id, and the SQL derives the project from it. No parameter of
// this endpoint names a project, so a key for one project cannot be pointed
// at another.
//
// Deployed with --no-verify-jwt, like app-login and app-sync: the gateway's
// JWT check would demand a Supabase key the caller has no business holding,
// and the feed key is what actually authorises the request.
//
// Same pinned supabase-js as the other functions; see app-sync/index.ts for
// why it is pinned.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.115.0";

const MAX_LIMIT = 2000;
const DEFAULT_LIMIT = 1000;

const JSON_HEADERS = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
};

function json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

async function sha256Hex(value: string): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/// The opaque cursor a page hands back: the last row's sort key, so the next
/// request resumes strictly after it. base64url JSON rather than two loose
/// parameters, so a caller treats it as one value and never has to know
/// which columns it orders by.
function encodeCursor(ts: string, id: string): string {
    return btoa(JSON.stringify([ts, id])).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function decodeCursor(cursor: string): { ts: string; id: string } | null {
    try {
        const padded = cursor.replaceAll("-", "+").replaceAll("_", "/");
        const [ts, id] = JSON.parse(atob(padded + "=".repeat((4 - padded.length % 4) % 4)));
        // "-infinity" is how a formchange with no synced_at sorts.
        if (typeof ts !== "string" || typeof id !== "string") return null;
        if (ts !== "-infinity" && Number.isNaN(Date.parse(ts))) return null;
        return { ts, id };
    } catch {
        return null;
    }
}

/// `since` (an ISO timestamp) starts a fresh incremental read: everything
/// changed at or after it. `cursor` continues one. Neither means "from the
/// beginning".
function startingPoint(params: URLSearchParams): { ts: string | null; id: string | null } | Response {
    const cursor = params.get("cursor");
    if (cursor) {
        const decoded = decodeCursor(cursor);
        if (!decoded) return json(400, { error: "Invalid cursor" });
        return decoded;
    }
    const since = params.get("since");
    if (since) {
        if (Number.isNaN(Date.parse(since))) return json(400, { error: "since must be an ISO 8601 timestamp" });
        // Strictly after (since - 1µs, any id) == at or after since.
        return { ts: new Date(Date.parse(since) - 1).toISOString(), id: null };
    }
    return { ts: null, id: null };
}

function pageLimit(params: URLSearchParams): number | Response {
    const raw = params.get("limit");
    if (raw === null) return DEFAULT_LIMIT;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > MAX_LIMIT) {
        return json(400, { error: `limit must be an integer from 1 to ${MAX_LIMIT}` });
    }
    return n;
}

Deno.serve(async (req) => {
    if (req.method !== "GET") {
        return json(405, { error: "Use GET" });
    }

    const auth = req.headers.get("authorization") ?? "";
    const match = /^Bearer\s+(dkf_[0-9a-f]{8}_[0-9a-f]{64})\s*$/i.exec(auth);
    if (!match) {
        return json(401, { error: "Missing or malformed data feed key" });
    }

    try {
        const supabase = createClient(
            Deno.env.get("SUPABASE_URL")!,
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
            { auth: { persistSession: false } },
        );

        const { data: keys, error: authError } = await supabase.rpc("feed_authenticate", {
            p_key_hash: await sha256Hex(match[1].toLowerCase()),
        });
        if (authError) throw authError;
        const key = keys?.[0];
        if (!key) {
            // One answer for unknown, revoked, expired and archived alike, so
            // the response says nothing about which keys exist.
            return json(401, { error: "This data feed key is not valid. It may have been revoked or expired." });
        }

        const params = new URL(req.url).searchParams;
        const resource = params.get("resource") ?? "forms";
        const scope = {
            project: key.project_slug,
            survey_codes: key.survey_codes,
            data_statuses: key.data_statuses,
        };

        if (resource === "forms") {
            const { data, error } = await supabase.rpc("feed_forms", { p_key_id: key.key_id });
            if (error) throw error;
            return json(200, { scope, forms: data ?? [] });
        }

        const start = startingPoint(params);
        if (start instanceof Response) return start;
        const limit = pageLimit(params);
        if (limit instanceof Response) return limit;

        if (resource === "submissions") {
            const table = params.get("table");
            if (!table) return json(400, { error: "table is required for resource=submissions" });

            const { data, error } = await supabase.rpc("feed_submissions", {
                p_key_id: key.key_id,
                p_table: table,
                p_since: start.ts,
                p_after: start.id,
                p_limit: limit,
            });
            if (error) throw error;
            const rows = data ?? [];

            if (!params.get("cursor")) {
                await recordRead(supabase, key.key_id, { resource, table, since: params.get("since") });
            }

            const last = rows[rows.length - 1];
            return json(200, {
                scope,
                table,
                rows: rows.map((r: { row_data: unknown }) => r.row_data),
                next_cursor: last ? encodeCursor(last.updated_at, last.id) : null,
                // The newest change on this page. A consumer saves it and
                // starts its next run a few minutes before it (`since`), so a
                // record committed late with an earlier timestamp is not missed.
                last_changed_at: last?.updated_at ?? null,
                has_more: rows.length === limit,
            });
        }

        if (resource === "formchanges") {
            const { data, error } = await supabase.rpc("feed_formchanges", {
                p_key_id: key.key_id,
                p_since: start.ts,
                p_after: start.id,
                p_limit: limit,
            });
            if (error) throw error;
            const rows = data ?? [];

            if (!params.get("cursor")) {
                await recordRead(supabase, key.key_id, { resource, since: params.get("since") });
            }

            const last = rows[rows.length - 1];
            return json(200, {
                scope,
                rows: rows.map((r: { row_data: unknown }) => r.row_data),
                next_cursor: last ? encodeCursor(last.synced_at, last.formchanges_uuid) : null,
                last_changed_at: last && last.synced_at !== "-infinity" ? last.synced_at : null,
                has_more: rows.length === limit,
            });
        }

        return json(400, { error: "resource must be forms, submissions or formchanges" });
    } catch (error) {
        console.error("project-data-feed error:", error);
        return json(500, { error: "Internal server error" });
    }
});

/// Not fatal: losing one audit row must not fail a read the key is entitled
/// to, but it is logged rather than dropped.
async function recordRead(
    supabase: ReturnType<typeof createClient>,
    keyId: string,
    details: Record<string, unknown>,
): Promise<void> {
    const { error } = await supabase.rpc("feed_record_read", { p_key_id: keyId, p_details: details });
    if (error) console.error(`Failed to record feed read for key ${keyId}:`, error.message);
}
