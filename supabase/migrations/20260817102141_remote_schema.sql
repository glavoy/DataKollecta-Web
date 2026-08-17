


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE TYPE "public"."project_role" AS ENUM (
    'viewer',
    'editor',
    'admin',
    'owner'
);


ALTER TYPE "public"."project_role" OWNER TO "postgres";


CREATE TYPE "public"."survey_status" AS ENUM (
    'draft',
    'active',
    'complete',
    'archived'
);


ALTER TYPE "public"."survey_status" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."add_project_owner"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    INSERT INTO public.project_members (project_id, user_id, role, accepted_at)
    VALUES (NEW.id, NEW.created_by, 'owner', NOW());
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."add_project_owner"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_app_credential"("p_project_id" "uuid", "p_username" "text", "p_password" "text", "p_description" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
  declare
    v_credential_id uuid;
    v_result jsonb;
    v_current_user_id uuid;
  begin
    -- Only project owners/admins can create app credentials
    if not public.is_project_owner(p_project_id)
       and not public.is_project_admin(p_project_id) then
      raise exception 'Not authorized';
    end if;

    -- Prevent duplicate usernames within the project
    if exists (
      select 1
      from public.app_credentials
      where project_id = p_project_id
        and username = p_username
    ) then
      raise exception 'Username already exists for this project';
    end if;

    v_current_user_id := auth.uid();

    insert into public.app_credentials (
      project_id,
      username,
      password_hash,
      description,
      is_active,
      created_by
    )
    values (
      p_project_id,
      p_username,
      extensions.crypt(p_password, extensions.gen_salt('bf')),
      p_description,
      true,
      v_current_user_id
    )
    returning id into v_credential_id;

    select jsonb_build_object(
      'id', id,
      'username', username,
      'description', description,
      'is_active', is_active,
      'created_at', created_at
    )
    into v_result
    from public.app_credentials
    where id = v_credential_id;

    return v_result;
  end;
  $$;


