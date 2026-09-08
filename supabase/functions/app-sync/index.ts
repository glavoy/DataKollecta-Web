// Pinned to an exact version on purpose. `@2` is a floating major: every
// redeploy re-resolves it, so a supabase-js release could change how these two
// endpoints behave without a single line of this repo changing, and the first
// sign of it would be field devices failing to sync. Bump it deliberately,
// with the Edge Function tests run against the new version.
//
// The HTTP server used to come from `https://deno.land/std@0.168.0`, fetched
// from someone else's domain on every deploy for something the runtime
// provides. `Deno.serve` is built in: one less remote dependency that can
// move or vanish, and one less 2022 pin to explain.
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.115.0";

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

/// The most rows this function will accept in one array.
///
/// Deliberately far above anything the app sends: RecordUploader's configurable
/// batch size defaults to 25 and clamps itself well under this, so a 413 means
/// a caller that is not the app -- not a field device that was tuned upward.
/// Without a cap, a single request could hand this function a 50MB array to
/// process, which is the M3 half of the same finding as the table_name check
/// below.
const MAX_BATCH_ROWS = 500;

/// One validated row, paired with the wire id the caller expects back in
/// `synced` / `failed`.
interface PreparedRow {
    id: string;
    row: Record<string, unknown>;
}

/// The table names a survey package's manifest declares, lowercased, or `null`
/// if the manifest declares no usable list.
///
/// `null` deliberately means "unknown", and an unknown list skips the
/// table_name check rather than rejecting everything. A manifest with no `crfs`
/// array is a legacy or half-written package, and refusing a field worker's
/// collected data on the strength of a missing manifest key would be a far
/// worse failure than the phantom form the check exists to prevent.
function manifestTableNames(manifest: Record<string, unknown> | null): Set<string> | null {
    const crfs = manifest?.crfs;
    if (!Array.isArray(crfs)) return null;

    const names = new Set<string>();
    for (const crf of crfs) {
        const name = (crf as Record<string, unknown> | null)?.tablename;
        if (typeof name === "string" && name.length > 0) names.add(name.toLowerCase());
    }
    return names.size > 0 ? names : null;
}

/// A tolerant view of one client-supplied row.
///
/// Everything in the request body comes from `req.json()`, so every field is
/// untrusted and possibly absent. These helpers keep that explicit rather than
/// leaning on `any`, which this repo's lint rules now forbid anyway.
function asRecord(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === "object"
        ? value as Record<string, unknown>
        : {};
}

/// The `survey_id` a submission declares, coerced the way the old lookup did:
/// anything falsy counts as absent, anything else is compared as a string.
function declaredSurveyId(submission: unknown): string {
    const value = asRecord(asRecord(submission).data).survey_id;
    return value ? String(value) : "";
}

/// A wire id as it will be echoed back in `synced` / `failed`.
///
/// A missing id becomes "" rather than vanishing from the JSON. The app already
/// reads it that way (`ApiSyncFailure`'s `map['id']?.toString() ?? ''`), and an
/// error entry with no id at all told it nothing.
function asWireId(value: unknown): string {
    return typeof value === "string" ? value : String(value ?? "");
}

/// Writes [prepared] with one bulk upsert, falling back to a row-by-row replay
/// if that statement fails.
///
/// The fallback is not belt-and-braces, it is what keeps the API contract. A
/// single `.upsert(array)` is ONE statement: if one row violates a constraint
/// the whole batch fails, and this function's contract is a per-id `synced` /
/// `failed` list that RecordUploader uses to mark rows synced individually. A
/// batch reported as wholly failed would leave good records unsynced with no
/// cause an interviewer could see, and the uploader's cursor advances past a
/// failed batch -- so those rows would simply sit there. The happy path is one
/// round trip; only a batch that actually contains a bad row pays the old
/// per-row cost.
async function upsertBatch(
    supabase: SupabaseClient,
    table: string,
    onConflict: string,
    keyOf: (row: Record<string, unknown>) => string,
    prepared: PreparedRow[],
    synced: string[],
    failed: { id: string; error: string }[],
): Promise<void> {
    if (prepared.length === 0) return;

    // Collapse rows that share a conflict target before the bulk write.
    // Postgres refuses to let one statement's ON CONFLICT DO UPDATE touch the
    // same row twice ("cannot affect row a second time"), so without this a
    // batch carrying two rows with the same key fails as a whole -- on a shape
    // the app documents as normal, since a duplicate-uniqueid pair (the
    // historical double-tap-save, see DbService.collapseDuplicateUniqueIds)
    // sweeps both rows into one batch. Later wins, which is exactly what the
    // old per-submission loop did by upserting them in order.
    const rowByKey = new Map<string, Record<string, unknown>>();
    const idsByKey = new Map<string, string[]>();
    for (const { id, row } of prepared) {
        const key = keyOf(row);
        rowByKey.set(key, row);
        const ids = idsByKey.get(key);
        if (ids) ids.push(id);
        else idsByKey.set(key, [id]);
    }

    const keys = [...rowByKey.keys()];
    const rows = keys.map((key) => rowByKey.get(key)!);

    const { error: bulkError } = await supabase.from(table).upsert(rows, { onConflict });

    if (!bulkError) {
        for (const key of keys) synced.push(...idsByKey.get(key)!);
        return;
    }

    console.error(
        `Bulk upsert into ${table} failed, replaying ${keys.length} row(s) individually:`,
        bulkError.message,
    );

    // The failed statement rolled back in full, so nothing was written and
    // every row is replayed, not just the ones after the offender.
    for (const key of keys) {
        const ids = idsByKey.get(key)!;
        try {
            const { error } = await supabase
                .from(table)
                .upsert(rowByKey.get(key)!, { onConflict });

            if (error) {
                for (const id of ids) failed.push({ id, error: error.message });
            } else {
                synced.push(...ids);
            }
        } catch (err) {
            for (const id of ids) failed.push({ id, error: String(err) });
        }
    }
}

