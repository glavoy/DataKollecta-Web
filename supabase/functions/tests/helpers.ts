// Shared setup for the Edge Function tests.
//
// These are HTTP-level tests: they build real rows, call the deployed function
// over its real URL, and assert on the status and body a field device would
// actually receive. That is deliberate. Everything worth testing in app-login
// and app-sync lives in the seam between Deno, PostgREST and the SQL in the
// migrations -- a unit test with a mocked Supabase client would exercise none
// of it, and it is exactly where the bugs this suite is built around lived
// (a `.maybeSingle()` that 406s on two matches, a `crypt()` call that had to
// run on every path to close a timing oracle, a `PRAGMA`-style setting that
// only applies per connection).
//
// See supabase/functions/tests/README.md for how to run them.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.115.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

export const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

export interface FunctionResponse {
  status: number;
  /**
   * The decoded JSON body.
   *
   * `any` on purpose, and one of the few places it earns its keep: this is
   * arbitrary JSON that assertions walk into freely (`body.surveys[0].manifest
   * .surveyId`, `body.failed[0].error`). Typing it would mean either a cast at
   * every assertion or a schema that the tests then trust instead of checking.
   */
  // deno-lint-ignore no-explicit-any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
}

/** Calls an Edge Function the way the Flutter client does: anon key, JSON body. */
export async function callFunction(
  name: string,
  payload: unknown,
  headers: Record<string, string> = {},
): Promise<FunctionResponse> {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${ANON_KEY}`,
      ...headers,
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // A non-JSON body is itself worth asserting on, so it is returned as text
    // rather than swallowed.
  }
  return { status: response.status, body };
}

/** A short random suffix, so concurrent or repeated runs never collide. */
function unique(): string {
  return crypto.randomUUID().slice(0, 8);
}

export interface Fixture {
  ownerId: string;
  projectId: string;
  projectSlug: string;
  projectName: string;
  surveyDisplayName: string;
  username: string;
  password: string;
  credentialId: string;
  /** A deployed survey package, and the surveyId inside its manifest. */
  surveyPackageId: string;
  surveyId: string;
  cleanup: () => Promise<void>;
}

export interface FixtureOptions {
  projectStatus?: "active" | "paused";
  projectArchived?: boolean;
  credentialActive?: boolean;
  /** bcrypt cost for the stored hash. Used to exercise the re-hash path. */
  hashCost?: number;
  /** Manifest crfs table names. `null` writes a manifest with no crfs key. */
  tableNames?: string[] | null;
}

/**
 * A complete, self-contained world: one owner, one project, one field
 * credential, one deployed survey.
 *
 * Everything is suffixed with a random string and torn down afterwards, so the
 * suite can be run repeatedly against a stack that already holds real data
 * without disturbing it.
 */
export async function createFixture(options: FixtureOptions = {}): Promise<Fixture> {
  const {
    projectStatus = "active",
    projectArchived = false,
    credentialActive = true,
    hashCost = 12,
    tableNames = ["enrollee", "vaccination_status"],
  } = options;

  const suffix = unique();
  const ownerId = crypto.randomUUID();
  const email = `owner-${suffix}@example.test`;
  const username = `worker-${suffix}`;
  const password = "correcthorsebatterystaple";
  const surveyId = `survey_${suffix}`;

  // auth.users and profiles are not reachable through PostgREST, so the two
  // rows every other table's foreign keys need are made with SQL.
  await sql(`
    insert into auth.users (id, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, aud, role,
                            created_at, updated_at)
    values ('${ownerId}', '${email}', '', now(),
            '{"provider":"email","providers":["email"]}', '{}',
            'authenticated', 'authenticated', now(), now())
    on conflict (id) do nothing;
    insert into public.profiles (id, email, full_name)
    values ('${ownerId}', '${email}', 'Test Owner')
    on conflict (id) do nothing;
  `);

  const { data: project, error: projectError } = await admin
    .from("projects")
    .insert({
      name: `Test Project ${suffix}`,
      slug: `test-project-${suffix}`,
      status: projectStatus,
      created_by: ownerId,
      archived_at: projectArchived ? new Date().toISOString() : null,
    })
    .select()
    .single();
  if (projectError) throw projectError;

  const manifest: Record<string, unknown> = {
    surveyName: `Test Survey ${suffix}`,
    surveyId,
    databaseName: `test_${suffix}.sqlite`,
    xmlFiles: (tableNames ?? []).map((t) => `${t}.xml`),
  };
  if (tableNames !== null) {
    manifest.crfs = tableNames.map((t, i) => ({
      display_order: (i + 1) * 10,
      tablename: t,
      displayname: t,
      isbase: i === 0 ? 1 : 0,
    }));
  }

  const { data: surveyPackage, error: surveyError } = await admin
    .from("survey_packages")
    .insert({
      project_id: project.id,
      name: surveyId,
      display_name: `Test Survey ${suffix}`,
      version_date: new Date().toISOString(),
      survey_code: `code_${suffix}`,
      version: 1,
      status: "deployed",
      created_by: ownerId,
      manifest,
    })
    .select()
    .single();
  if (surveyError) throw surveyError;

  // Through the RPC, so the hash is built exactly as production builds it.
  const { error: credentialError } = await admin.rpc("create_app_credential", {
    p_project_id: project.id,
    p_username: username,
    p_password: password,
    p_description: "created by the Edge Function test suite",
  });
  if (credentialError) throw credentialError;

  const { data: credential, error: readError } = await admin
    .from("app_credentials")
    .select("id")
    .eq("project_id", project.id)
    .eq("username", username)
    .single();
  if (readError) throw readError;

  if (hashCost !== 12) {
    // The legacy shape: a hash written before the cost was raised.
    await sql(`
      update public.app_credentials
         set password_hash = extensions.crypt('${password}', extensions.gen_salt('bf', ${hashCost}))
       where id = '${credential.id}';
    `);
  }

  if (!credentialActive) {
    await admin.from("app_credentials").update({ is_active: false }).eq("id", credential.id);
  }

  return {
    ownerId,
    projectId: project.id,
    projectSlug: `test-project-${suffix}`,
    projectName: `Test Project ${suffix}`,
    surveyDisplayName: `Test Survey ${suffix}`,
    username,
    password,
    credentialId: credential.id,
    surveyPackageId: surveyPackage.id,
    surveyId,
    cleanup: async () => {
      // projects cascades to credentials, sessions, submissions, formchanges
      // and survey_packages; the profile and auth user are the only rows left.
      await admin.from("projects").delete().eq("id", project.id);
      await sql(`
        delete from public.profiles where id = '${ownerId}';
        delete from auth.users where id = '${ownerId}';
      `);
    },
  };
}

/**
 * Runs SQL through the local database.
 *
 * Only for the handful of things PostgREST cannot reach -- auth.users, and
 * writing a deliberately-legacy password hash. Everything else goes through
 * the same client the application uses.
 */
export async function sql(statements: string): Promise<void> {
  const command = new Deno.Command("psql", {
    args: [
      Deno.env.get("SUPABASE_DB_URL") ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-q",
      "-c",
      statements,
    ],
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stderr } = await command.output();
  if (code !== 0) {
    throw new Error(`psql failed: ${new TextDecoder().decode(stderr)}`);
  }
}

/**
 * Boots the edge runtime's worker for each function.
 *
 * The runtime starts a worker lazily on the first request to a function, and
 * that first request can time out as a 502 while it does -- which showed up as
 * whichever test happened to run first failing, and nothing else. Paying that
 * cost once, up front, with a deliberately invalid body keeps a cold start
 * from looking like a broken function.
 */
export async function warmUp(): Promise<void> {
  await clearLoginAttempts();
  for (const name of ["app-login", "app-sync"]) {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const { status } = await callFunction(name, {});
        if (status === 400) break; // "Missing required fields" -- the worker is up
      } catch {
        // Connection refused while the runtime starts; retry.
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

/**
 * Empties `app_login_attempts`.
 *
 * The suite deliberately generates failed logins -- the lockout tests alone
 * account for about twenty per run -- and the throttle also counts per IP, at
 * fifty failures per fifteen minutes. Every test here calls from 127.0.0.1, so
 * two or three runs in quick succession would trip that limit and every
 * subsequent test would fail at `login()` with "Too many failed sign-in
 * attempts", which looks like a broken function rather than a saturated
 * counter. (Found the hard way: the first re-run after a mutation test failed
 * 19 of 20 tests for exactly this reason.)
 *
 * Clearing it is safe because this only ever runs against a local stack, and
 * the per-IP limit itself is still asserted on directly below.
 */
export async function clearLoginAttempts(): Promise<void> {
  await sql("delete from public.app_login_attempts;");
}

/** Logs in and returns the session token, failing loudly if login did not work. */
export async function login(fixture: Fixture): Promise<string> {
  const { status, body } = await callFunction("app-login", {
    project_code: fixture.projectSlug,
    username: fixture.username,
    password: fixture.password,
    device_id: "test-device",
    device_info: { platform: "test" },
  });
  if (status !== 200 || !body?.token) {
    throw new Error(`login failed: ${status} ${JSON.stringify(body)}`);
  }
  return body.token as string;
}

/** One submission, shaped the way RecordUploader sends them. */
export function submission(
  fixture: Fixture,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const localUuid = crypto.randomUUID();
  return {
    table_name: "enrollee",
    local_uuid: localUuid,
    device_id: "test-device",
    swver: "DataKollecta test",
    collected_at: new Date().toISOString(),
    data: { survey_id: fixture.surveyId, uniqueid: localUuid, subjid: "21050050001" },
    ...overrides,
  };
}
