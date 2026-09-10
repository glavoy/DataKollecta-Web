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
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.115.0";

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

Deno.serve(async (req) => {
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

        // 429, and deliberately NOT through `rejected()`. That helper exists
        // to make every credential rejection byte-identical so active project
        // codes cannot be enumerated; a throttle is the one rejection that is
        // *allowed* to be distinguishable, because it says nothing about
        // whether the project, the username or the password was right -- only
        // that this caller has asked too often. Routing it through the shared
        // helper would either leak a difference into the uniform responses or
        // force the throttle to pretend to be a credential failure.
        //
        // This used to be a 401 for a client reason that no longer applies:
        // api_client.dart mapped an unrecognised 429 to a *retryable*
        // SyncTransferException, and retrying is the worst response to a
        // lockout. The client now has SyncThrottledException, which stops and
        // shows this message verbatim -- shipped first, on purpose, so no
        // build ever meets a status it mishandles.
        if (verdict?.outcome === "throttled") {
            return new Response(
                JSON.stringify({
                    error:
                        "Too many failed sign-in attempts. Please wait 15 minutes and try again.",
                }),
                { status: 429, headers: json },
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
        // Filtered in code rather than in the query: a failure here is not
        // fatal, so an `.eq("status", ...)` that raised would otherwise
        // silently leave `surveys` null -- every phone would see zero
        // downloadable surveys with no trace anywhere.
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

        const DOWNLOADABLE_STATUSES = new Set(["deployed", "test"]);
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
