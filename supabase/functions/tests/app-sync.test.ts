import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  admin,
  callFunction,
  createFixture,
  DEVICE_WALL_CLOCK,
  type Fixture,
  login,
  submission,
  warmUp,
} from "./helpers.ts";

Deno.test("warm up the edge runtime", warmUp);

/** A fixture plus a live token, torn down afterwards. */
async function withSession(
  options: Parameters<typeof createFixture>[0],
  body: (fixture: Fixture, token: string) => Promise<void>,
): Promise<void> {
  const fixture = await createFixture(options);
  try {
    await body(fixture, await login(fixture));
  } finally {
    await fixture.cleanup();
  }
}

function sync(token: string, payload: Record<string, unknown>) {
  return callFunction("app-sync", { token, ...payload });
}

// --- The token is the whole authorisation ----------------------------------

Deno.test("app-sync: an unknown token is refused", async () => {
  const { status, body } = await callFunction("app-sync", {
    token: "not-a-real-token",
    submissions: [],
    formchanges: [{ formchanges_uuid: crypto.randomUUID() }],
  });

  assertEquals(status, 401);
  assertEquals(body.error, "Invalid or expired token");
});

Deno.test("app-sync: an expired token is refused", async () => {
  await withSession({}, async (fixture, token) => {
    await admin
      .from("app_sessions")
      .update({ expires_at: new Date(Date.now() - 60_000).toISOString() })
      .eq("token", token);

    const { status } = await sync(token, { submissions: [submission(fixture)] });

    assertEquals(status, 401);
  });
});

Deno.test("app-sync: disabling a credential cuts off a token that is still valid", async () => {
  // The property that makes a 30-day token acceptable: revocation is checked
  // on every call, not just at login.
  await withSession({}, async (fixture, token) => {
    await admin.from("app_credentials").update({ is_active: false }).eq("id", fixture.credentialId);

    const { status, body } = await sync(token, { submissions: [submission(fixture)] });

    assertEquals(status, 401);
    assert(String(body.error).includes("disabled"), JSON.stringify(body));
  });
});

Deno.test("app-sync: pausing a project cuts off a token that is still valid", async () => {
  await withSession({}, async (fixture, token) => {
    await admin.from("projects").update({ status: "paused" }).eq("id", fixture.projectId);

    const { status } = await sync(token, { submissions: [submission(fixture)] });

    assertEquals(status, 401);
  });
});

Deno.test("app-sync: archiving a project cuts off a token that is still valid", async () => {
  await withSession({}, async (fixture, token) => {
    await admin
      .from("projects")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", fixture.projectId);

    const { status } = await sync(token, { submissions: [submission(fixture)] });

    assertEquals(status, 401);
  });
});

Deno.test("app-sync: a locked-out worker can still upload what they have collected", async () => {
  // What bounds the field impact of the login throttle: it gates login only.
  // A worker who has locked themselves out still syncs on their existing
  // token, so no collected data is stranded by a forgotten password.
  await withSession({}, async (fixture, token) => {
    for (let attempt = 1; attempt <= 11; attempt++) {
      await callFunction("app-login", {
        project_code: fixture.projectSlug,
        username: fixture.username,
        password: `wrong-${attempt}`,
        device_id: "test-device",
        device_info: {},
      });
    }

    const { status, body } = await sync(token, { submissions: [submission(fixture)] });

    assertEquals(status, 200, JSON.stringify(body));
    assertEquals(body.synced_count, 1);
  });
});

// --- Cross-project isolation ------------------------------------------------

Deno.test("app-sync: a submission for another project's survey is rejected", async () => {
  // The boundary that stops one project's device writing into another's data.
  // The package lookup is scoped to the session's project, so the surveyId
  // simply does not resolve.
  await withSession({}, async (fixture, token) => {
    const other = await createFixture({});
    try {
      const foreign = submission(fixture, {
        data: { survey_id: other.surveyId, uniqueid: crypto.randomUUID() },
      });

      const { status, body } = await sync(token, { submissions: [foreign] });

      assertEquals(status, 200);
      assertEquals(body.synced_count, 0);
      assertEquals(body.failed.length, 1);
      assert(
        String(body.failed[0].error).includes("Survey package not found"),
        JSON.stringify(body.failed[0]),
      );

      const { count } = await admin
        .from("submissions")
        .select("id", { count: "exact", head: true })
        .eq("project_id", other.projectId);
      assertEquals(count, 0, "a submission crossed into the other project");
    } finally {
      await other.cleanup();
    }
  });
});