ALTER FUNCTION "public"."create_app_credential"("p_project_id" "uuid", "p_username" "text", "p_password" "text", "p_description" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_auth_user_project_ids"() RETURNS SETOF "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
    SELECT project_id
    FROM project_members
    WHERE user_id = auth.uid();
$$;


ALTER FUNCTION "public"."get_auth_user_project_ids"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_submission_counts"("p_project_id" "uuid") RETURNS TABLE("survey_package_id" "uuid", "survey_name" "text", "table_name" "text", "crf_display_name" "text", "total_count" bigint, "today_count" bigint, "this_week_count" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    RETURN QUERY
    SELECT
        sp.id, sp.display_name, s.table_name, c.display_name,
        COUNT(*),
        COUNT(*) FILTER (WHERE DATE(s.collected_at) = CURRENT_DATE),
        COUNT(*) FILTER (WHERE s.collected_at >= CURRENT_DATE - INTERVAL '7 days')
    FROM public.submissions s
    JOIN public.survey_packages sp ON s.survey_package_id = sp.id
    LEFT JOIN public.crfs c ON s.crf_id = c.id
    WHERE s.project_id = p_project_id
    GROUP BY sp.id, sp.display_name, s.table_name, c.display_name
    ORDER BY sp.version_date DESC, c.display_order;
END;
$$;


ALTER FUNCTION "public"."get_submission_counts"("p_project_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
BEGIN
    INSERT INTO public.profiles (id, email, full_name)
    VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'full_name');
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_project_admin"("p_project_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_role TEXT;
BEGIN
    -- This function runs with SECURITY DEFINER, bypassing RLS
    SELECT role INTO v_role
    FROM public.project_members
    WHERE project_id = p_project_id
    AND user_id = auth.uid()
    LIMIT 1;

    RETURN v_role IN ('admin', 'owner');
END;
$$;


ALTER FUNCTION "public"."is_project_admin"("p_project_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_project_owner"("p_project_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_role TEXT;
BEGIN
    -- This function runs with SECURITY DEFINER, bypassing RLS
    SELECT role INTO v_role
    FROM public.project_members
    WHERE project_id = p_project_id
    AND user_id = auth.uid()
    LIMIT 1;

    RETURN v_role = 'owner';
END;
$$;


ALTER FUNCTION "public"."is_project_owner"("p_project_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_submission_change"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_changed_fields JSONB;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        SELECT jsonb_agg(key)
        INTO v_changed_fields
        FROM jsonb_each(NEW.data)
        WHERE NOT (OLD.data ? key AND OLD.data->key = NEW.data->key);
    END IF;

    INSERT INTO public.submission_history (
        submission_id, data, version, change_type, changed_fields,
        changed_by, changed_on_device, synced_at
    ) VALUES (
        NEW.id, NEW.data, NEW.version,
        CASE WHEN TG_OP = 'INSERT' THEN 'created' WHEN TG_OP = 'UPDATE' THEN 'modified' END,
        v_changed_fields, NEW.surveyor_id, NEW.device_id, NOW()
    );
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."log_submission_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."search_profiles_for_invite"("p_search_term" "text") RETURNS TABLE("id" "uuid", "email" "text", "full_name" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select p.id, p.email, p.full_name
  from public.profiles p
  where length(trim(p_search_term)) >= 2
    and (p.email ilike '%' || p_search_term || '%'
         or p.full_name ilike '%' || p_search_term || '%')
  limit 20;
$$;


ALTER FUNCTION "public"."search_profiles_for_invite"("p_search_term" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."user_has_project_role"("p_project_id" "uuid", "p_min_role" "public"."project_role") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_user_role public.project_role;
    v_role_order INTEGER;
    v_min_role_order INTEGER;
BEGIN
    SELECT role INTO v_user_role
    FROM public.project_members
    WHERE project_id = p_project_id AND user_id = auth.uid();

    IF v_user_role IS NULL THEN RETURN FALSE; END IF;

    v_role_order := CASE v_user_role WHEN 'viewer' THEN 1 WHEN 'editor' THEN 2 WHEN 'owner' THEN 3 END;
    v_min_role_order := CASE p_min_role WHEN 'viewer' THEN 1 WHEN 'editor' THEN 2 WHEN 'owner' THEN 3 END;

    RETURN v_role_order >= v_min_role_order;
END;
$$;


ALTER FUNCTION "public"."user_has_project_role"("p_project_id" "uuid", "p_min_role" "public"."project_role") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."app_credentials" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "username" "text" NOT NULL,
    "password_hash" "text" NOT NULL,
    "description" "text",
    "is_active" boolean DEFAULT true,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "last_used_at" timestamp with time zone
);


ALTER TABLE "public"."app_credentials" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."app_sessions" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "credential_id" "uuid",
    "project_id" "uuid",
    "token" "text" NOT NULL,
    "device_id" "text",
    "device_info" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "expires_at" timestamp with time zone NOT NULL,
    "last_activity_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."app_sessions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."crfs" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "survey_package_id" "uuid" NOT NULL,
    "project_id" "uuid" NOT NULL,
    "table_name" "text" NOT NULL,
    "display_name" "text" NOT NULL,
    "display_order" integer DEFAULT 0,
    "is_base" boolean DEFAULT false,
    "primary_key" "text",
    "linking_field" "text",
    "parent_table" "text",
    "fields" "jsonb",
    "id_config" "jsonb",
    "display_fields" "text",
    "repeat_enforce_count" integer,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "auto_start_repeat" integer DEFAULT 0
);


ALTER TABLE "public"."crfs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."formchanges" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "formchanges_uuid" "text" NOT NULL,
    "project_id" "uuid" NOT NULL,
    "record_uuid" "text" NOT NULL,
    "tablename" "text" NOT NULL,
    "fieldname" "text" NOT NULL,
    "oldvalue" "text",
    "newvalue" "text",
    "surveyor_id" "text",
    "changed_at" timestamp with time zone,
    "synced_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."formchanges" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "full_name" "text",
    "role" "text" DEFAULT 'user'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."project_members" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "project_id" "uuid",
    "user_id" "uuid",
    "role" "public"."project_role" DEFAULT 'viewer'::"public"."project_role" NOT NULL,
    "invited_by" "uuid",
    "invited_at" timestamp with time zone DEFAULT "now"(),
    "accepted_at" timestamp with time zone
);


ALTER TABLE "public"."project_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."projects" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "slug" "text" NOT NULL,
    "status" "text" DEFAULT 'active'::"text",
    "created_by" "uuid" DEFAULT "auth"."uid"(),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "is_active" boolean DEFAULT true
);


ALTER TABLE "public"."projects" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."submissions" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "survey_package_id" "uuid" NOT NULL,
    "crf_id" "uuid",
    "table_name" "text" NOT NULL,
    "record_id" "text",
    "local_unique_id" "text" NOT NULL,
    "data" "jsonb" NOT NULL,
    "version" integer DEFAULT 1,
    "parent_table" "text",
    "parent_record_id" "text",
    "device_id" "text",
    "surveyor_id" "text",
    "app_version" "text",
    "collected_at" timestamp with time zone,
    "submitted_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."submissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."survey_packages" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "project_id" "uuid",
    "name" "text" NOT NULL,
    "display_name" "text" NOT NULL,
    "version_date" "date" NOT NULL,
    "description" "text",
    "zip_file_path" "text",
    "manifest" "jsonb",
    "status" "public"."survey_status" DEFAULT 'draft'::"public"."survey_status",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "published_at" timestamp with time zone
);


