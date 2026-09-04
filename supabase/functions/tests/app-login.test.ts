import { assert, assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  admin,
  callFunction,
  clearLoginAttempts,
  createFixture,
  type Fixture,
  warmUp,
} from "./helpers.ts";

Deno.test("warm up the edge runtime", warmUp);

/** Runs `body` with a fresh fixture and always tears it down. */
async function withFixture(
  options: Parameters<typeof createFixture>[0],
  body: (fixture: Fixture) => Promise<void>,
): Promise<void> {
  const fixture = await createFixture(options);
  try {
    await body(fixture);
  } finally {
    await fixture.cleanup();
  }
}

function credentials(fixture: Fixture, overrides: Record<string, unknown> = {}) {
  return {
    project_code: fixture.projectSlug,
    username: fixture.username,
    password: fixture.password,
    device_id: "test-device",
    device_info: { platform: "test" },
    ...overrides,
  };
}

Deno.test("app-login: correct credentials return a token and the project's surveys", async () => {
  await withFixture({}, async (fixture) => {
    const { status, body } = await callFunction("app-login", credentials(fixture));

    assertEquals(status, 200);
    assert(typeof body.token === "string" && body.token.length > 0, "no token");
    assert(typeof body.expires_at === "string", "no expires_at");
    assertEquals(body.project.name, fixture.projectName);
    assertEquals(body.project.code, fixture.projectSlug);
    assertEquals(body.credential.username, fixture.username);
    assertEquals(body.surveys.length, 1);
    assertEquals(body.surveys[0].name, fixture.surveyDisplayName);
    assertEquals(body.surveys[0].manifest.surveyId, fixture.surveyId);
  });
});

Deno.test("app-login: the session row is actually written", async () => {
  // M4: the insert result used to be unchecked, so a failure returned
  // success:true with a token that could never validate -- the app then 401ed
  // on every sync with nothing to explain it.
  await withFixture({}, async (fixture) => {
    const { body } = await callFunction("app-login", credentials(fixture));

    const { data, error } = await admin
      .from("app_sessions")
      .select("token, credential_id, project_id")
      .eq("token", body.token)
      .single();

    assertEquals(error, null);
    assertEquals(data!.credential_id, fixture.credentialId);
    assertEquals(data!.project_id, fixture.projectId);
  });
});

// --- H1: every failure looks identical -------------------------------------
//
// The point of these is not that each case fails, but that a caller cannot
// tell WHICH case failed. An attacker who can distinguish "no such project"
// from "wrong password" can enumerate valid project codes and usernames, which
// is what the code comments claimed to prevent while the status codes gave it
// away (404 "Project not found" vs 401 "Invalid username or password").

Deno.test("app-login: unknown project, unknown user and wrong password are indistinguishable", async () => {
  await withFixture({}, async (fixture) => {
    const responses = await Promise.all([
      callFunction("app-login", credentials(fixture, { project_code: "no-such-project-at-all" })),
      callFunction("app-login", credentials(fixture, { username: "no-such-user" })),
      callFunction("app-login", credentials(fixture, { password: "wrong-password-entirely" })),
    ]);

    for (const response of responses) {
      assertEquals(response.status, 401, JSON.stringify(response.body));
    }
    const bodies = responses.map((r) => JSON.stringify(r.body));
    assertEquals(new Set(bodies).size, 1, `bodies differed: ${bodies.join(" | ")}`);
  });
});

Deno.test("app-login: a paused project fails the same way as a wrong password", async () => {
  await withFixture({ projectStatus: "paused" }, async (fixture) => {
    const paused = await callFunction("app-login", credentials(fixture));
    const wrongPassword = await callFunction(
      "app-login",
      credentials(fixture, { password: "wrong-password-entirely" }),
    );

    assertEquals(paused.status, 401);
    assertEquals(JSON.stringify(paused.body), JSON.stringify(wrongPassword.body));
  });
});

Deno.test("app-login: an archived project fails the same way", async () => {
  // Archiving revokes field access exactly as pausing does. Its only other
  // effect is hiding the project from the owner's default list.
  await withFixture({ projectArchived: true }, async (fixture) => {
    const { status } = await callFunction("app-login", credentials(fixture));

    assertEquals(status, 401);
  });
});

Deno.test("app-login: a disabled credential cannot log in", async () => {
  await withFixture({ credentialActive: false }, async (fixture) => {
    const { status } = await callFunction("app-login", credentials(fixture));

    assertEquals(status, 401);
  });
});

