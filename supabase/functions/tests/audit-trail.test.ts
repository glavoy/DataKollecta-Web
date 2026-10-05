// End-to-end checks of the server audit trail through app-sync, the route
// every field record takes. The database-level guarantees are tested in
// supabase/tests/*.sql; these show they hold for a real device request.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { admin, callFunction, createFixture, login, sql, submission, warmUp } from "./helpers.ts";

Deno.test("warm up the edge runtime", warmUp);

Deno.test("audit: a synced record and its later revision are attributed to the device sync, with prior values", async () => {
  const f = await createFixture();
  try {
    const token = await login(f);
    const row = submission(f);
    await callFunction("app-sync", { token, submissions: [row] });
    const revised = { ...row, data: { ...(row.data as Record<string, unknown>), age: "41" } };
    const second = await callFunction("app-sync", { token, submissions: [revised] });
    assertEquals(second.body.failed, []);

    const { data: events, error } = await admin
      .from("system_audit_events")
      .select("operation, actor_database_role, actor_user_id, uploader_username, old_values, new_values")
      .eq("project_id", f.projectId)
      .eq("entity_type", "submissions")
      .order("id");
    assertEquals(error, null);
    assertEquals(events!.map((e) => e.operation), ["INSERT", "UPDATE"]);
    for (const e of events!) {
      // app-sync writes as service_role; the field worker is the uploader.
      assertEquals(e.actor_database_role, "api:service_role");
      assertEquals(e.actor_user_id, null);
      assertEquals(e.uploader_username, f.username);
    }
    assertEquals(events![1].old_values.data, row.data);
    assertEquals(events![1].new_values.data, revised.data);
  } finally {
    await f.cleanup();
  }
});

Deno.test("audit: re-sending an unchanged record adds no audit event", async () => {
  const f = await createFixture();
  try {
    const token = await login(f);
    const row = submission(f);
    await callFunction("app-sync", { token, submissions: [row] });
    await callFunction("app-sync", { token, submissions: [row] });
    const { count } = await admin
      .from("system_audit_events")
      .select("id", { count: "exact", head: true })
      .eq("project_id", f.projectId)
      .eq("entity_type", "submissions");
    // Only updated_at changes on a resend; that is bookkeeping, not a revision.
    assertEquals(count, 1);
  } finally {
    await f.cleanup();
  }
});

Deno.test("audit: a locked project refuses a device's change history along with its record", async () => {
  const f = await createFixture();
  try {
    const token = await login(f);
    const row = submission(f);
    await callFunction("app-sync", { token, submissions: [row] });
    await sql(`insert into public.project_data_locks(project_id,locked,reason,changed_by)
               values('${f.projectId}',true,'Synthetic lock test','${f.ownerId}');`);
    const change = {
      formchanges_uuid: crypto.randomUUID(), record_uuid: row.local_uuid, tablename: row.table_name,
      fieldname: "age", oldvalue: "40", newvalue: "41", changed_at: "2026-10-05T12:00:00",
      reason_for_change: "Corrected against synthetic source",
    };
    const res = await callFunction("app-sync", {
      token,
      submissions: [{ ...row, data: { ...(row.data as Record<string, unknown>), age: "41" } }],
      formchanges: [change],
    });
    // Both halves of the edit stay on the device, to arrive together after reopening.
    assertEquals(res.body.synced, []);
    assertEquals(res.body.formchanges_synced, []);
    assertEquals(res.body.failed.length, 1);
    assertEquals(res.body.formchanges_failed.length, 1);
    const { count } = await admin
      .from("formchanges")
      .select("id", { count: "exact", head: true })
      .eq("formchanges_uuid", change.formchanges_uuid);
    assertEquals(count, 0);
  } finally {
    await f.cleanup();
  }
});