// --- M6: attribution is server-derived --------------------------------------

Deno.test("app-sync: a client-supplied surveyor_id is ignored on formchanges", async () => {
  // The Windows build keeps its SQLite file as an ordinary editable file, so a
  // client value here would let anyone write another person's name into the
  // edit audit log.
  await withSession({}, async (fixture, token) => {
    const uuid = crypto.randomUUID();
    const { status, body } = await sync(token, {
      submissions: [],
      formchanges: [{
        formchanges_uuid: uuid,
        record_uuid: crypto.randomUUID(),
        tablename: "enrollee",
        fieldname: "age",
        oldvalue: "31",
        newvalue: "32",
        surveyor_id: "supervisor",
        changed_at: DEVICE_WALL_CLOCK,
      }],
    });

    assertEquals(status, 200, JSON.stringify(body));
    assertEquals(body.formchanges_synced, [uuid]);

    const { data } = await admin
      .from("formchanges").select("surveyor_id").eq("formchanges_uuid", uuid).single();
    assertEquals(data!.surveyor_id, fixture.username);
  });
});

Deno.test("app-sync: submissions record the authenticated username, not the device's", async () => {
  await withSession({}, async (fixture, token) => {
    const row = submission(fixture, { surveyor_id: "supervisor" });

    await sync(token, { submissions: [row] });

    const { data } = await admin
      .from("submissions")
      .select("surveyor_id")
      .eq("local_unique_id", row.local_uuid as string)
      .single();
    assertEquals(data!.surveyor_id, fixture.username);
  });
});

// --- Device timestamps are a wall clock, not an instant ---------------------

Deno.test("app-sync: an offset-less collected_at is stored verbatim, not shifted", async () => {
  // The regression test for the bug this convention exists to prevent.
  // `collected_at` used to be `timestamptz`, so the app's bare local
  // wall-clock string was read as UTC -- and in a UTC+3 deployment every
  // record then looked collected three hours AFTER it was submitted.
  //
  // Stored verbatim is the whole assertion: no offset appears, and no
  // arithmetic is applied. It must also still equal the `stoptime` it was
  // taken from, since that is where RecordUploader reads it.
  await withSession({}, async (fixture, token) => {
    const row = submission(fixture);

    const { status, body } = await sync(token, { submissions: [row] });
    assertEquals(status, 200, JSON.stringify(body));

    const { data } = await admin
      .from("submissions")
      .select("collected_at, submitted_at, data")
      .eq("local_unique_id", row.local_uuid as string)
      .single();

    assertEquals(data!.collected_at, DEVICE_WALL_CLOCK);
    assertEquals(data!.collected_at, data!.data.stoptime);

    // And the server's own column is still a real UTC instant, so the two
    // conventions stay tellable apart by the presence of an offset.
    assert(
      /(Z|[+-]\d\d:?\d\d)$/.test(data!.submitted_at),
      `submitted_at should carry an offset, got ${data!.submitted_at}`,
    );
  });
});

Deno.test("app-sync: an offset-less changed_at is stored verbatim, not shifted", async () => {
  await withSession({}, async (fixture, token) => {
    const uuid = crypto.randomUUID();

    const { status, body } = await sync(token, {
      submissions: [],
      formchanges: [{
        formchanges_uuid: uuid,
        record_uuid: crypto.randomUUID(),
        tablename: "enrollee",
        fieldname: "age",
        oldvalue: "31",
        newvalue: "32",
        changed_at: DEVICE_WALL_CLOCK,
      }],
    });

    assertEquals(status, 200, JSON.stringify(body));

    const { data } = await admin
      .from("formchanges")
      .select("changed_at, synced_at")
      .eq("formchanges_uuid", uuid)
      .single();

    assertEquals(data!.changed_at, DEVICE_WALL_CLOCK);
    assert(
      /(Z|[+-]\d\d:?\d\d)$/.test(data!.synced_at),
      `synced_at should carry an offset, got ${data!.synced_at}`,
    );
  });
});

