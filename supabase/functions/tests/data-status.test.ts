// submissions.data_status (migration 20261006090000): every record says
// whether its survey was in test or deployed when the server first received
// it, a resync never changes that, and only the owner-only, audited
// reclassify_submissions RPC can.
//
// Tested through app-sync, because that is the only write path a record has:
// the stamp lives in a trigger precisely so that neither the function nor the
// device has to know a survey's status.
import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { admin, callFunction, createFixture, login, submission, warmUp, type Fixture } from "./helpers.ts";

Deno.test("data status runtime warmup", warmUp);

async function statusOf(fixture: Fixture, localUuid: unknown): Promise<string> {
  const { data, error } = await admin
    .from("submissions")
    .select("data_status")
    .eq("project_id", fixture.projectId)
    .eq("local_unique_id", localUuid)
    .single();
  if (error) throw error;
  return data.data_status;
}

async function idOf(fixture: Fixture, localUuid: unknown): Promise<string> {
  const { data, error } = await admin
    .from("submissions")
    .select("id")
    .eq("project_id", fixture.projectId)
    .eq("local_unique_id", localUuid)
    .single();
  if (error) throw error;
  return data.id;
}

/**
 * Calls reclassify_submissions as portal user [userId], the way PostgREST
 * would for a signed-in browser session -- the same approach as
 * credential-reset.test.ts. Returns the number of rows changed, or throws with
 * Postgres's error text.
 */
async function reclassifyAs(
  userId: string,
  projectId: string,
  ids: string[],
  status: string,
  reason: string,
): Promise<number> {
  const claims = JSON.stringify({ sub: userId, role: "authenticated" });
  const idArray = `array[${ids.map((id) => `'${id}'`).join(",")}]::uuid[]`;
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
       select public.reclassify_submissions('${projectId}', ${idArray}, '${status}', '${reason.replaceAll("'", "''")}');
       commit;`,
    ],
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout, stderr } = await command.output();
  if (code !== 0) throw new Error(new TextDecoder().decode(stderr));
  const lines = new TextDecoder().decode(stdout).trim().split("\n");
  return Number(lines[lines.length - 1]);
}

Deno.test("a record is stamped with the survey's status when it first arrives, and keeps it", async () => {
  const f = await createFixture({ surveyStatus: "test" });
  try {
    const token = await login(f);
    const testRow = submission(f);
    const first = await callFunction("app-sync", { token, submissions: [testRow] });
    assertEquals(first.body.failed, []);
    assertEquals(await statusOf(f, testRow.local_uuid), "test");

    const { error: deployError } = await admin
      .from("survey_packages")
      .update({ status: "deployed" })
      .eq("id", f.surveyPackageId);
    assertEquals(deployError, null);

    // The same record again, edited on the device after deployment: the data
    // updates, the label does not.
    const edited = { ...testRow, data: { ...(testRow.data as Record<string, unknown>), subjid: "21050050999" } };
    const resync = await callFunction("app-sync", { token, submissions: [edited] });
    assertEquals(resync.body.failed, []);
    assertEquals(await statusOf(f, testRow.local_uuid), "test");
    const { data: stored } = await admin
      .from("submissions")
      .select("data")
      .eq("project_id", f.projectId)
      .eq("local_unique_id", testRow.local_uuid)
      .single();
    assertEquals(stored!.data.subjid, "21050050999");

    // A record that first arrives now is deployed data.
    const liveRow = submission(f);
    await callFunction("app-sync", { token, submissions: [liveRow] });
    assertEquals(await statusOf(f, liveRow.local_uuid), "deployed");
  } finally {
    await f.cleanup();
  }
});

Deno.test("a deployed survey's records are deployed data", async () => {
  const f = await createFixture();
  try {
    const token = await login(f);
    const row = submission(f);
    await callFunction("app-sync", { token, submissions: [row] });
    assertEquals(await statusOf(f, row.local_uuid), "deployed");
  } finally {
    await f.cleanup();
  }
});

Deno.test("an ordinary update cannot relabel a record, even as service_role", async () => {
  const f = await createFixture({ surveyStatus: "test" });
  try {
    const token = await login(f);
    const row = submission(f);
    await callFunction("app-sync", { token, submissions: [row] });

    const { error } = await admin
      .from("submissions")
      .update({ data_status: "deployed" })
      .eq("project_id", f.projectId)
      .eq("local_unique_id", row.local_uuid);
    assertEquals(error, null);
    assertEquals(await statusOf(f, row.local_uuid), "test");
  } finally {
    await f.cleanup();
  }
});

Deno.test("reclassify: only the owner, only with a reason, and every change is audited", async () => {
  const f = await createFixture();
  try {
    const token = await login(f);
    const late = submission(f);
    const other = submission(f);
    await callFunction("app-sync", { token, submissions: [late, other] });
    const lateId = await idOf(f, late.local_uuid);
    assertEquals(await statusOf(f, late.local_uuid), "deployed");

    const reason = "Test interviews from tablet T-04, uploaded after deployment";

    // Someone who is not a member of the project.
    await assertRejects(
      () => reclassifyAs(crypto.randomUUID(), f.projectId, [lateId], "test", reason),
      Error,
      "Only the project owner",
    );
    await assertRejects(
      () => reclassifyAs(f.ownerId, f.projectId, [lateId], "test", "   "),
      Error,
      "A reason is required",
    );
    await assertRejects(
      () => reclassifyAs(f.ownerId, f.projectId, [lateId], "archived", reason),
      Error,
      "test or deployed",
    );
    assertEquals(await statusOf(f, late.local_uuid), "deployed");

    assertEquals(await reclassifyAs(f.ownerId, f.projectId, [lateId], "test", reason), 1);
    assertEquals(await statusOf(f, late.local_uuid), "test");
    assertEquals(await statusOf(f, other.local_uuid), "deployed");

    // Already test: nothing to change, and it says so.
    assertEquals(await reclassifyAs(f.ownerId, f.projectId, [lateId], "test", reason), 0);

    const { data: events } = await admin
      .from("system_audit_events")
      .select("*")
      .eq("project_id", f.projectId)
      .eq("entity_type", "submissions")
      .order("id");
    const summary = events!.filter((e) => e.operation === "RECLASSIFY");
    assertEquals(summary.length, 2);
    assertEquals(summary[0].reason, reason);
    assertEquals(summary[0].actor_user_id, f.ownerId);
    assertEquals(summary[0].new_values.changed, 1);
    assertEquals(summary[0].new_values.submission_ids, [lateId]);

    const rowChange = events!.find(
      (e) => e.operation === "UPDATE" && e.entity_id === lateId &&
        e.old_values?.data_status === "deployed" && e.new_values?.data_status === "test",
    );
    assert(rowChange, "the relabelled record has its own old/new audit event");

    // A resync after reclassifying keeps the corrected label.
    await callFunction("app-sync", { token, submissions: [late] });
    assertEquals(await statusOf(f, late.local_uuid), "test");
  } finally {
    await f.cleanup();
  }
});
