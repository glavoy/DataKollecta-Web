-- Three policies on project_members ("Allow member creation", "Owners can
-- update memberships", "Owners can delete memberships") check ownership with
-- a raw `EXISTS (SELECT 1 FROM project_members pm WHERE ...)` subquery. That
-- inner SELECT is itself subject to RLS on project_members, which Postgres
-- refuses to re-evaluate mid-evaluation -- "infinite recursion detected in
-- policy for relation project_members" (SQLSTATE 42P17), hit as soon as
-- ProjectMembers > Add a member does the plain INSERT in
-- projectMemberService.addMember().
--
-- "Users can view project members" (SELECT) avoids this by routing the
-- membership check through get_auth_user_project_ids(), a SECURITY DEFINER
-- function that bypasses RLS internally instead of re-querying the table
-- under RLS. is_project_owner(p_project_id) is the same kind of helper,
-- already defined for exactly this "is auth.uid() an owner of this project"
-- check -- these three policies just weren't written to use it. Swap the
-- raw subquery for the helper so ownership checks stop recursing through
-- project_members' own RLS.

DROP POLICY IF EXISTS "Allow member creation" ON "public"."project_members";
CREATE POLICY "Allow member creation" ON "public"."project_members"
    FOR INSERT TO "authenticated"
    WITH CHECK (
        (("user_id" = "auth"."uid"()) AND ("role" = 'owner'::"public"."project_role"))
        OR "public"."is_project_owner"("project_id")
    );

DROP POLICY IF EXISTS "Owners can update memberships" ON "public"."project_members";
CREATE POLICY "Owners can update memberships" ON "public"."project_members"
    FOR UPDATE TO "authenticated"
    USING ("public"."is_project_owner"("project_id"));

DROP POLICY IF EXISTS "Owners can delete memberships" ON "public"."project_members";
CREATE POLICY "Owners can delete memberships" ON "public"."project_members"
    FOR DELETE TO "authenticated"
    USING ("public"."is_project_owner"("project_id"));