ALTER TABLE "public"."survey_packages" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."user_search" WITH ("security_invoker"='true') AS
 SELECT "id",
    "email",
    "full_name"
   FROM "public"."profiles";


ALTER VIEW "public"."user_search" OWNER TO "postgres";


ALTER TABLE ONLY "public"."app_credentials"
    ADD CONSTRAINT "app_credentials_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."app_credentials"
    ADD CONSTRAINT "app_credentials_project_id_username_key" UNIQUE ("project_id", "username");



ALTER TABLE ONLY "public"."app_sessions"
    ADD CONSTRAINT "app_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."app_sessions"
    ADD CONSTRAINT "app_sessions_token_key" UNIQUE ("token");



ALTER TABLE ONLY "public"."crfs"
    ADD CONSTRAINT "crfs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."crfs"
    ADD CONSTRAINT "crfs_survey_package_id_table_name_key" UNIQUE ("survey_package_id", "table_name");



ALTER TABLE ONLY "public"."formchanges"
    ADD CONSTRAINT "formchanges_formchanges_uuid_key" UNIQUE ("formchanges_uuid");



ALTER TABLE ONLY "public"."formchanges"
    ADD CONSTRAINT "formchanges_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."project_members"
    ADD CONSTRAINT "project_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."project_members"
    ADD CONSTRAINT "project_members_project_id_user_id_key" UNIQUE ("project_id", "user_id");



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_created_by_slug_unique" UNIQUE ("created_by", "slug");



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."submissions"
    ADD CONSTRAINT "submissions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."survey_packages"
    ADD CONSTRAINT "survey_packages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."survey_packages"
    ADD CONSTRAINT "survey_packages_project_id_name_key" UNIQUE ("project_id", "name");



CREATE INDEX "idx_app_credentials_lookup" ON "public"."app_credentials" USING "btree" ("project_id", "username", "is_active");



CREATE INDEX "idx_app_credentials_project" ON "public"."app_credentials" USING "btree" ("project_id");



CREATE INDEX "idx_app_sessions_credential" ON "public"."app_sessions" USING "btree" ("credential_id");



CREATE INDEX "idx_app_sessions_expires" ON "public"."app_sessions" USING "btree" ("expires_at");



CREATE INDEX "idx_app_sessions_token" ON "public"."app_sessions" USING "btree" ("token");



CREATE INDEX "idx_crfs_project" ON "public"."crfs" USING "btree" ("project_id");



CREATE INDEX "idx_crfs_survey_package" ON "public"."crfs" USING "btree" ("survey_package_id");



CREATE INDEX "idx_crfs_table_name" ON "public"."crfs" USING "btree" ("table_name");



