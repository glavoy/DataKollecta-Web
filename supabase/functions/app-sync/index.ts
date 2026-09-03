import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Kept in step with app-login/index.ts by hand. Each Edge Function is its own
// deployment unit, so a dozen duplicated lines is preferable to introducing a
// _shared module in a security change.
//
// Empty on purpose: nothing in the portal calls this function, and the Flutter
// client is not a browser, so it sends no Origin. This used to answer every
// origin with `*`. Note that CORS does not stop a request being made, only a
// browser reading the response -- the token check below is what actually
// authorises the call.
const ALLOWED_ORIGINS: readonly string[] = [];

function corsHeadersFor(req: Request): Record<string, string> {
    const headers: Record<string, string> = {
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    };
    const origin = req.headers.get("origin");
    if (origin && ALLOWED_ORIGINS.includes(origin)) {
        headers["Access-Control-Allow-Origin"] = origin;
        headers["Vary"] = "Origin";
    }
    return headers;
}

serve(async (req) => {
    const corsHeaders = corsHeadersFor(req);

    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        const { token, submissions, formchanges } = await req.json();

        if (!token || (!submissions && !formchanges)) {
             return new Response(
                JSON.stringify({ error: "Missing required fields" }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const supabase = createClient(
            Deno.env.get("SUPABASE_URL")!,
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
        );

        // Validate token, and pull the credential + project status/archived
        // state needed for the live access checks below in the same round
        // trip.
        const { data: session, error: sessionError } = await supabase
            .from("app_sessions")
            .select("*, app_credentials(*), projects(status, archived_at)")
            .eq("token", token)
            .gt("expires_at", new Date().toISOString())
            .single();

        if (sessionError || !session) {
            return new Response(
                JSON.stringify({ error: "Invalid or expired token" }),
                { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // Cut off an already-authenticated device the moment its credential
        // is disabled, or its project is paused or archived -- checked on
        // every call, not just at login, so a 30-day token can't outlive
        // any of them. All return 401 (not 403/500) so the app's postSync()
        // treats this exactly like an expired token -- stopping the sync
        // run immediately -- instead of retrying it as an ordinary batch
        // failure. Archiving a project now revokes field access exactly
        // like pausing does (its only OTHER effect is hiding the project
        // from the owner's default list) -- unlike archived_at on
        // survey_packages, which never gates downloads.
        if (!session.app_credentials?.is_active) {
            return new Response(
                JSON.stringify({ error: "This account has been disabled. Contact your project administrator." }),
                { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        if (session.projects?.status !== "active" || session.projects?.archived_at) {
            return new Response(
                JSON.stringify({ error: "This project is paused. Contact your project administrator." }),
                { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // Update session activity. Deliberately not fatal -- a failure here
        // costs a "last seen" timestamp, not any collected data, so it must
        // not stop a sync that is otherwise fine. Logged rather than dropped.
        const { error: activityError } = await supabase
            .from("app_sessions")
            .update({ last_activity_at: new Date().toISOString() })
            .eq("id", session.id);

        if (activityError) {
            console.error(
                `Failed to update last_activity_at for session ${session.id}:`,
                activityError.message,
            );
        }

        // Process data
        const results = {
            synced: [] as string[],
            failed: [] as { id: string; error: string }[],
            formchanges_synced: [] as string[],
            formchanges_failed: [] as { id: string; error: string }[],
        };

        // 1. Process Submissions
        if (submissions && Array.isArray(submissions)) {
            for (const submission of submissions) {
                try {
                    // Look up survey_package_id from the survey_id in the data
                    // The mobile app has surveyId (string like "r21_test_negative_2025-12-30")
                    // We need to find the corresponding survey_package UUID
                    const surveyIdFromData = submission.data?.survey_id;

                    if (!surveyIdFromData) {
                        results.failed.push({
                            id: submission.local_uuid,
                            error: "Missing survey_id in submission data",
                        });
                        continue;
                    }

                    // Look up the survey package by matching the surveyId in the manifest
                    const { data: surveyPackage, error: lookupError } = await supabase
                        .from("survey_packages")
                        .select("id")
                        .contains("manifest", { surveyId: surveyIdFromData })
                        .eq("project_id", session.project_id)
                        .maybeSingle();

                    if (lookupError || !surveyPackage) {
                        results.failed.push({
                            id: submission.local_uuid,
                            error: `Survey package not found for survey_id: ${surveyIdFromData}`,
                        });
                        continue;
                    }

                    // Upsert submission
                    const { error: upsertError } = await supabase
                        .from("submissions")
                        .upsert(
                            {
                                project_id: session.project_id,
                                survey_package_id: surveyPackage.id,
                                table_name: submission.table_name,
                                local_unique_id: submission.local_uuid,
                                data: submission.data,
                                version: 1,
                                device_id: submission.device_id,
                                surveyor_id: session.app_credentials.username,
                                app_version: submission.swver,
                                collected_at: submission.collected_at,
                                updated_at: new Date().toISOString(),
                            },
                            { onConflict: "project_id,table_name,local_unique_id" }
                        );

                    if (upsertError) {
                        results.failed.push({
                            id: submission.local_uuid,
                            error: upsertError.message,
                        });
                    } else {
                        results.synced.push(submission.local_uuid);
                    }
                } catch (err) {
                    results.failed.push({
                        id: submission.local_uuid,
                        error: String(err),
                    });
                }
            }
        }

        // 2. Process Formchanges (field-level audit log)
        if (formchanges && Array.isArray(formchanges)) {
            for (const change of formchanges) {
                try {
                    // Upsert formchange record
                    const { error: formchangeError } = await supabase
                        .from("formchanges")
                        .upsert(
                            {
                                formchanges_uuid: change.formchanges_uuid,
                                project_id: session.project_id,
                                record_uuid: change.record_uuid,
                                tablename: change.tablename,
                                fieldname: change.fieldname,
                                oldvalue: change.oldvalue,
                                newvalue: change.newvalue,
                                // Server-derived, never the client's own
                                // `change.surveyor_id`. This used to prefer
                                // the client value, which gave the column two
                                // possible meanings depending on whether the
                                // device happened to populate it -- and left
                                // `submissions.surveyor_id` (derived from the
                                // session in the loop above) able to disagree
                                // with `formchanges.surveyor_id` about the
                                // same record. An audit column recording who
                                // changed a value has to mean one thing.
                                //
                                // No effect on GiSTX, which FTPs the whole
                                // SQLite file and never calls this function.
                                surveyor_id: session.app_credentials.username,
                                changed_at: change.changed_at,
                                synced_at: new Date().toISOString(),
                            },
                            { onConflict: "formchanges_uuid" }
                        );

                    if (formchangeError) {
                        results.formchanges_failed.push({
                            id: change.formchanges_uuid,
                            error: formchangeError.message,
                        });
                    } else {
                        results.formchanges_synced.push(change.formchanges_uuid);
                    }
                } catch (err) {
                    results.formchanges_failed.push({
                        id: change.formchanges_uuid,
                        error: String(err),
                    });
                }
            }
        }

        return new Response(
            JSON.stringify({
                success: true,
                synced_count: results.synced.length,
                failed_count: results.failed.length,
                synced: results.synced,
                failed: results.failed,
                formchanges_synced: results.formchanges_synced,
                formchanges_failed: results.formchanges_failed,
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );

    } catch (error) {
        console.error("Error:", error);
        return new Response(
            JSON.stringify({ error: "Internal server error" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});