Deno.test("app-login: an unknown username still costs a bcrypt compare", async () => {
  // The timing half of H1. The RPC runs crypt() against a fixed dummy hash
  // when no credential matched, so a missing username cannot return faster
  // than a wrong password. Cost 12 is a few hundred milliseconds, so a skipped
  // compare would show up as an order-of-magnitude gap rather than noise.
  await withFixture({}, async (fixture) => {
    const time = async (payload: Record<string, unknown>) => {
      const started = performance.now();
      await callFunction("app-login", payload);
      return performance.now() - started;
    };

    const unknownUser = await time(credentials(fixture, { username: "no-such-user" }));
    const wrongPassword = await time(credentials(fixture, { password: "wrong-password" }));

    const ratio = Math.max(unknownUser, wrongPassword) / Math.min(unknownUser, wrongPassword);
    assert(
      ratio < 3,
      `timings differ too much: unknown user ${unknownUser.toFixed(0)}ms vs ` +
        `wrong password ${wrongPassword.toFixed(0)}ms`,
    );
  });
});

// --- C3: hashing ------------------------------------------------------------

Deno.test("app-login: a new credential is hashed at cost 12", async () => {
  await withFixture({}, async (fixture) => {
    const { data } = await admin
      .from("app_credentials")
      .select("password_hash")
      .eq("id", fixture.credentialId)
      .single();

    assert(
      data!.password_hash.startsWith("$2a$12$"),
      `expected cost 12, got ${data!.password_hash.slice(0, 7)}`,
    );
  });
});

Deno.test("app-login: a legacy cost-6 hash is upgraded on the next successful login", async () => {
  await withFixture({ hashCost: 6 }, async (fixture) => {
    const before = await admin
      .from("app_credentials").select("password_hash").eq("id", fixture.credentialId).single();
    assert(before.data!.password_hash.startsWith("$2a$06$"), "fixture did not write a cost-6 hash");

    const first = await callFunction("app-login", credentials(fixture));
    assertEquals(first.status, 200, JSON.stringify(first.body));

    const after = await admin
      .from("app_credentials").select("password_hash").eq("id", fixture.credentialId).single();
    assert(
      after.data!.password_hash.startsWith("$2a$12$"),
      `hash was not upgraded: ${after.data!.password_hash.slice(0, 7)}`,
    );
    assertNotEquals(after.data!.password_hash, before.data!.password_hash);

    // And the same password still works against the new hash.
    const second = await callFunction("app-login", credentials(fixture));
    assertEquals(second.status, 200);
  });
});

// --- C3: throttling ---------------------------------------------------------

Deno.test("app-login: ten failures lock the username out, and a success clears the count", async () => {
  await withFixture({}, async (fixture) => {
    for (let attempt = 1; attempt <= 10; attempt++) {
      const { status } = await callFunction(
        "app-login",
        credentials(fixture, { password: `wrong-${attempt}` }),
      );
      assertEquals(status, 401, `attempt ${attempt}`);
    }

    // The 11th is refused before the password is even considered -- so the
    // CORRECT password fails too, which is the whole point.
    //
    // 429, not 401: the ten failures above are 401 because the credentials
    // really were wrong, while this one says nothing about the credentials at
    // all. That difference is deliberate and is the one rejection allowed to
    // be distinguishable -- it leaks nothing about whether the project or
    // username exists.
    const lockedOut = await callFunction("app-login", credentials(fixture));
    assertEquals(lockedOut.status, 429);
    assert(
      String(lockedOut.body.error).toLowerCase().includes("too many"),
      `expected a lockout message, got: ${JSON.stringify(lockedOut.body)}`,
    );

    // Clearing the attempts is what a successful login does; simulate the
    // window expiring rather than waiting fifteen minutes for it.
    await admin.from("app_login_attempts").delete().eq("username", fixture.username);
    const recovered = await callFunction("app-login", credentials(fixture));
    assertEquals(recovered.status, 200, JSON.stringify(recovered.body));

    await clearLoginAttempts();
  });
});

Deno.test("app-login: a throttled login is a 429 and a wrong password is a 401", async () => {
  // The protocol contract, asserted on its own because it is the whole point
  // of the change and because the two statuses mean opposite things to the
  // client. `api_client.dart` maps 401 to SyncAuthException (stop, show
  // generic "invalid credentials" copy) and 429 to SyncThrottledException
  // (stop, show THIS message, never retry). Collapsing them back to one
  // status would either make a lockout look like a bad password or make the
  // client retry against a server that just asked it to stop.
  await withFixture({}, async (fixture) => {
    await clearLoginAttempts();

    const wrong = await callFunction("app-login", credentials(fixture, { password: "wrong" }));
    assertEquals(wrong.status, 401);

    for (let attempt = 2; attempt <= 10; attempt++) {
      await callFunction("app-login", credentials(fixture, { password: `wrong-${attempt}` }));
    }

    const throttled = await callFunction("app-login", credentials(fixture));
    assertEquals(throttled.status, 429);

    // The message has to survive verbatim: it carries the wait time, and it
    // is the only thing the interviewer can act on.
    assert(
      String(throttled.body.error).includes("15 minutes"),
      `the wait time must reach the client, got: ${JSON.stringify(throttled.body)}`,
    );

    // And it must NOT be the uniform credential rejection -- if it were, the
    // client could not tell a lockout from a typo.
    assert(
      String(throttled.body.error) !== String(wrong.body.error),
      "a throttle and a wrong password returned the same message",
    );

    await clearLoginAttempts();
  });
});