CREATE INDEX "idx_formchanges_project" ON "public"."formchanges" USING "btree" ("project_id");



CREATE INDEX "idx_formchanges_record" ON "public"."formchanges" USING "btree" ("record_uuid");



CREATE INDEX "idx_formchanges_uuid" ON "public"."formchanges" USING "btree" ("formchanges_uuid");



CREATE INDEX "idx_project_members_project" ON "public"."project_members" USING "btree" ("project_id");



CREATE INDEX "idx_project_members_user" ON "public"."project_members" USING "btree" ("user_id");



CREATE INDEX "idx_projects_created_by_slug" ON "public"."projects" USING "btree" ("created_by", "slug");



CREATE INDEX "idx_projects_status" ON "public"."projects" USING "btree" ("status");



CREATE INDEX "idx_submissions_collected" ON "public"."submissions" USING "btree" ("project_id", "collected_at");



CREATE INDEX "idx_submissions_data" ON "public"."submissions" USING "gin" ("data");



CREATE INDEX "idx_submissions_project_table" ON "public"."submissions" USING "btree" ("project_id", "table_name");



CREATE INDEX "idx_submissions_record" ON "public"."submissions" USING "btree" ("project_id", "table_name", "record_id");



CREATE INDEX "idx_submissions_survey_package" ON "public"."submissions" USING "btree" ("survey_package_id");



CREATE INDEX "idx_submissions_surveyor" ON "public"."submissions" USING "btree" ("project_id", "surveyor_id");



CREATE UNIQUE INDEX "idx_submissions_unique" ON "public"."submissions" USING "btree" ("project_id", "table_name", "local_unique_id");



CREATE INDEX "idx_survey_packages_project" ON "public"."survey_packages" USING "btree" ("project_id");



CREATE INDEX "idx_survey_packages_status" ON "public"."survey_packages" USING "btree" ("status");



CREATE INDEX "idx_survey_packages_version_date" ON "public"."survey_packages" USING "btree" ("version_date");



CREATE UNIQUE INDEX "projects_name_created_by_idx" ON "public"."projects" USING "btree" ("created_by", "lower"("name"));



CREATE UNIQUE INDEX "survey_packages_name_created_by_idx" ON "public"."survey_packages" USING "btree" ("created_by", "lower"("name"));



CREATE OR REPLACE TRIGGER "on_project_created" AFTER INSERT ON "public"."projects" FOR EACH ROW EXECUTE FUNCTION "public"."add_project_owner"();



ALTER TABLE ONLY "public"."app_credentials"
    ADD CONSTRAINT "app_credentials_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."app_credentials"
    ADD CONSTRAINT "app_credentials_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."app_sessions"
    ADD CONSTRAINT "app_sessions_credential_id_fkey" FOREIGN KEY ("credential_id") REFERENCES "public"."app_credentials"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."app_sessions"
    ADD CONSTRAINT "app_sessions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."crfs"
    ADD CONSTRAINT "crfs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."crfs"
    ADD CONSTRAINT "crfs_survey_package_id_fkey" FOREIGN KEY ("survey_package_id") REFERENCES "public"."survey_packages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."formchanges"
    ADD CONSTRAINT "fk_project" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id");



ALTER TABLE ONLY "public"."formchanges"
    ADD CONSTRAINT "formchanges_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."project_members"
    ADD CONSTRAINT "project_members_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."project_members"
    ADD CONSTRAINT "project_members_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."project_members"
    ADD CONSTRAINT "project_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."submissions"
    ADD CONSTRAINT "submissions_crf_id_fkey" FOREIGN KEY ("crf_id") REFERENCES "public"."crfs"("id");



ALTER TABLE ONLY "public"."submissions"
    ADD CONSTRAINT "submissions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."submissions"
    ADD CONSTRAINT "submissions_survey_package_id_fkey" FOREIGN KEY ("survey_package_id") REFERENCES "public"."survey_packages"("id");



ALTER TABLE ONLY "public"."survey_packages"
    ADD CONSTRAINT "survey_packages_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."survey_packages"
    ADD CONSTRAINT "survey_packages_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



