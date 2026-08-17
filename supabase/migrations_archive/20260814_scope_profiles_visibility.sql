-- profiles' SELECT policy was `using_expr: true` for any authenticated
-- user -- RLS controls row visibility, not column visibility, so this
-- exposed every user's email, full_name, role, created_at and updated_at
-- to every other signed-in user via a plain `select * from profiles`, not
-- just the id/email/full_name the "add team member" search feature
-- intentionally shows.
--
-- The app has two legitimate reasons to read someone else's profile:
--  1. Showing a project's Team list (projectMemberService.getProjectMembers,
--     joined through project_members.profiles:user_id) -- scoped below to
--     "shares at least one project with you".
--  2. Searching by partial email/name to find a user to invite
--     (projectMemberService.searchUsersByEmail) -- this genuinely needs to
--     see users outside your existing projects, since the point is finding
--     someone not yet a member. That can't be scoped by a row-level policy,
--     so it moves behind a SECURITY DEFINER RPC that returns only
--     id/email/full_name and requires a minimum search length, instead of
--     granting blanket table read access.
--
-- Profile creation (AuthContext's signup upsert) already goes through the
-- SECURITY DEFINER handle_new_user() trigger, not a client RLS-checked
-- insert, so it is unaffected by this change.

drop policy if exists "Authenticated users can search profiles for project membership"
on public.profiles;

create policy "Users can view profiles of people who share a project"
on public.profiles
for select
to authenticated
using (
  auth.uid() = id
  or exists (
    select 1
    from public.project_members pm
    where pm.user_id = profiles.id
      and pm.project_id in (select public.get_auth_user_project_ids())
  )
);

create or replace function public.search_profiles_for_invite(p_search_term text)
returns table (id uuid, email text, full_name text)
language sql
security definer
stable
set search_path to 'public'
as $function$
  select p.id, p.email, p.full_name
  from public.profiles p
  where length(trim(p_search_term)) >= 2
    and (p.email ilike '%' || p_search_term || '%'
         or p.full_name ilike '%' || p_search_term || '%')
  limit 20;
$function$;

revoke all on function public.search_profiles_for_invite(text) from public;
grant execute on function public.search_profiles_for_invite(text) to authenticated;
