-- reset_app_credential_password: change a field-team credential's password
-- in place.
--
-- Until now the only way to change one was to delete the credential and
-- create it again, which works but loses the row's identity: the
-- description, last_used_at, and every app_sessions row go with it, and the
-- username has to be retyped exactly or every submission from then on is
-- attributed (submissions.surveyor_id) to a different name.
--
-- A reset does three things, atomically:
--
--   1. Re-hashes the password, at the same cost and under the same policy as
--      create_app_credential (20260903120000_app_login_hardening.sql). The
--      policy is restated rather than shared because a shared helper would
--      be a third object for the two to drift against; keep them in step.
--   2. Deletes the credential's app_sessions, so every device signed in with
--      the old password is cut off on its next upload rather than for the
--      remaining (up to 30-day) life of its token. The app reacts to that
--      401 by discarding the token and trying a fresh login with the
--      password it has stored; when that is rejected it tells the
--      interviewer to update the project's credentials in Settings.
--   3. Clears this username's rows in app_login_attempts. Between the reset
--      and the new password reaching every phone, phones retrying the old
--      one rack up failures; without this the new password could be
--      throttled for fifteen minutes the moment it is typed in.
--
-- SECURITY DEFINER because (2) and (3) are not reachable as `authenticated`:
-- app_sessions has only a SELECT policy, and app_login_attempts has its
-- privileges revoked outright. That makes the authorization check below the
-- only thing standing between any signed-in portal user and every
-- credential in every project, so it is written defensively:
-- is_project_owner/is_project_admin return NULL, not false, for a caller with
-- no membership row (`NULL = 'owner'`), and `if not NULL and not NULL` is
-- not true -- so the bare form used in create_app_credential would let a
-- non-member straight through. create_app_credential gets away with that
-- only because it is not SECURITY DEFINER and RLS then refuses its INSERT.

create or replace function public.reset_app_credential_password(
  p_credential_id uuid,
  p_password text
) returns jsonb
  language plpgsql
  security definer
  set search_path to 'public', 'extensions'
as $$
declare
  v_project_id uuid;
  v_username text;
  v_project_code text;
  v_sessions_revoked integer;
  c_min_password_length constant integer := 10;
begin
  select c.project_id, c.username, p.slug
    into v_project_id, v_username, v_project_code
    from public.app_credentials c
    join public.projects p on p.id = c.project_id
   where c.id = p_credential_id;

  -- Same message whether the credential does not exist or belongs to a
  -- project the caller cannot manage, so the function cannot be used to
  -- probe for credential ids.
  if v_project_id is null
     or not (coalesce(public.is_project_owner(v_project_id), false)
             or coalesce(public.is_project_admin(v_project_id), false)) then
    raise exception 'Not authorized';
  end if;

  -- Same checks and wording as create_app_credential: these reach the admin
  -- verbatim through teamService.resetCredentialPassword.
  if p_password is null
     or length(p_password) < c_min_password_length then
    raise exception 'Password must be at least % characters long', c_min_password_length;
  end if;

  if lower(btrim(p_password)) = lower(btrim(coalesce(v_username, ''))) then
    raise exception 'Password must not be the same as the username';
  end if;

  update public.app_credentials
     set password_hash = extensions.crypt(p_password, extensions.gen_salt('bf', 12))
   where id = p_credential_id;

  delete from public.app_sessions
   where credential_id = p_credential_id;
  get diagnostics v_sessions_revoked = row_count;

  -- verify_app_credential records project_code lowercased and trimmed, and
  -- the username trimmed; match the same normalisation.
  delete from public.app_login_attempts
   where project_code = lower(btrim(v_project_code))
     and username = btrim(v_username);

  return jsonb_build_object(
    'id', p_credential_id,
    'username', v_username,
    'sessions_revoked', v_sessions_revoked
  );
end;
$$;

alter function public.reset_app_credential_password(uuid, text) owner to postgres;

revoke all on function public.reset_app_credential_password(uuid, text) from public;
revoke all on function public.reset_app_credential_password(uuid, text) from anon;
grant execute on function public.reset_app_credential_password(uuid, text) to authenticated;
grant execute on function public.reset_app_credential_password(uuid, text) to service_role;