CREATE POLICY "Allow member creation" ON "public"."project_members" FOR INSERT TO "authenticated" WITH CHECK (((("user_id" = "auth"."uid"()) AND ("role" = 'owner'::"public"."project_role")) OR (EXISTS ( SELECT 1
   FROM "public"."project_members" "pm"
  WHERE (("pm"."project_id" = "project_members"."project_id") AND ("pm"."user_id" = "auth"."uid"()) AND ("pm"."role" = 'owner'::"public"."project_role"))))));



CREATE POLICY "Editors can manage crfs" ON "public"."crfs" USING (("auth"."uid"() IN ( SELECT "project_members"."user_id"
   FROM "public"."project_members"
  WHERE (("project_members"."project_id" = "crfs"."project_id") AND ("project_members"."role" = ANY (ARRAY['owner'::"public"."project_role", 'editor'::"public"."project_role"]))))));



CREATE POLICY "Editors can manage formchanges" ON "public"."formchanges" USING ((EXISTS ( SELECT 1
   FROM "public"."project_members" "pm"
  WHERE (("pm"."project_id" = "formchanges"."project_id") AND ("pm"."user_id" = "auth"."uid"()) AND ("pm"."role" = ANY (ARRAY['editor'::"public"."project_role", 'owner'::"public"."project_role"]))))));



CREATE POLICY "Editors can manage submissions" ON "public"."submissions" USING (("auth"."uid"() IN ( SELECT "project_members"."user_id"
   FROM "public"."project_members"
  WHERE (("project_members"."project_id" = "submissions"."project_id") AND ("project_members"."role" = ANY (ARRAY['owner'::"public"."project_role", 'editor'::"public"."project_role"]))))));



CREATE POLICY "Editors can manage surveys" ON "public"."survey_packages" USING (("auth"."uid"() IN ( SELECT "project_members"."user_id"
   FROM "public"."project_members"
  WHERE (("project_members"."project_id" = "survey_packages"."project_id") AND ("project_members"."role" = ANY (ARRAY['owner'::"public"."project_role", 'editor'::"public"."project_role"]))))));



CREATE POLICY "Enable insert for authenticated users only" ON "public"."projects" FOR INSERT WITH CHECK ((( SELECT "auth"."role"() AS "role") = 'authenticated'::"text"));



CREATE POLICY "Owners and admins can manage credentials" ON "public"."app_credentials" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."project_members" "pm"
  WHERE (("pm"."project_id" = "app_credentials"."project_id") AND ("pm"."user_id" = "auth"."uid"()) AND ("pm"."role" = ANY (ARRAY['owner'::"public"."project_role", 'admin'::"public"."project_role"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."project_members" "pm"
  WHERE (("pm"."project_id" = "app_credentials"."project_id") AND ("pm"."user_id" = "auth"."uid"()) AND ("pm"."role" = ANY (ARRAY['owner'::"public"."project_role", 'admin'::"public"."project_role"]))))));



CREATE POLICY "Owners and admins can view credentials" ON "public"."app_credentials" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."project_members" "pm"
  WHERE (("pm"."project_id" = "app_credentials"."project_id") AND ("pm"."user_id" = "auth"."uid"()) AND ("pm"."role" = ANY (ARRAY['owner'::"public"."project_role", 'admin'::"public"."project_role"]))))));



CREATE POLICY "Owners can delete memberships" ON "public"."project_members" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."project_members" "pm"
  WHERE (("pm"."project_id" = "project_members"."project_id") AND ("pm"."user_id" = "auth"."uid"()) AND ("pm"."role" = 'owner'::"public"."project_role")))));



CREATE POLICY "Owners can delete projects" ON "public"."projects" FOR DELETE USING (("auth"."uid"() IN ( SELECT "project_members"."user_id"
   FROM "public"."project_members"
  WHERE (("project_members"."project_id" = "projects"."id") AND ("project_members"."role" = 'owner'::"public"."project_role")))));



CREATE POLICY "Owners can update memberships" ON "public"."project_members" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."project_members" "pm"
  WHERE (("pm"."project_id" = "project_members"."project_id") AND ("pm"."user_id" = "auth"."uid"()) AND ("pm"."role" = 'owner'::"public"."project_role")))));



