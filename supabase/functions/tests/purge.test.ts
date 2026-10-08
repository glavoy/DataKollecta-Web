// purge_test_submissions (migration 20261008150000): the owner can remove
// records labelled test, with a reason; nothing else can delete a record; a
// purged record re-uploaded by a phone is discarded rather than coming back as
// deployed data; and a data feed is told the record is gone.
//
// Records are written through app-sync, the only write path a record has.
import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { admin, callFunction, createFixture, login, sql, submission, warmUp, type Fixture } from "./helpers.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "http://127.0.0.1:54321";
const DB_URL = Deno.env.get("SUPABASE_DB_URL") ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

Deno.test("purge runtime warmup", warmUp);

/** Runs [statement] as portal user [userId] and returns the last output line. */
async function asUser(userId: string, statement: string): Promise<string> {
  const claims = JSON.stringify({ sub: userId, role: "authenticated" });
  const command = new Deno.Command("psql", {
    args: [DB_URL, "-v", "ON_ERROR_STOP=1", "-tA", "-q", "-c",
      `begin;
       set local role authenticated;
       select set_config('request.jwt.claims', '${claims}', true);
       ${statement};
       commit;`],
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout, stderr } = await command.output();
  if (code !== 0) throw new Error(new TextDecoder().decode(stderr));
  const lines = new TextDecoder().decode(stdout).trim().split("\n");
  return lines[lines.length - 1];
}

const idArray = (ids: string[]) => `array[${ids.map((id) => `'${id}'`).join(",")}]::uuid[]`;

async function purgeAs(userId: string, projectId: string, ids: string[], reason: string): Promise<number> {
  return Number(await asUser(userId,
    `select public.purge_test_submissions('${projectId}', ${idArray(ids)}, '${reason.replaceAll("'", "''")}')`));
}

async function reclassifyAs(userId: string, projectId: string, ids: string[], status: string): Promise<number> {
  return Number(await asUser(userId,
    `select public.reclassify_submissions('${projectId}', ${idArray(ids)}, '${status}', 'Late test upload')`));
}

async function rowOf(f: Fixture, localUuid: unknown) {
  const { data, error } = await admin
    .from("submissions")
    .select("id, data_status, received_status")
    .eq("project_id", f.projectId)
    .eq("local_unique_id", localUuid)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function deploy(f: Fixture) {
  const { error } = await admin.from("survey_packages").update({ status: "deployed" }).eq("id", f.surveyPackageId);
  assertEquals(error, null);
}

async function auditEvents(f: Fixture, operation: string) {
  const { data, error } = await admin
    .from("system_audit_events")
    .select("*")
    .eq("project_id", f.projectId)
    .eq("operation", operation)
    .order("id");
  if (error) throw error;
  return data!;
}

const reason = "Pre-deployment practice interviews";

Deno.test("the owner purges test records; the content stays in the audit trail", async () => {
  const f = await createFixture({ surveyStatus: "test" });
  try {
    const token = await login(f);
    const practice = submission(f);
    await callFunction("app-sync", { token, submissions: [practice] });
    await deploy(f);
    const real = submission(f);
    await callFunction("app-sync", { token, submissions: [real] });

    const practiceRow = (await rowOf(f, practice.local_uuid))!;
    const realRow = (await rowOf(f, real.local_uuid))!;
    assertEquals(practiceRow.received_status, "test");
    assertEquals(realRow.received_status, "deployed");

    // A deployed record in the same request is left alone and not counted.
    assertEquals(await purgeAs(f.ownerId, f.projectId, [practiceRow.id, realRow.id], reason), 1);
    assertEquals(await rowOf(f, practice.local_uuid), null);
    assertEquals((await rowOf(f, real.local_uuid))!.data_status, "deployed");

    const deleted = (await auditEvents(f, "DELETE")).find((e) => e.entity_id === practiceRow.id);
    assert(deleted, "the purged record has its own DELETE event");
    assertEquals(deleted.old_values.local_unique_id, practice.local_uuid);
    assertEquals(deleted.old_values.data, practice.data);
    assertEquals(deleted.actor_user_id, f.ownerId);

    const [summary] = await auditEvents(f, "PURGE");
    assertEquals(summary.reason, reason);
    assertEquals(summary.actor_user_id, f.ownerId);
    assertEquals(summary.new_values.requested, 2);
    assertEquals(summary.new_values.purged, 1);
    assertEquals(summary.new_values.submission_ids, [practiceRow.id]);
    assertEquals(summary.new_values.previously_deployed, []);

    const { data: tombstones } = await admin.from("purged_submissions").select("*").eq("project_id", f.projectId);
    assertEquals(tombstones!.length, 1);
    assertEquals(tombstones![0].local_unique_id, practice.local_uuid);
    assertEquals(tombstones![0].purged_by, f.ownerId);
  } finally {
    await f.cleanup();
  }
});

Deno.test("purge: only the owner, only with a reason, never on a locked project", async () => {
  const f = await createFixture({ surveyStatus: "test" });
  try {
    const token = await login(f);
    const row = submission(f);
    await callFunction("app-sync", { token, submissions: [row] });
    const { id } = (await rowOf(f, row.local_uuid))!;

    await assertRejects(() => purgeAs(crypto.randomUUID(), f.projectId, [id], reason), Error, "Only the project owner");
    await assertRejects(() => purgeAs(f.ownerId, f.projectId, [id], "   "), Error, "A reason is required");

    await sql(`insert into public.project_data_locks(project_id,locked,reason,changed_by)
               values('${f.projectId}',true,'Synthetic lock test','${f.ownerId}');`);
    await assertRejects(() => purgeAs(f.ownerId, f.projectId, [id], reason), Error, "locked");
    assert(await rowOf(f, row.local_uuid), "nothing was purged");
    assertEquals((await auditEvents(f, "PURGE")).length, 0);
  } finally {
    await f.cleanup();
  }
});

Deno.test("a record received as deployed can be purged after reclassifying, and is flagged", async () => {
  const f = await createFixture();
  try {
    const token = await login(f);
    const late = submission(f);
    await callFunction("app-sync", { token, submissions: [late] });
    const { id } = (await rowOf(f, late.local_uuid))!;

    // Still labelled deployed: not purgeable.
    assertEquals(await purgeAs(f.ownerId, f.projectId, [id], reason), 0);
    assert(await rowOf(f, late.local_uuid));

    assertEquals(await reclassifyAs(f.ownerId, f.projectId, [id], "test"), 1);
    const relabelled = (await rowOf(f, late.local_uuid))!;
    assertEquals(relabelled.data_status, "test");
    assertEquals(relabelled.received_status, "deployed", "received_status never changes");

    assertEquals(await purgeAs(f.ownerId, f.projectId, [id], "Tablet T-04 synced practice records late"), 1);
    const summaries = await auditEvents(f, "PURGE");
    const summary = summaries[summaries.length - 1];
    assertEquals(summary.new_values.previously_deployed_count, 1);
    assertEquals(summary.new_values.previously_deployed, [id]);
  } finally {
    await f.cleanup();
  }
});

Deno.test("no other route can delete a record, even service_role or a direct session", async () => {
  const f = await createFixture({ surveyStatus: "test" });
  try {
    const token = await login(f);
    const row = submission(f);
    await callFunction("app-sync", { token, submissions: [row] });
    const { id } = (await rowOf(f, row.local_uuid))!;

    await admin.from("submissions").delete().eq("id", id);
    assert(await rowOf(f, row.local_uuid), "service_role delete had no effect");

    await assertRejects(
      () => sql(`delete from public.submissions where id = '${id}';`),
      Error,
      "cannot be permanently deleted",
    );
    // The flag only works inside the transaction that sets it, and only the
    // purge function sets it; a session that tries to set it still has no
    // DELETE grant as an API role.
    await assertRejects(
      () => asUser(f.ownerId, `select set_config('datakollecta.purge', 'on', true); delete from public.submissions where id = '${id}'`),
      Error,
      "permission denied",
    );
    assert(await rowOf(f, row.local_uuid));
  } finally {
    await f.cleanup();
  }
});

Deno.test("a purged record re-uploaded after deployment is discarded, not stored as deployed", async () => {
  const f = await createFixture({ surveyStatus: "test" });
  try {
    const token = await login(f);
    const practice = submission(f);
    await callFunction("app-sync", { token, submissions: [practice] });
    const { id } = (await rowOf(f, practice.local_uuid))!;
    assertEquals(await purgeAs(f.ownerId, f.projectId, [id], reason), 1);
    await deploy(f);

    // A tester's phone that was never wiped syncs everything again.
    const fresh = submission(f);
    const resync = await callFunction("app-sync", { token, submissions: [practice, fresh] });
    assertEquals(resync.body.failed, []);
    assertEquals(resync.body.synced.sort(), [practice.local_uuid, fresh.local_uuid].sort(),
      "the device is told the purged record synced, so it stops retrying");

    assertEquals(await rowOf(f, practice.local_uuid), null);
    assertEquals((await rowOf(f, fresh.local_uuid))!.data_status, "deployed");

    const [discard] = await auditEvents(f, "DISCARD_PURGED");
    assertEquals(discard.entity_id, id);
    assertEquals(discard.new_values.local_unique_id, practice.local_uuid);
  } finally {
    await f.cleanup();
  }
});

Deno.test("a data feed returns a purged record as a tombstone", async () => {
  const f = await createFixture({ surveyStatus: "test" });
  try {
    const token = await login(f);
    const practice = submission(f);
    await callFunction("app-sync", { token, submissions: [practice] });
    const { id } = (await rowOf(f, practice.local_uuid))!;

    const { key } = JSON.parse(await asUser(f.ownerId,
      `select public.create_project_feed_key('${f.projectId}', 'test key', null, array['test','deployed'], null)`));
    const read = async () => {
      const response = await fetch(
        `${SUPABASE_URL}/functions/v1/project-data-feed?${new URLSearchParams({ resource: "submissions", table: "enrollee" })}`,
        { headers: { Authorization: `Bearer ${key}` } },
      );
      return await response.json();
    };

    const before = await read();
    assertEquals(before.rows.length, 1);
    assertEquals(before.rows[0].local_unique_id, practice.local_uuid);

    await purgeAs(f.ownerId, f.projectId, [id], reason);
    const after = await read();
    assertEquals(after.rows, [{ local_unique_id: practice.local_uuid, _deleted: true }]);
  } finally {
    await f.cleanup();
  }
});
