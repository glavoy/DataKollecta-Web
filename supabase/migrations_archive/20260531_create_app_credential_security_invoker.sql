-- Fix Supabase linter warning 0029:
-- authenticated_security_definer_function_executable
--
-- The web app creates mobile field-worker credentials by calling
-- supabase.rpc('create_app_credential') with the signed-in website user's
-- session. Do not revoke authenticated EXECUTE here, because that would break
-- the Field Team "Add Credential" workflow.
--
-- Instead, keep the RPC callable but make it run as SECURITY INVOKER. The
-- function still performs the explicit project-role check, and the insert into
-- app_credentials is also constrained by the table's RLS policies.

alter function public.create_app_credential(uuid, text, text, text)
security invoker;

-- If the earlier revoke-based remediation was already applied, restore the
-- web app's ability to call this RPC as a signed-in website user. Do not grant
-- anon execution; mobile app auth goes through Edge Functions instead.
grant execute on function public.create_app_credential(uuid, text, text, text)
to authenticated;

-- Preserve the function's existing owner/admin behavior after it starts
-- respecting RLS. The current schema dump only allows owners on
-- app_credentials, while create_app_credential explicitly allows admins too.
drop policy if exists "Owners can view credentials"
on public.app_credentials;

drop policy if exists "Owners can manage credentials"
on public.app_credentials;

create policy "Owners and admins can view credentials"
on public.app_credentials
for select
to authenticated
using (
  exists (
    select 1
    from public.project_members pm
    where pm.project_id = app_credentials.project_id
      and pm.user_id = auth.uid()
      and pm.role in ('owner'::public.project_role, 'admin'::public.project_role)
  )
);

create policy "Owners and admins can manage credentials"
on public.app_credentials
for all
to authenticated
using (
  exists (
    select 1
    from public.project_members pm
    where pm.project_id = app_credentials.project_id
      and pm.user_id = auth.uid()
      and pm.role in ('owner'::public.project_role, 'admin'::public.project_role)
  )
)
with check (
  exists (
    select 1
    from public.project_members pm
    where pm.project_id = app_credentials.project_id
      and pm.user_id = auth.uid()
      and pm.role in ('owner'::public.project_role, 'admin'::public.project_role)
  )
);
