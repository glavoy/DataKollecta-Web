// project-data-feed (migration 20261008090000): a data feed key reads one
// project, only the statuses it was given, never another project, and stops
// working the moment it is revoked.
//
// Records are written through app-sync, the only write path a record has, and
// keys are minted through create_project_feed_key as the owner, the same way
// the portal does it.
import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { admin, callFunction, createFixture, login, submission, warmUp, type Fixture } from "./helpers.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "http://127.0.0.1:54321";
const DB_URL = Deno.env.get("SUPABASE_DB_URL") ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

Deno.test("data feed runtime warmup", async () => {
  await warmUp();
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const { status } = await feed("dkf_bad", {});
      if (status === 401) break;
    } catch {
      // The worker is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
});

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

async function createKey(f: Fixture, statuses = "array['deployed']"): Promise<{ id: string; key: string }> {
  const out = await asUser(f.ownerId,
    `select public.create_project_feed_key('${f.projectId}', 'test key', null, ${statuses}, null)`);
  return JSON.parse(out);
}

async function feed(key: string, params: Record<string, string>) {
  const response = await fetch(
    `${SUPABASE_URL}/functions/v1/project-data-feed?${new URLSearchParams(params)}`,
    { headers: { Authorization: `Bearer ${key}` } },
  );
  return { status: response.status, body: await response.json() };
}

async function upload(f: Fixture, count: number): Promise<string[]> {
  const token = await login(f);
  const rows = Array.from({ length: count }, () => submission(f));
  const { body } = await callFunction("app-sync", { token, submissions: rows });
  assertEquals(body.failed, []);
  return rows.map((r) => r.local_uuid as string);
}

Deno.test("a key reads its own project's records with the export's leading columns", async () => {
  const f = await createFixture();
  try {
    const ids = await upload(f, 2);
    const { key } = await createKey(f);

    const forms = await feed(key, { resource: "forms" });
    assertEquals(forms.status, 200);
    assertEquals(forms.body.scope.project, f.projectSlug);

    const page = await feed(key, { resource: "submissions", table: "enrollee" });
    assertEquals(page.status, 200);
    assertEquals(page.body.rows.map((r: { local_unique_id: string }) => r.local_unique_id).sort(), ids.sort());
    const row = page.body.rows[0];
    for (const column of ["survey_version", "data_status", "local_unique_id", "surveyor_id", "collected_at", "submitted_at", "subjid"]) {
      assert(column in row, `missing ${column}`);
    }
    assertEquals(row.data_status, "deployed");
    assertEquals(page.body.has_more, false);
  } finally {
    await f.cleanup();
  }
});

Deno.test("a key never returns another project's records, whatever the request says", async () => {
  const a = await createFixture();
  const b = await createFixture();
  try {
    await upload(a, 1);
    const bIds = await upload(b, 1);
    const { key } = await createKey(a);

    // Same form name in both projects; parameters that might look like a
    // project selector are ignored.
    const page = await feed(key, {
      resource: "submissions", table: "enrollee", project: b.projectSlug, project_id: b.projectId,
    });
    assertEquals(page.status, 200);
    assertEquals(page.body.scope.project, a.projectSlug);
    for (const row of page.body.rows) assert(!bIds.includes(row.local_unique_id));
    assertEquals(page.body.rows.length, 1);
  } finally {
    await a.cleanup();
    await b.cleanup();
  }
});

Deno.test("pages are keyset-paged and a cursor resumes after the last row", async () => {
  const f = await createFixture();
  try {
    const ids = await upload(f, 3);
    const { key } = await createKey(f);
    const first = await feed(key, { resource: "submissions", table: "enrollee", limit: "2" });
    assertEquals(first.body.rows.length, 2);
    assertEquals(first.body.has_more, true);
    const second = await feed(key, { resource: "submissions", table: "enrollee", limit: "2", cursor: first.body.next_cursor });
    assertEquals(second.body.rows.length, 1);
    assertEquals(second.body.has_more, false);
    const seen = [...first.body.rows, ...second.body.rows].map((r: { local_unique_id: string }) => r.local_unique_id);
    assertEquals(seen.sort(), ids.sort());

    const bad = await feed(key, { resource: "submissions", table: "enrollee", cursor: "not-a-cursor" });
    assertEquals(bad.status, 400);
  } finally {
    await f.cleanup();
  }
});

Deno.test("a record reclassified out of the key's statuses comes back as a tombstone", async () => {
  const f = await createFixture();
  try {
    const [localId] = await upload(f, 1);
    const { key } = await createKey(f);
    const before = await feed(key, { resource: "submissions", table: "enrollee" });
    const cursor = before.body.next_cursor;

    const { data } = await admin.from("submissions").select("id")
      .eq("project_id", f.projectId).eq("local_unique_id", localId).single();
    await asUser(f.ownerId,
      `select public.reclassify_submissions('${f.projectId}', array['${data!.id}']::uuid[], 'test', 'practice record')`);

    const after = await feed(key, { resource: "submissions", table: "enrollee", cursor });
    assertEquals(after.body.rows, [{ local_unique_id: localId, _deleted: true }]);
  } finally {
    await f.cleanup();
  }
});

Deno.test("revoked, unknown and malformed keys are refused alike", async () => {
  const f = await createFixture();
  try {
    const { id, key } = await createKey(f);
    assertEquals((await feed(key, { resource: "forms" })).status, 200);

    await asUser(f.ownerId, `select public.revoke_project_feed_key('${id}', 'test revoke')`);
    assertEquals((await feed(key, { resource: "forms" })).status, 401);

    const unknown = key.slice(0, -4) + "0000";
    assertEquals((await feed(unknown, { resource: "forms" })).status, 401);
    assertEquals((await feed("not-a-key", { resource: "forms" })).status, 401);
  } finally {
    await f.cleanup();
  }
});

Deno.test("only the owner can mint a key, and the plaintext is never stored", async () => {
  const f = await createFixture();
  try {
    const stranger = crypto.randomUUID();
    await assertRejects(
      () => asUser(stranger, `select public.create_project_feed_key('${f.projectId}', 'x', null, array['deployed'], null)`),
      Error,
      "Only the project owner",
    );

    const { id, key } = await createKey(f);
    const { data, error } = await admin.from("project_feed_keys").select("key_hash, key_prefix").eq("id", id).single();
    if (error) throw error;
    assert(data.key_hash !== key && !data.key_hash.includes(key.split("_")[2]));
    assertEquals(key.split("_")[1], data.key_prefix);

    // A portal user cannot read the hash even of their own project's key.
    await assertRejects(
      () => asUser(f.ownerId, `select key_hash from public.project_feed_keys where id = '${id}'`),
      Error,
      "permission denied",
    );
  } finally {
    await f.cleanup();
  }
});