Deno.test("app-sync: an offset on collected_at is DROPPED, not converted", async () => {
  // Pinning a known hazard rather than endorsing it. `collected_at` is
  // `timestamp without time zone`, so casting a string that carries an
  // offset discards it: +03:00 13:49 is stored as 13:49, not as the 10:49
  // it actually denotes. Harmless today -- no client sends an offset -- but
  // the day the app is changed to send real UTC instants, this test fails
  // and forces the column semantics to be dealt with at the same time.
  await withSession({}, async (fixture, token) => {
    const row = submission(fixture, {
      collected_at: `${DEVICE_WALL_CLOCK}+03:00`,
    });

    const { status, body } = await sync(token, { submissions: [row] });
    assertEquals(status, 200, JSON.stringify(body));

    const { data } = await admin
      .from("submissions")
      .select("collected_at")
      .eq("local_unique_id", row.local_uuid as string)
      .single();

    assertEquals(data!.collected_at, DEVICE_WALL_CLOCK);
  });
});

// --- M3: table_name validation and the batch cap ----------------------------

Deno.test("app-sync: a table_name that is not a form in the survey is rejected", async () => {
  await withSession({}, async (fixture, token) => {
    const phantom = submission(fixture, { table_name: "enrollee_v2" });

    const { body } = await sync(token, { submissions: [phantom] });

    assertEquals(body.synced_count, 0);
    assert(
      String(body.failed[0].error).includes("is not a form in survey"),
      JSON.stringify(body.failed[0]),
    );
  });
});

Deno.test("app-sync: table_name is matched case-insensitively and stored verbatim", async () => {
  // The device lowercases its SQLite table names; the manifest carries them as
  // the dictionary author wrote them.
  await withSession({}, async (fixture, token) => {
    const row = submission(fixture, { table_name: "ENROLLEE" });

    const { body } = await sync(token, { submissions: [row] });
    assertEquals(body.synced_count, 1, JSON.stringify(body));

    const { data } = await admin
      .from("submissions")
      .select("table_name")
      .eq("local_unique_id", row.local_uuid as string)
      .single();
    assertEquals(data!.table_name, "ENROLLEE");
  });
});

Deno.test("app-sync: a manifest with no crfs list accepts any table_name", async () => {
  // Fails OPEN deliberately. Refusing a field worker's collected data because
  // a legacy manifest lacks a key would be far worse than the phantom form the
  // check exists to prevent.
  await withSession({ tableNames: null }, async (fixture, token) => {
    const row = submission(fixture, { table_name: "whatever_old_form" });

    const { body } = await sync(token, { submissions: [row] });

    assertEquals(body.synced_count, 1, JSON.stringify(body));
  });
});

Deno.test("app-sync: an oversized batch is refused with 413", async () => {
  await withSession({}, async (fixture, token) => {
    const rows = Array.from({ length: 501 }, () => submission(fixture));

    const { status, body } = await sync(token, { submissions: rows });

    assertEquals(status, 413);
    assert(String(body.error).includes("Too many rows"), JSON.stringify(body));
  });
});

Deno.test("app-sync: a batch at exactly the cap is accepted", async () => {
  await withSession({}, async (fixture, token) => {
    const rows = Array.from({ length: 500 }, () => submission(fixture));

    const { status, body } = await sync(token, { submissions: rows });

    assertEquals(status, 200, JSON.stringify(body).slice(0, 200));
    assertEquals(body.synced_count, 500);
  });
});

// --- M1: batching keeps the per-id contract ---------------------------------