CREATE POLICY "Owners can update projects" ON "public"."projects" FOR UPDATE USING (("auth"."uid"() IN ( SELECT "project_members"."user_id"
   FROM "public"."project_members"
  WHERE (("project_members"."project_id" = "projects"."id") AND ("project_members"."role" = 'owner'::"public"."project_role")))));



CREATE POLICY "Owners can view sessions" ON "public"."app_sessions" FOR SELECT USING (("auth"."uid"() IN ( SELECT "project_members"."user_id"
   FROM "public"."project_members"
  WHERE (("project_members"."project_id" = "app_sessions"."project_id") AND ("project_members"."role" = 'owner'::"public"."project_role")))));



CREATE POLICY "Users can update own profile" ON "public"."profiles" FOR UPDATE USING (("auth"."uid"() = "id"));



CREATE POLICY "Users can view member projects" ON "public"."projects" FOR SELECT USING ((("auth"."uid"() = "created_by") OR (EXISTS ( SELECT 1
   FROM "public"."project_members" "pm"
  WHERE (("pm"."project_id" = "projects"."id") AND ("pm"."user_id" = "auth"."uid"()))))));



CREATE POLICY "Users can view own profile" ON "public"."profiles" FOR SELECT USING (("auth"."uid"() = "id"));



CREATE POLICY "Users can view profiles of people who share a project" ON "public"."profiles" FOR SELECT TO "authenticated" USING ((("auth"."uid"() = "id") OR (EXISTS ( SELECT 1
   FROM "public"."project_members" "pm"
  WHERE (("pm"."user_id" = "profiles"."id") AND ("pm"."project_id" IN ( SELECT "public"."get_auth_user_project_ids"() AS "get_auth_user_project_ids")))))));



CREATE POLICY "Users can view project crfs" ON "public"."crfs" FOR SELECT USING (("auth"."uid"() IN ( SELECT "project_members"."user_id"
   FROM "public"."project_members"
  WHERE ("project_members"."project_id" = "crfs"."project_id"))));



