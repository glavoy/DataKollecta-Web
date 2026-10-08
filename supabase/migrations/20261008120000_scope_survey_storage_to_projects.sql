-- Scope the `surveys` storage bucket to project membership.
--
-- Before: every policy on storage.objects for this bucket (six of them, from
-- the 20260817102141 baseline, made in the dashboard before migrations
-- existed) checked only `auth.role() = 'authenticated'`. Any signed-in portal
-- user -- including someone who had just signed up and belonged to no project
-- -- could list, download, overwrite or delete ANY project's survey packages,
-- given or guessing a path. A survey package is the questionnaire itself,
-- and overwriting one changes what phones download on their next login,
-- since app-login re-signs zip_file_path on every login.
--
-- After: an object's first path segment is its project id -- every writer
-- builds `${projectId}/${surveyId}.zip` (ProjectDetail.tsx upload,
-- surveyService.saveSurveyPackage), and production was checked before this
-- was written: all 16 objects sit under their own project's folder and are
-- referenced by a package. So:
--   * read (select/download/sign): any member of that project;
--   * upload, overwrite, delete: owners and editors of that project -- the
--     same roles as the "Editors can manage surveys" policy on
--     survey_packages, so storage and the rows that point at it agree;
--   * never overwrite or delete the zip of a DEPLOYED or COMPLETE survey,
--     whoever asks. The lifecycle triggers already lock those rows, but the
--     zip lives outside the database: the designer's save uploads
--     (upsert) BEFORE its row update is rejected, which is how a deployed
--     survey's zip was destroyed on 2026-08-23. surveyService's preflights
--     narrow that window; this closes it.
-- The service role (app-login's signed URLs, admin work) bypasses RLS as
-- before.
--
-- Also dropped: the two policies on the `uploads` bucket. Nothing in the
-- portal, the functions or the app uses that bucket, it holds no objects in
-- production, and its policies had the same open-to-every-user shape.
begin;

-- The caller's role in the project an object path belongs to, or NULL.
-- SECURITY DEFINER so the lookup does not depend on project_members' own RLS,
-- and compared as text so a path whose first segment is not a uuid simply
-- matches nothing instead of raising a cast error.
create function public.storage_object_project_role(p_object_name text) returns text
language sql stable security definer set search_path = '' as $$
  select m.role::text
    from public.project_members m
   where m.user_id = auth.uid()
     and m.project_id::text = (storage.foldername(p_object_name))[1]
$$;

-- True when the object is the package of a deployed or complete survey.
create function public.storage_object_is_locked_package(p_object_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.survey_packages sp
                 where sp.zip_file_path = p_object_name
                   and sp.status::text in ('deployed', 'complete'))
$$;

-- Cleaning up after a deleted project. Deleting an empty project removes its
-- zips AFTER the project row (ProjectSettings.handleDelete: cleanup must never
-- precede a delete that might be refused), and by then the caller's
-- membership went with the project, so the role check alone would refuse the
-- cleanup and leave the files behind for good. The storage API reads an
-- object before deleting it, so the leftover must be readable too -- but only
-- to the people who could delete the project's packages while it existed,
-- not to every signed-in user. So the project's owners and editors are
-- remembered at the moment it is deleted.
create table public.deleted_project_editors (
  project_id uuid not null,
  user_id uuid not null,
  deleted_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
alter table public.deleted_project_editors enable row level security;
revoke all on public.deleted_project_editors from anon, authenticated;
comment on table public.deleted_project_editors is
  'Owners and editors of deleted projects, so they can remove the project''s leftover '
  'survey zips from storage after the delete. See storage_object_is_callers_orphan.';

-- BEFORE DELETE: runs before the cascade removes project_members. If the
-- delete is refused (prevent_collected_data_destruction), this insert rolls
-- back with it.
create function public.remember_deleted_project_editors() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.deleted_project_editors(project_id, user_id)
  select m.project_id, m.user_id from public.project_members m
   where m.project_id = old.id and m.role::text in ('owner', 'editor')
  on conflict do nothing;
  return old;
end; $$;
revoke all on function public.remember_deleted_project_editors() from public, anon, authenticated, service_role;
create trigger remember_deleted_project_editors before delete on public.projects
for each row execute function public.remember_deleted_project_editors();

-- True when the object's project is gone, no package points at it, and the
-- caller was an owner or editor of that project.
create function public.storage_object_is_callers_orphan(p_object_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.deleted_project_editors d
                 where d.project_id::text = (storage.foldername(p_object_name))[1]
                   and d.user_id = auth.uid())
     and not exists(select 1 from public.projects p
                     where p.id::text = (storage.foldername(p_object_name))[1])
     and not exists(select 1 from public.survey_packages sp
                     where sp.zip_file_path = p_object_name)
$$;

revoke all on function public.storage_object_project_role(text) from public, anon;
revoke all on function public.storage_object_is_locked_package(text) from public, anon;
revoke all on function public.storage_object_is_callers_orphan(text) from public, anon;
grant execute on function public.storage_object_project_role(text) to authenticated;
grant execute on function public.storage_object_is_locked_package(text) to authenticated;
grant execute on function public.storage_object_is_callers_orphan(text) to authenticated;

drop policy if exists "Allow authenticated uploads 14e16c9_0" on storage.objects;
drop policy if exists "Allow reads 14e16c9_0" on storage.objects;
drop policy if exists "Editors can update survey files" on storage.objects;
drop policy if exists "Editors can upload survey files" on storage.objects;
drop policy if exists "Owners can delete survey files" on storage.objects;
drop policy if exists "Project members can view survey files" on storage.objects;
drop policy if exists "Allow authenticated uploads 1va6avm_0" on storage.objects;
drop policy if exists "Allow users to read their project files 1va6avm_0" on storage.objects;

create policy "Project members can read their survey packages" on storage.objects
for select to authenticated using (
  bucket_id = 'surveys'
  and (public.storage_object_project_role(name) is not null
       or public.storage_object_is_callers_orphan(name))
);

create policy "Owners and editors can upload survey packages" on storage.objects
for insert to authenticated with check (
  bucket_id = 'surveys'
  and public.storage_object_project_role(name) in ('owner', 'editor')
);

-- USING checks the object as it is; WITH CHECK the object as it becomes, so
-- a package can neither be overwritten while locked nor moved into a project
-- the caller cannot edit.
create policy "Owners and editors can replace unlocked survey packages" on storage.objects
for update to authenticated using (
  bucket_id = 'surveys'
  and public.storage_object_project_role(name) in ('owner', 'editor')
  and not public.storage_object_is_locked_package(name)
) with check (
  bucket_id = 'surveys'
  and public.storage_object_project_role(name) in ('owner', 'editor')
  and not public.storage_object_is_locked_package(name)
);

create policy "Owners and editors can delete unlocked survey packages" on storage.objects
for delete to authenticated using (
  bucket_id = 'surveys'
  and (
    (public.storage_object_project_role(name) in ('owner', 'editor')
     and not public.storage_object_is_locked_package(name))
    or public.storage_object_is_callers_orphan(name)
  )
);

commit;
