import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Empty on purpose. Nothing in the portal calls this function -- the only
// references in src/ are comments -- and the Flutter client is not a browser,
// so it sends no Origin and is unaffected by any policy here. It used to
// answer every origin with `*`, which let any web page drive the endpoint from
// its visitors' browsers.
//
// Worth being precise about what this buys: CORS does not stop a request being
// *made*, it stops a browser *reading the response*. So this raises the bar for
// browser-driven credential guessing and does nothing against curl. The
// throttle inside verify_app_credential is the substantive control; this is
// defence in depth. Add an origin here if a real web client ever needs one.
const ALLOWED_ORIGINS: readonly string[] = [];

function corsHeaders(req: Request): Record<string, string> {
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

/// Best-effort caller address for the per-IP throttle. Supabase sets
/// x-forwarded-for; a spoofed value can only ever cost the spoofer their own
/// bucket, since the per-username limit is enforced independently.
function clientIp(req: Request): string | null {
    const forwarded = req.headers.get("x-forwarded-for");
    if (!forwarded) return null;
    return forwarded.split(",")[0].trim() || null;
}

serve(async (req) => {
    const cors = corsHeaders(req);
    const json = { ...cors, "Content-Type": "application/json" };

    // Handle CORS preflight
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: cors });
    }

    // One response for every way a login can be rejected. Splitting these --
    // 404 "Project not found" for an unknown project, 401 "Invalid username or
    // password" for bad credentials -- is what made active project codes
    // enumerable, and it defeated the guard the old comment here said it was
    // providing. The matching timing oracle is closed inside
    // verify_app_credential, which always runs one bcrypt comparison whether or
    // not a credential matched.
    const rejected = (message = "Invalid project code, username, or password") =>
        new Response(JSON.stringify({ error: message }), { status: 401, headers: json });

    try {
        const { project_code, username, password, device_id, device_info } = await req.json();

        // Validate input
        if (!project_code || !username || !password) {
            return new Response(
                JSON.stringify({ error: "Missing required fields" }),
                { status: 400, headers: json }
            );
        }

        // Create Supabase client with service role (bypasses RLS)
        const supabase = createClient(
            Deno.env.get("SUPABASE_URL")!,
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
        );

        // 1. Throttle check, project + credential lookup, bcrypt verify, attempt
        // recording and opportunistic re-hash to the current cost -- all in one
        // atomic round trip. Verification lives in Postgres rather than here
        // because pgcrypto is native C: the cost factor moved from pgcrypto's
        // default of 6 to 12 (64x the work), which pure-JS bcryptjs could not
        // have absorbed. EXECUTE on this function is granted to service_role
        // only, so the public anon key compiled into the APK cannot call it
        // directly as a guessing oracle.
        const { data: verdict, error: verifyError } = await supabase.rpc(
            "verify_app_credential",
            {
                p_project_code: project_code,
                p_username: username,
                p_password: password,
                p_ip: clientIp(req),
            },
        );

        if (verifyError) {
            console.error("verify_app_credential failed:", verifyError.message);
            return new Response(
                JSON.stringify({ error: "Internal server error" }),
                { status: 500, headers: json }
            );
        }

        // 401 rather than 429 deliberately. api_client.dart maps 401 to
        // SyncAuthException -- which stops the sync run and shows this message
        // verbatim -- while an unrecognised 429 falls through to
        // SyncTransferException, a *retryable* transfer error. Retrying is
        // exactly the wrong response to a lockout, and this way the behaviour
        // is correct on handsets already in the field. Moving to 429 needs a
        // client change shipped first.
        if (verdict?.outcome === "throttled") {
            return rejected(
                "Too many failed sign-in attempts. Please wait 15 minutes and try again."
            );
        }

        if (verdict?.outcome !== "ok") {
            return rejected();
        }

        const project = verdict.project as { id: string; name: string; code: string };
        const credential = verdict.credential as {
            id: string;
            username: string;
            description: string | null;
        };

        // 2. Get available surveys.
        // Filtered in code rather than in the query: a `survey_status` enum
        // rename (e.g. 'active' -> 'deployed') would make `.eq("status", ...)`
        // raise "invalid input value for enum", and since a failure here is not
        // fatal, `surveys` would silently become null -- every phone would see
        // zero downloadable surveys. "active" is the pre-rename spelling of
        // "deployed", kept so this can ship ahead of (and survive) that
        // migration.
        const { data: surveys, error: surveysError } = await supabase
            .from("survey_packages")
            .select("id, name, display_name, version_date, zip_file_path, manifest, updated_at, status")
            .eq("project_id", project.id)
            .order("updated_at", { ascending: false });

        // Still permissive -- login succeeds with zero surveys rather than
        // failing outright, which is the point of the note above. But it is
        // logged now: silently returning an empty survey list to every phone
        // in a project, with no trace anywhere, is not a failure mode anyone
        // would think to look for.
        if (surveysError) {
            console.error(
                `Failed to list survey packages for project ${project.id}:`,
                surveysError.message,
            );
        }

        const DOWNLOADABLE_STATUSES = new Set(["deployed", "active", "test"]);
        // archived_at is deliberately NOT consulted here -- archiving only
        // hides a survey from the portal's default list. It does not stop
        // downloads; "complete" is what stops downloads. Keeping the two
        // independent is what makes each one predictable.
        const downloadableSurveys = (surveys || []).filter((s) => DOWNLOADABLE_STATUSES.has(s.status));

        // 3. Generate signed URLs for survey downloads (valid 24 hours)
        const surveysWithUrls = await Promise.all(
            downloadableSurveys.map(async (survey) => {
                let downloadUrl = null;
                if (survey.zip_file_path) {
                    const { data, error: signError } = await supabase.storage
                        .from("surveys")
                        .createSignedUrl(survey.zip_file_path, 86400);
                    if (signError) {
                        console.error(
                            `Failed to sign URL for survey ${survey.id} (${survey.zip_file_path}):`,
                            signError.message,
                        );
                    }
                    downloadUrl = data?.signedUrl ?? null;
                }

                // Marks test packages at the point a tester actually chooses
                // one -- the download screen -- with no Flutter change needed.
                const baseName = survey.display_name || survey.name;
                const displayName = survey.status === "test" ? `[TEST] ${baseName}` : baseName;

                return {
                    id: survey.id,
                    name: displayName,
                    version: survey.version_date, // Map version_date to version field
                    manifest: survey.manifest,
                    updated_at: survey.updated_at,
                    download_url: downloadUrl,
                };
            })
        );

        // 4. Generate session token
        const token = crypto.randomUUID();
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

        // Checked, not fire-and-forget. If this insert fails the function used
        // to still return success with a token that can never validate, so the
        // app logged in cleanly and then 401'd on every subsequent sync with
        // nothing to explain why.
        const { error: sessionError } = await supabase.from("app_sessions").insert({
            credential_id: credential.id,
            project_id: project.id,
            token: token,
            expires_at: expiresAt.toISOString(),
            device_id: device_id || null,
            device_info: device_info || null,
        });

        if (sessionError) {
            console.error("Failed to create app session:", sessionError.message);
            return new Response(
                JSON.stringify({ error: "Internal server error" }),
                { status: 500, headers: json }
            );
        }

        // 5. Return success response
        return new Response(
            JSON.stringify({
                success: true,
                project: {
                    id: project.id,
                    name: project.name,
                    code: project.code,
                },
                credential: {
                    id: credential.id,
                    username: credential.username,
                    description: credential.description,
                },
                surveys: surveysWithUrls,
                token: token,
                expires_at: expiresAt.toISOString(),
            }),
            { headers: json }
        );

    } catch (error) {
        console.error("Error:", error);
        return new Response(
            JSON.stringify({ error: "Internal server error" }),
            { status: 500, headers: json }
        );
    }
});