CREATE POLICY "Users can view project formchanges" ON "public"."formchanges" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."project_members" "pm"
  WHERE (("pm"."project_id" = "formchanges"."project_id") AND ("pm"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can view project members" ON "public"."project_members" FOR SELECT TO "authenticated" USING (("project_id" IN ( SELECT "public"."get_auth_user_project_ids"() AS "get_auth_user_project_ids")));



CREATE POLICY "Users can view project submissions" ON "public"."submissions" FOR SELECT USING (("auth"."uid"() IN ( SELECT "project_members"."user_id"
   FROM "public"."project_members"
  WHERE ("project_members"."project_id" = "submissions"."project_id"))));



CREATE POLICY "Users can view project surveys" ON "public"."survey_packages" FOR SELECT USING (("auth"."uid"() IN ( SELECT "project_members"."user_id"
   FROM "public"."project_members"
  WHERE ("project_members"."project_id" = "survey_packages"."project_id"))));



ALTER TABLE "public"."app_credentials" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."app_sessions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."crfs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."formchanges" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."project_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."projects" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."submissions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."survey_packages" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";






















































































































































REVOKE ALL ON FUNCTION "public"."add_project_owner"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."add_project_owner"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_app_credential"("p_project_id" "uuid", "p_username" "text", "p_password" "text", "p_description" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_app_credential"("p_project_id" "uuid", "p_username" "text", "p_password" "text", "p_description" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."create_app_credential"("p_project_id" "uuid", "p_username" "text", "p_password" "text", "p_description" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_auth_user_project_ids"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_auth_user_project_ids"() TO "service_role";
GRANT ALL ON FUNCTION "public"."get_auth_user_project_ids"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_submission_counts"("p_project_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_submission_counts"("p_project_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."handle_new_user"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_project_admin"("p_project_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_project_admin"("p_project_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."is_project_admin"("p_project_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."is_project_owner"("p_project_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_project_owner"("p_project_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."is_project_owner"("p_project_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."log_submission_change"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."log_submission_change"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_submission_change"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."search_profiles_for_invite"("p_search_term" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."search_profiles_for_invite"("p_search_term" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."search_profiles_for_invite"("p_search_term" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."user_has_project_role"("p_project_id" "uuid", "p_min_role" "public"."project_role") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."user_has_project_role"("p_project_id" "uuid", "p_min_role" "public"."project_role") TO "service_role";


















GRANT ALL ON TABLE "public"."app_credentials" TO "anon";
GRANT ALL ON TABLE "public"."app_credentials" TO "authenticated";
GRANT ALL ON TABLE "public"."app_credentials" TO "service_role";



GRANT ALL ON TABLE "public"."app_sessions" TO "anon";
GRANT ALL ON TABLE "public"."app_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."app_sessions" TO "service_role";



GRANT ALL ON TABLE "public"."crfs" TO "anon";
GRANT ALL ON TABLE "public"."crfs" TO "authenticated";
GRANT ALL ON TABLE "public"."crfs" TO "service_role";



GRANT ALL ON TABLE "public"."formchanges" TO "anon";
GRANT ALL ON TABLE "public"."formchanges" TO "authenticated";
GRANT ALL ON TABLE "public"."formchanges" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."project_members" TO "anon";
GRANT ALL ON TABLE "public"."project_members" TO "authenticated";
GRANT ALL ON TABLE "public"."project_members" TO "service_role";



GRANT ALL ON TABLE "public"."projects" TO "anon";
GRANT ALL ON TABLE "public"."projects" TO "authenticated";
GRANT ALL ON TABLE "public"."projects" TO "service_role";



GRANT ALL ON TABLE "public"."submissions" TO "anon";
GRANT ALL ON TABLE "public"."submissions" TO "authenticated";
GRANT ALL ON TABLE "public"."submissions" TO "service_role";



GRANT ALL ON TABLE "public"."survey_packages" TO "anon";
GRANT ALL ON TABLE "public"."survey_packages" TO "authenticated";
GRANT ALL ON TABLE "public"."survey_packages" TO "service_role";



GRANT ALL ON TABLE "public"."user_search" TO "anon";
GRANT ALL ON TABLE "public"."user_search" TO "authenticated";
GRANT ALL ON TABLE "public"."user_search" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































drop extension if exists "pg_net";

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


  create policy "Allow authenticated uploads 14e16c9_0"
  on "storage"."objects"
  as permissive
  for insert
  to public
with check (((bucket_id = 'surveys'::text) AND (auth.role() = 'authenticated'::text)));



  create policy "Allow authenticated uploads 1va6avm_0"
  on "storage"."objects"
  as permissive
  for insert
  to public
with check (((bucket_id = 'uploads'::text) AND (auth.role() = 'authenticated'::text)));



  create policy "Allow reads 14e16c9_0"
  on "storage"."objects"
  as permissive
  for select
  to public
using (((bucket_id = 'surveys'::text) AND (auth.role() = 'authenticated'::text)));



  create policy "Allow users to read their project files 1va6avm_0"
  on "storage"."objects"
  as permissive
  for select
  to public
using (((bucket_id = 'uploads'::text) AND (auth.role() = 'authenticated'::text)));



  create policy "Editors can update survey files"
  on "storage"."objects"
  as permissive
  for update
  to public
using (((bucket_id = 'surveys'::text) AND (auth.role() = 'authenticated'::text)));



  create policy "Editors can upload survey files"
  on "storage"."objects"
  as permissive
  for insert
  to public
with check (((bucket_id = 'surveys'::text) AND (auth.role() = 'authenticated'::text)));



  create policy "Owners can delete survey files"
  on "storage"."objects"
  as permissive
  for delete
  to public
using (((bucket_id = 'surveys'::text) AND (auth.role() = 'authenticated'::text)));



  create policy "Project members can view survey files"
  on "storage"."objects"
  as permissive
  for select
  to public
using (((bucket_id = 'surveys'::text) AND (auth.role() = 'authenticated'::text)));