Deno.test("app-sync: one bad row does not cost the rest of the batch their result", async () => {
  // The reason the bulk upsert has a per-row replay. The app marks rows synced
  // individually from these lists, and the uploader's cursor advances past a
  // failed batch -- so a batch reported as wholly failed would strand good
  // records with no cause an interviewer could see.
  await withSession({ tableNames: null }, async (fixture, token) => {
    const good = [submission(fixture), submission(fixture), submission(fixture)];
    // table_name is NOT NULL, and the fail-open manifest lets it past
    // validation, so this row fails in the database rather than before it.
    const bad = submission(fixture, { table_name: null });

    const { status, body } = await sync(token, {
      submissions: [good[0], bad, good[1], good[2]],
    });

    assertEquals(status, 200, JSON.stringify(body));
    assertEquals(body.synced_count, 3);
    assertEquals(body.failed.length, 1);
    assertEquals(body.failed[0].id, bad.local_uuid);
    for (const row of good) {
      assert(body.synced.includes(row.local_uuid), `${row.local_uuid} was not reported synced`);
    }
  });
});

Deno.test("app-sync: two rows sharing a local_uuid store the later one and acknowledge both", async () => {
  // A duplicate-uniqueid pair (the historical double-tap-save) sweeps both
  // rows into one batch. Postgres refuses to let one statement's ON CONFLICT
  // touch a row twice, so they are collapsed before the write -- later wins,
  // exactly as the old per-row loop did by upserting them in order.
  await withSession({}, async (fixture, token) => {
    const localUuid = crypto.randomUUID();
    const first = submission(fixture, {
      local_uuid: localUuid,
      data: { survey_id: fixture.surveyId, uniqueid: localUuid, which: "first" },
    });
    const second = submission(fixture, {
      local_uuid: localUuid,
      data: { survey_id: fixture.surveyId, uniqueid: localUuid, which: "second" },
    });

    const { body } = await sync(token, { submissions: [first, second] });

    assertEquals(body.failed.length, 0, JSON.stringify(body.failed));
    assertEquals(body.synced.filter((id: string) => id === localUuid).length, 2);

    const { data } = await admin
      .from("submissions").select("data").eq("local_unique_id", localUuid).single();
    assertEquals(data!.data.which, "second");
  });
});

Deno.test("app-sync: a re-sent record updates in place rather than duplicating", async () => {
  await withSession({}, async (fixture, token) => {
    const row = submission(fixture);

    await sync(token, { submissions: [row] });
    await sync(token, { submissions: [row] });

    const { count } = await admin
      .from("submissions")
      .select("id", { count: "exact", head: true })
      .eq("local_unique_id", row.local_uuid as string);
    assertEquals(count, 1);
  });
});

Deno.test("app-sync: a submission with no survey_id fails with its own message", async () => {
  await withSession({}, async (fixture, token) => {
    const row = submission(fixture, { data: { uniqueid: crypto.randomUUID() } });

    const { body } = await sync(token, { submissions: [row] });

    assertEquals(body.synced_count, 0);
    assertEquals(body.failed[0].error, "Missing survey_id in submission data");
  });
});

Deno.test("app-sync: the batch resolves its survey packages in one query", async () => {
  // M1. Measured rather than asserted structurally: pg_stat_statements counts
  // how many times the survey_packages lookup actually ran for one request.
  // It used to be one per submission.
  await withSession({}, async (fixture, token) => {
    await runSql("select extensions.pg_stat_statements_reset();");

    const rows = Array.from({ length: 20 }, () => submission(fixture));
    const { body } = await sync(token, { submissions: rows });
    assertEquals(body.synced_count, 20, JSON.stringify(body).slice(0, 200));

    const calls = await runSql(
      `select coalesce(sum(calls), 0) from extensions.pg_stat_statements
        where query ilike '%survey_packages%' and query ilike '%pgrst_source%';`,
    );
    assertEquals(calls, "1", `expected one lookup for the whole batch, got ${calls}`);
  });
});

async function runSql(statement: string): Promise<string> {
  const command = new Deno.Command("psql", {
    args: [
      Deno.env.get("SUPABASE_DB_URL") ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
      "-tA",
      "-c",
      statement,
    ],
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout, stderr } = await command.output();
  if (code !== 0) throw new Error(new TextDecoder().decode(stderr));
  return new TextDecoder().decode(stdout).trim();
}
