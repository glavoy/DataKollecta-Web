// The `surveys` storage bucket is scoped to project membership (migration
// 20261008120000): members read their own project's packages, owners and
// editors write them, nobody overwrites or deletes a deployed survey's zip,
// and nobody outside the project can do anything at all.
//
// Tested through the real Storage API with a user JWT, because the policies
// only mean anything as the storage server applies them.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.115.0";
import { admin, createFixture, sql, type Fixture } from "./helpers.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "http://127.0.0.1:54321";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
// The local stack's well-known JWT secret (supabase status). Loopback only:
// helpers.ts refuses any other SUPABASE_URL.
const JWT_SECRET = Deno.env.get("SUPABASE_JWT_SECRET") ?? "super-secret-jwt-token-with-at-least-32-characters-long";

function b64url(bytes: Uint8Array | string): string {
  const raw = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  return btoa(String.fromCharCode(...raw)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

/** A storage client acting as portal user [userId]. */
async function asUser(userId: string): Promise<SupabaseClient> {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({
    sub: userId, role: "authenticated", aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 600,
  }));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(JWT_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${header}.${payload}`)));
  const jwt = `${header}.${payload}.${b64url(signature)}`;
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
}

/** A portal user with [role] in [projectId] (none for null). */
async function member(projectId: string, role: "editor" | "viewer" | null): Promise<string> {
  const id = crypto.randomUUID();
  await sql(`
    insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data,
                            raw_user_meta_data, aud, role, created_at, updated_at)
    values ('${id}', 'storage-${id}@example.test', '', now(), '{}', '{}', 'authenticated', 'authenticated', now(), now());
    insert into public.profiles (id, email) values ('${id}', 'storage-${id}@example.test') on conflict (id) do nothing;
    ${role ? `insert into public.project_members (project_id, user_id, role) values ('${projectId}', '${id}', '${role}');` : ""}
  `);
  return id;
}

const zip = (text: string) => new Blob([text], { type: "application/zip" });

/** Puts a package zip in place as the service role and points the fixture's
 *  package at it. The fixture must be created in test: a deployed package's
 *  content, zip_file_path included, cannot change -- so a deployed case
 *  deploys afterwards, with [deploy]. */
async function withPackageZip(f: Fixture, deploy = false): Promise<string> {
  const path = `${f.projectId}/${f.surveyId}.zip`;
  const { error } = await admin.storage.from("surveys").upload(path, zip("original"), { upsert: true });
  if (error) throw error;
  await sql(`update public.survey_packages set zip_file_path = '${path}' where id = '${f.surveyPackageId}';`);
  if (deploy) await sql(`update public.survey_packages set status = 'deployed' where id = '${f.surveyPackageId}';`);
  return path;
}

async function contentOf(path: string): Promise<string | null> {
  const { data } = await admin.storage.from("surveys").download(path);
  return data ? await data.text() : null;
}

Deno.test("members read their project's packages; outsiders read nothing", async () => {
  const f = await createFixture({ surveyStatus: "test" });
  const path = await withPackageZip(f);
  try {
    for (const userId of [f.ownerId, await member(f.projectId, "editor"), await member(f.projectId, "viewer")]) {
      const { data, error } = await (await asUser(userId)).storage.from("surveys").download(path);
      assertEquals(error, null);
      assertEquals(await data!.text(), "original");
    }
    const outsider = await asUser(await member(f.projectId, null));
    const download = await outsider.storage.from("surveys").download(path);
    assert(download.error, "an outsider downloaded another project's package");
    const signed = await outsider.storage.from("surveys").createSignedUrl(path, 60);
    assert(signed.error, "an outsider signed another project's package");
    const listed = await outsider.storage.from("surveys").list(f.projectId);
    assertEquals(listed.data ?? [], []);
  } finally {
    await admin.storage.from("surveys").remove([path]);
    await f.cleanup();
  }
});

Deno.test("only owners and editors upload, and only into their own project", async () => {
  const f = await createFixture({ surveyStatus: "test" });
  const other = await createFixture({ surveyStatus: "test" });
  const written: string[] = [];
  try {
    const editor = await asUser(await member(f.projectId, "editor"));
    const viewer = await asUser(await member(f.projectId, "viewer"));

    const own = `${f.projectId}/new_survey.zip`;
    assertEquals((await editor.storage.from("surveys").upload(own, zip("x"))).error, null);
    written.push(own);

    const viewerPath = `${f.projectId}/viewer.zip`;
    assert((await viewer.storage.from("surveys").upload(viewerPath, zip("x"))).error, "a viewer uploaded");

    const foreign = `${other.projectId}/planted.zip`;
    assert((await editor.storage.from("surveys").upload(foreign, zip("x"))).error, "an editor wrote into another project");
    assertEquals(await contentOf(foreign), null);

    const loose = "not-a-project/loose.zip";
    assert((await editor.storage.from("surveys").upload(loose, zip("x"))).error, "an upload outside any project folder");
  } finally {
    await admin.storage.from("surveys").remove(written);
    await f.cleanup();
    await other.cleanup();
  }
});

Deno.test("a deployed survey's zip cannot be overwritten or deleted, even by its owner", async () => {
  const f = await createFixture({ surveyStatus: "test" });
  const path = await withPackageZip(f, true);
  try {
    const owner = await asUser(f.ownerId);
    await owner.storage.from("surveys").upload(path, zip("tampered"), { upsert: true });
    assertEquals(await contentOf(path), "original");
    await owner.storage.from("surveys").remove([path]);
    assertEquals(await contentOf(path), "original");
  } finally {
    await admin.storage.from("surveys").remove([path]);
    await f.cleanup();
  }
});

Deno.test("an editor can replace and delete a test survey's zip", async () => {
  const f = await createFixture({ surveyStatus: "test" });
  const path = await withPackageZip(f);
  try {
    const editor = await asUser(await member(f.projectId, "editor"));
    assertEquals((await editor.storage.from("surveys").upload(path, zip("edited"), { upsert: true })).error, null);
    assertEquals(await contentOf(path), "edited");
    await editor.storage.from("surveys").remove([path]);
    assertEquals(await contentOf(path), null);
  } finally {
    await admin.storage.from("surveys").remove([path]);
    await f.cleanup();
  }
});

Deno.test("an empty project's zips can be cleaned up after the project is deleted", async () => {
  const f = await createFixture({ surveyStatus: "test" });
  const path = await withPackageZip(f);
  try {
    const owner = await asUser(f.ownerId);
    // As ProjectSettings does: delete the project (cascading its packages
    // and memberships), THEN remove the files.
    await admin.from("projects").delete().eq("id", f.projectId);
    await owner.storage.from("surveys").remove([path]);
    assertEquals(await contentOf(path), null);
  } finally {
    await admin.storage.from("surveys").remove([path]);
    await f.cleanup();
  }
});

Deno.test("nobody else can read or delete a deleted project's leftover zip", async () => {
  const f = await createFixture({ surveyStatus: "test" });
  const path = await withPackageZip(f);
  const viewerId = await member(f.projectId, "viewer");
  try {
    await admin.from("projects").delete().eq("id", f.projectId);
    for (const userId of [viewerId, await member(f.projectId, null)]) {
      const client = await asUser(userId);
      assert((await client.storage.from("surveys").download(path)).error, "a non-editor read a leftover zip");
      await client.storage.from("surveys").remove([path]);
      assertEquals(await contentOf(path), "original");
    }
  } finally {
    await admin.storage.from("surveys").remove([path]);
    await f.cleanup();
  }
});