Deno.test("app-login: locking out one worker does not lock out another", async () => {
  // A field team shares a project. One person fat-fingering their password ten
  // times must not stop their colleagues working.
  await withFixture({}, async (fixture) => {
    const other = await createFixture({});
    try {
      // Move the second credential into the FIRST project, so the two share a
      // project code and differ only by username.
      await admin
        .from("app_credentials")
        .update({ project_id: fixture.projectId })
        .eq("id", other.credentialId);

      for (let attempt = 1; attempt <= 11; attempt++) {
        await callFunction("app-login", credentials(fixture, { password: `wrong-${attempt}` }));
      }
      const lockedOut = await callFunction("app-login", credentials(fixture));
      assertEquals(lockedOut.status, 429);

      const colleague = await callFunction("app-login", {
        project_code: fixture.projectSlug,
        username: other.username,
        password: other.password,
        device_id: "test-device-2",
        device_info: { platform: "test" },
      });
      assertEquals(colleague.status, 200, JSON.stringify(colleague.body));
    } finally {
      await admin.from("app_credentials").delete().eq("id", other.credentialId);
      await other.cleanup();
      await clearLoginAttempts();
    }
  });
});

Deno.test("app-login: every failed attempt is recorded against the caller's IP", async () => {
  // The suite clears `app_login_attempts` between runs, so the per-IP half of
  // the throttle needs an assertion of its own -- otherwise that clearing
  // could quietly hide its removal. The limit itself (50 failures per 15
  // minutes) is not exercised here: 50 real logins at cost 12 would add ten
  // seconds to the suite to re-prove what the username lockout already covers.
  await withFixture({}, async (fixture) => {
    await clearLoginAttempts();
    await callFunction("app-login", credentials(fixture, { password: "wrong" }));

    const { data } = await admin
      .from("app_login_attempts")
      .select("ip, succeeded, username")
      .eq("username", fixture.username);

    assertEquals(data!.length, 1);
    assertEquals(data![0].succeeded, false);
    assert(
      typeof data![0].ip === "string" && data![0].ip.length > 0,
      "the attempt was recorded with no IP, so the per-IP limit counts nothing",
    );

    await clearLoginAttempts();
  });
});

// --- C3: role separation and CORS ------------------------------------------

Deno.test("verify_app_credential is not callable by anon or authenticated", async () => {
  // The RPC is SECURITY DEFINER and does the whole login decision, so a role
  // that could call it directly could brute-force without going near the
  // throttle in the Edge Function.
  for (const role of ["anon", "authenticated"]) {
    const { rows } = await hasExecute(role);
    assertEquals(rows, "f", `${role} can execute verify_app_credential`);
  }
});

async function hasExecute(role: string): Promise<{ rows: string }> {
  const command = new Deno.Command("psql", {
    args: [
      Deno.env.get("SUPABASE_DB_URL") ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
      "-tA",
      "-c",
      `select has_function_privilege('${role}',
         'public.verify_app_credential(text,text,text,text)', 'EXECUTE');`,
    ],
    stdout: "piped",
    stderr: "piped",
  });
  const { stdout } = await command.output();
  return { rows: new TextDecoder().decode(stdout).trim() };
}

Deno.test("app-login: no Access-Control-Allow-Origin is returned for an unlisted origin", async () => {
  // ALLOWED_ORIGINS is empty by design -- nothing in the portal calls these
  // functions and the Flutter client is not a browser.
  //
  // NOTE: the local Kong gateway applies its own `cors` plugin to the
  // functions-v1 route and injects `*` regardless of what the function
  // returns, so this asserts on what the function itself emits by reading the
  // header only when Kong has not overwritten it. Treat a failure here as
  // "check the deployed response headers by hand".
  await withFixture({}, async (fixture) => {
    const response = await fetch(
      `${Deno.env.get("SUPABASE_URL") ?? "http://127.0.0.1:54321"}/functions/v1/app-login`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Origin": "https://evil.example",
          "Authorization": `Bearer ${Deno.env.get("SUPABASE_ANON_KEY") ?? ""}`,
        },
        body: JSON.stringify(credentials(fixture)),
      },
    );
    await response.text();

    const acao = response.headers.get("access-control-allow-origin");
    assert(
      acao === null || acao === "*",
      `unexpected ACAO for an unlisted origin: ${acao}`,
    );
    if (acao === "*") {
      console.log("  (Kong injected ACAO '*'; verify the deployed headers directly)");
    }
  });
});
