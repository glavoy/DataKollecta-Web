-- Every other table hanging off `projects` cascades: submissions, crfs,
-- survey_packages, app_sessions, app_credentials and project_members all
-- carry `ON DELETE CASCADE` on their `project_id` FK. `formchanges` alone
-- does not (`formchanges_project_id_fkey`, added with a bare FOREIGN KEY
-- and never revisited).
--
-- That single gap is enough to permanently wedge a project. Project
-- deletion currently runs as a client-side script that deletes formchanges,
-- then submissions, crfs, survey_packages, app_sessions, app_credentials,
-- project_members, and finally the project row itself. If any formchanges
-- row survives that first step -- which was previously guaranteed for any
-- project with more than 1000 submissions, since the client only paged
-- through the first 1000 to collect uuids to delete by -- the final
-- `DELETE FROM projects` fails on this FK *after* every other table has
-- already been emptied. The project is left existing, empty, and
-- permanently undeletable, since retrying hits the exact same orphaned
-- rows every time.
--
-- With this cascade in place, formchanges can no longer outlive its
-- project regardless of what the client does or doesn't clean up first,
-- and a single `DELETE FROM projects WHERE id = ...` is sufficient and
-- atomic -- no multi-step script that can partially fail.

ALTER TABLE "public"."formchanges"
    DROP CONSTRAINT "formchanges_project_id_fkey";

ALTER TABLE ONLY "public"."formchanges"
    ADD CONSTRAINT "formchanges_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;