Deno.serve(async (req) => {
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

        const submissionRows: unknown[] = Array.isArray(submissions) ? submissions : [];
        const formchangeRows: unknown[] = Array.isArray(formchanges) ? formchanges : [];

        // Checked before any database work, and before the token, so an
        // oversized body costs nothing to refuse.
        if (submissionRows.length > MAX_BATCH_ROWS || formchangeRows.length > MAX_BATCH_ROWS) {
            return new Response(
                JSON.stringify({
                    error: `Too many rows in one request. The limit is ${MAX_BATCH_ROWS} ` +
                        `submissions and ${MAX_BATCH_ROWS} formchanges; this request had ` +
                        `${submissionRows.length} and ${formchangeRows.length}.`,
                }),
                { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } }
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
        if (submissionRows.length > 0) {
            // Resolve every survey package this batch needs in ONE query.
            //
            // This used to be a lookup per submission, inside the loop below,
            // and `.contains("manifest", ...)` on an unindexed jsonb column at
            // that -- so a 25-record batch made 25 sequential scans of
            // survey_packages before writing anything, and the cost grew with
            // every version a project accumulated. The batch's distinct
            // surveyIds are almost always a single value.
            //
            // The mobile app sends surveyId (a string like
            // "r21_test_negative_2025-12-30"); the column the submission needs
            // is the survey_packages UUID.
            const wantedSurveyIds = [...new Set(
                submissionRows.map(declaredSurveyId).filter((id) => id.length > 0),
            )];

            const packagesBySurveyId = new Map<
                string,
                { id: string; tableNames: Set<string> | null }
            >();

            if (wantedSurveyIds.length > 0) {
                // `manifest->>surveyId` rather than `.contains(...)`: it is a
                // scalar comparison an index can serve (see
                // idx_survey_packages_manifest_survey_id), and unlike a
                // containment test it can be batched with `.in(...)`.
                const { data: packages, error: lookupError } = await supabase
                    .from("survey_packages")
                    .select("id, version, manifest")
                    .eq("project_id", session.project_id)
                    .in("manifest->>surveyId", wantedSurveyIds);

                if (lookupError) {
                    // Every submission in the batch then reports "not found"
                    // below, exactly as a per-row lookup failure used to.
                    // Logged because that message otherwise blames the
                    // package for what was a database error.
                    console.error(
                        "Survey package lookup failed for surveyIds " +
                            `${JSON.stringify(wantedSurveyIds)}:`,
                        lookupError.message,
                    );
                }

                // Ascending by version so the highest version wins the map
                // slot. Two packages in one project CAN share a manifest
                // surveyId -- the unique index on survey_packages is
                // (created_by, lower(name)), so two portal users uploading
                // the same package into one project is enough -- and the old
                // `.maybeSingle()` turned that into a hard error that failed
                // every submission for that survey. Attributing to the
                // highest version is deterministic and keeps the data.
                const ordered = [...(packages ?? [])].sort(
                    (a, b) => ((a.version as number) ?? 0) - ((b.version as number) ?? 0),
                );

                for (const pkg of ordered) {
                    const manifest = (pkg.manifest ?? null) as Record<string, unknown> | null;
                    const surveyId = typeof manifest?.surveyId === "string"
                        ? manifest.surveyId
                        : null;
                    if (!surveyId) continue;

                    if (packagesBySurveyId.has(surveyId)) {
                        console.warn(
                            `Project ${session.project_id} has more than one survey package ` +
                                `whose manifest surveyId is "${surveyId}"; attributing this ` +
                                `batch to the highest version.`,
                        );
                    }
                    packagesBySurveyId.set(surveyId, {
                        id: pkg.id as string,
                        tableNames: manifestTableNames(manifest),
                    });
                }
            }

            const prepared: PreparedRow[] = [];

            for (const raw of submissionRows) {
                const submission = asRecord(raw);
                try {
                    const surveyIdFromData = declaredSurveyId(submission);

                    if (!surveyIdFromData) {
                        results.failed.push({
                            id: asWireId(submission.local_uuid),
                            error: "Missing survey_id in submission data",
                        });
                        continue;
                    }

                    const surveyPackage = packagesBySurveyId.get(surveyIdFromData);

                    if (!surveyPackage) {
                        results.failed.push({
                            id: asWireId(submission.local_uuid),
                            error: `Survey package not found for survey_id: ${surveyIdFromData}`,
                        });
                        continue;
                    }

                    // The table name has to be one of the survey's own forms.
                    // Nothing checked it before, so a buggy or tampered client
                    // could write rows under a table_name that exists in no
                    // package -- and they then showed up as a phantom form in
                    // the portal's data browser and CSV exports, traceable to
                    // no XML. Compared case-insensitively because the device
                    // lowercases its SQLite table names while the manifest
                    // carries them as the dictionary author wrote them; the
                    // value stored is still exactly what the client sent.
                    const tableName = submission.table_name;
                    if (
                        surveyPackage.tableNames &&
                        (typeof tableName !== "string" ||
                            !surveyPackage.tableNames.has(tableName.toLowerCase()))
                    ) {
                        results.failed.push({
                            id: asWireId(submission.local_uuid),
                            error: `Table "${tableName}" is not a form in survey ` +
                                `"${surveyIdFromData}"`,
                        });
                        continue;
                    }

                    prepared.push({
                        id: asWireId(submission.local_uuid),
                        row: {
                            project_id: session.project_id,
                            survey_package_id: surveyPackage.id,
                            table_name: tableName,
                            local_unique_id: submission.local_uuid,
                            data: submission.data,
                            version: 1,
                            device_id: submission.device_id,
                            surveyor_id: session.app_credentials.username,
                            app_version: submission.swver,
                            // Stored verbatim, and the column is
                            // `timestamp without time zone` so that stays
                            // true. The app sends its `stoptime`: a bare
                            // local wall-clock reading with no offset,
                            // because `auto_fields.dart` formats a local
                            // `DateTime`. This used to land in a
                            // `timestamptz`, which read the offset-less
                            // string as UTC and made every record look
                            // collected three hours after it was submitted
                            // in a UTC+3 deployment.
                            //
                            // The contract is therefore: no offset, and no
                            // claim about one. If a future client ever does
                            // send an offset, the cast into the column
                            // silently DROPS it -- storing UTC digits in a
                            // wall-clock column, which is the same class of
                            // bug in the other direction. A test pins that
                            // behaviour so the app change that starts
                            // sending offsets has to deal with it here.
                            collected_at: submission.collected_at,
                            // Server-set, genuinely UTC, and `timestamptz`
                            // -- like `submitted_at`. Keeping the two kinds
                            // of column distinct is what lets a reader tell
                            // a server instant from a device reading.
                            updated_at: new Date().toISOString(),
                        },
                    });
                } catch (err) {
                    results.failed.push({
                        id: asWireId(submission.local_uuid),
                        error: String(err),
                    });
                }
            }

            await upsertBatch(
                supabase,
                "submissions",
                "project_id,table_name,local_unique_id",
                (row) => JSON.stringify([row.project_id, row.table_name, row.local_unique_id]),
                prepared,
                results.synced,
                results.failed,
            );
        }

        // 2. Process Formchanges (field-level audit log)
        if (formchangeRows.length > 0) {
            const prepared: PreparedRow[] = [];

            for (const raw of formchangeRows) {
                const change = asRecord(raw);
                prepared.push({
                    id: asWireId(change.formchanges_uuid),
                    row: {
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
                        // The device's own wall clock for the edit, with no
                        // offset -- same contract, and same reasoning, as
                        // `submissions.collected_at` above.
                        changed_at: change.changed_at,
                        // Server-set and genuinely UTC, like `submitted_at`.
                        synced_at: new Date().toISOString(),
                    },
                });
            }

            // Not validated against a survey package the way `table_name` is
            // above: a formchange carries no survey_id, so there is nothing
            // here to resolve a package from. Doing it would need a lookup
            // through `record_uuid` -> submissions, which is a query per row
            // -- the very cost this change removed.
            await upsertBatch(
                supabase,
                "formchanges",
                "formchanges_uuid",
                (row) => JSON.stringify([row.formchanges_uuid]),
                prepared,
                results.formchanges_synced,
                results.formchanges_failed,
            );
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
