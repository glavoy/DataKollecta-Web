// reset_app_credential_password, tested through what a field device sees:
// app-login with the old and new password, and app-sync with a token issued
// before the reset. The RPC itself is called as a real `authenticated` portal
// user (role + JWT claims set in a transaction), because its authorization
// check is the only thing guarding a SECURITY DEFINER function -- calling it
// as service_role would skip exactly the part worth testing.

import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  admin,
  callFunction,
  createFixture,
  type Fixture,
  login,
  submission,
  warmUp,
} from "./helpers.ts";

Deno.test("warm up the edge runtime", warmUp);

const NEW_PASSWORD = "a-brand-new-passphrase";

async function withFixture(body: (fixture: Fixture) => Promise<void>): Promise<void> {
  const fixture = await createFixture();
  try {
    await body(fixture);
  } finally {
    await fixture.cleanup();
  }
}

/**
 * Calls the RPC as portal user [userId], the way PostgREST would for a signed-
 * in browser session, and returns its jsonb result. Throws with Postgres's
 * error text (e.g. "Not authorized") if the function raises.
 */
async function resetAs(userId: string, credentialId: string, password: string): Promise<Record<string, unknown>> {
  const claims = JSON.stringify({ sub: userId, role: "authenticated" });
  const command = new Deno.Command("psql", {
    args: [
      Deno.env.get("SUPABASE_DB_URL") ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-tA",
      "-q",
      "-c",
      `begin;
       set local role authenticated;
       select set_config('request.jwt.claims', '${claims}', true);
       select public.reset_app_credential_password('${credentialId}', '${password.replaceAll("'", "''")}');
       commit;`,
    ],
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout, stderr } = await command.output();
  if (code !== 0) throw new Error(new TextDecoder().decode(stderr));
  // set_config's own result line comes first; the function's jsonb is last.
  const lines = new TextDecoder().decode(stdout).trim().split("\n");
  return JSON.parse(lines[lines.length - 1]);
}

function loginWith(fixture: Fixture, password: string) {
  return callFunction("app-login", {
    project_code: fixture.projectSlug,
    username: fixture.username,
    password,
    device_id: "test-device",
    device_info: { platform: "test" },
  });
}

Deno.test("reset: the new password works and the old one is refused", async () => {
  await withFixture(async (fixture) => {
    await resetAs(fixture.ownerId, fixture.credentialId, NEW_PASSWORD);

    assertEquals((await loginWith(fixture, fixture.password)).status, 401);
    const fresh = await loginWith(fixture, NEW_PASSWORD);
    assertEquals(fresh.status, 200, JSON.stringify(fresh.body));
  });
});

Deno.test("reset: a token issued before the reset is cut off at once", async () => {
  // The device-side contract: the phone's next upload gets a 401, which is
  // what makes the app discard its token and ask for the new password,
  // instead of uploading on the old one for the rest of its 30 days.
  await withFixture(async (fixture) => {
    const token = await login(fixture);
    const before = await callFunction("app-sync", { token, submissions: [submission(fixture)] });
    assertEquals(before.status, 200, JSON.stringify(before.body));

    const result = await resetAs(fixture.ownerId, fixture.credentialId, NEW_PASSWORD);
    assertEquals(result.sessions_revoked, 1);

    const after = await callFunction("app-sync", { token, submissions: [submission(fixture)] });
    assertEquals(after.status, 401);
  });
});

Deno.test("reset: lifts a lockout caused by phones retrying the old password", async () => {
  await withFixture(async (fixture) => {
    for (let attempt = 1; attempt <= 10; attempt++) {
      await loginWith(fixture, fixture.password + "-stale");
    }
    assertEquals((await loginWith(fixture, fixture.password)).status, 429);

    await resetAs(fixture.ownerId, fixture.credentialId, NEW_PASSWORD);

    const fresh = await loginWith(fixture, NEW_PASSWORD);
    assertEquals(fresh.status, 200, JSON.stringify(fresh.body));
  });
});

Deno.test("reset: a signed-in user who is not a project owner/admin is refused", async () => {
  // A user with no membership row is the case a bare
  // `if not is_project_owner(..) and not is_project_admin(..)` gets wrong:
  // both return NULL, and the guard silently passes.
  await withFixture(async (fixture) => {
    await assertRejects(
      () => resetAs(crypto.randomUUID(), fixture.credentialId, NEW_PASSWORD),
      Error,
      "Not authorized",
    );
    assertEquals((await loginWith(fixture, fixture.password)).status, 200);
  });
});

Deno.test("reset: an unknown credential id is refused the same way", async () => {
  await withFixture(async (fixture) => {
    await assertRejects(
      () => resetAs(fixture.ownerId, crypto.randomUUID(), NEW_PASSWORD),
      Error,
      "Not authorized",
    );
  });
});

Deno.test("reset: the same password policy as creating a credential", async () => {
  await withFixture(async (fixture) => {
    await assertRejects(
      () => resetAs(fixture.ownerId, fixture.credentialId, "short"),
      Error,
      "at least 10 characters",
    );
    await assertRejects(
      () => resetAs(fixture.ownerId, fixture.credentialId, fixture.username.toUpperCase()),
      Error,
      "same as the username",
    );
    assertEquals((await loginWith(fixture, fixture.password)).status, 200);
  });
});

Deno.test("reset: the new hash is cost 12", async () => {
  await withFixture(async (fixture) => {
    await resetAs(fixture.ownerId, fixture.credentialId, NEW_PASSWORD);
    const { data, error } = await admin
      .from("app_credentials")
      .select("password_hash")
      .eq("id", fixture.credentialId)
      .single();
    if (error) throw error;
    assert(String(data.password_hash).startsWith("$2a$12$"), data.password_hash);
  });
});

Deno.test("reset_app_credential_password is not callable by anon", async () => {
  const command = new Deno.Command("psql", {
    args: [
      Deno.env.get("SUPABASE_DB_URL") ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
      "-tA",
      "-c",
      `select has_function_privilege('anon',
         'public.reset_app_credential_password(uuid,text)', 'EXECUTE');`,
    ],
    stdout: "piped",
    stderr: "piped",
  });
  const { stdout } = await command.output();
  assertEquals(new TextDecoder().decode(stdout).trim(), "f");
});
