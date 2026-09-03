-- Hardening for the mobile login endpoint (app-login).
--
-- Three things were wrong, and they compounded:
--
--   1. bcrypt cost was pgcrypto's default of 6, not 10-12. Cost 12 is 64x the
--      work of 6, so every stored hash was ~64x cheaper to attack than it
--      should be.
--   2. Nothing counted failed attempts. The anon key needed to reach the
--      function is compiled into the APK and public by design, so the endpoint
--      was effectively open to unlimited guessing.
--   3. create_app_credential enforced no password policy at all -- any
--      non-empty string was accepted for a field-worker credential.
--
-- Verification also moved here from the Edge Function, which was doing it in
-- pure-JS bcryptjs. At cost 12 that would have put a field login somewhere
-- around a second; pgcrypto is native C and handles it in a few hundred ms.
-- Doing the whole decision in one function additionally makes the attempt
-- counter atomic (two concurrent logins cannot both read a stale count) and
-- puts the uniform-failure answer in one place instead of three JS branches.

-- ---------------------------------------------------------------------------
-- Failed-attempt ledger
-- ---------------------------------------------------------------------------

create table if not exists public.app_login_attempts (
  id uuid primary key default extensions.uuid_generate_v4(),
  project_code text not null,
  username text not null,
  ip text,
  succeeded boolean not null default false,
  attempted_at timestamp with time zone not null default now()
);

comment on table public.app_login_attempts is
  'Failed/successful app-login attempts, used only to throttle guessing. '
  'Written exclusively by verify_app_credential; rows older than 24h are '
  'deleted opportunistically on write, so no scheduler is needed.';

create index if not exists idx_app_login_attempts_user
  on public.app_login_attempts (project_code, username, attempted_at);

create index if not exists idx_app_login_attempts_ip
  on public.app_login_attempts (ip, attempted_at);

-- RLS on with no policies: reachable only through the SECURITY DEFINER
-- function below. Every other table holding user data on this project has RLS
-- enabled and no permissive policy, and this one must not be the exception --
-- the contents are a map of which usernames exist and are being guessed.
alter table public.app_login_attempts enable row level security;

revoke all on table public.app_login_attempts from anon, authenticated;

-- ---------------------------------------------------------------------------
-- verify_app_credential
-- ---------------------------------------------------------------------------

create or replace function public.verify_app_credential(
  p_project_code text,
  p_username text,
  p_password text,
  p_ip text default null
) returns jsonb
  language plpgsql
  security definer
  set search_path to 'public', 'extensions'
as $$
  declare
    -- Cost 12. Existing cost-6 hashes stay verifiable because bcrypt encodes
    -- its own cost in the '$2a$NN$' prefix; they are re-hashed in place on the
    -- owner's next successful login, so no password needs resetting.
    c_target_cost    constant integer  := 12;
    c_window         constant interval := interval '15 minutes';
    c_max_user_fails constant integer  := 10;
    -- Deliberately loose. A field team often shares one NAT'd office
    -- connection, so a tight per-IP limit locks out the team rather than an
    -- attacker.
    c_max_ip_fails   constant integer  := 50;
    -- A valid 29-character bcrypt salt at the target cost. Used only to burn
    -- an equivalent amount of work when no credential matched, so that a
    -- wrong username does not answer measurably faster than a wrong password.
    c_dummy_salt     constant text     := '$2a$12$0123456789012345678901';

    -- Scalars rather than a record: an unassigned plpgsql record raises
    -- "record is not assigned yet" on field access, whereas unassigned
    -- scalars are simply null, which is what the always-compare below needs.
    v_project_id          uuid;
    v_project_name        text;
    v_project_slug        text;
    v_credential_id       uuid;
    v_credential_username text;
    v_description         text;
    v_password_hash       text;

    v_project_code text := lower(btrim(coalesce(p_project_code, '')));
    v_username     text := btrim(coalesce(p_username, ''));
    v_user_fails   integer := 0;
    v_ip_fails     integer := 0;
    v_ok           boolean := false;
  begin
    delete from public.app_login_attempts
     where attempted_at < now() - interval '24 hours';

    select count(*) into v_user_fails
      from public.app_login_attempts
     where not succeeded
       and project_code = v_project_code
       and username = v_username
       and attempted_at > now() - c_window;

    if p_ip is not null and p_ip <> '' then
      select count(*) into v_ip_fails
        from public.app_login_attempts
       where not succeeded
         and ip = p_ip
         and attempted_at > now() - c_window;
    end if;

    if v_user_fails >= c_max_user_fails or v_ip_fails >= c_max_ip_fails then
      -- Not recorded as another attempt: a throttled caller must not be able
      -- to extend its own lockout window indefinitely by continuing to knock.
      return jsonb_build_object('outcome', 'throttled');
    end if;

    -- Same conditions the Edge Function's two queries used to apply. Losing
    -- any one of them silently grants access: a paused or archived project
    -- must not be loggable into, and neither must a disabled credential.
    select p.id, p.name, p.slug
      into v_project_id, v_project_name, v_project_slug
      from public.projects p
     where p.slug = v_project_code
       and p.status = 'active'
       and p.archived_at is null;

    if v_project_id is not null then
      select c.id, c.username, c.description, c.password_hash
        into v_credential_id, v_credential_username, v_description, v_password_hash
        from public.app_credentials c
       where c.project_id = v_project_id
         and c.username = v_username
         and c.is_active = true;
    end if;

    if v_password_hash is not null then
      v_ok := extensions.crypt(coalesce(p_password, ''), v_password_hash)
              = v_password_hash;
    else
      -- Exactly one crypt() on both paths, at the same cost.
      perform extensions.crypt(coalesce(p_password, ''), c_dummy_salt);
    end if;

    if not v_ok then
      insert into public.app_login_attempts (project_code, username, ip, succeeded)
      values (v_project_code, v_username, nullif(p_ip, ''), false);
      return jsonb_build_object('outcome', 'failed');
    end if;

    -- A success clears this username's failures, so an enumerator who
    -- mistyped a few times is not carrying a nearly-full bucket around.
    delete from public.app_login_attempts
     where not succeeded
       and project_code = v_project_code
       and username = v_username;

    insert into public.app_login_attempts (project_code, username, ip, succeeded)
    values (v_project_code, v_username, nullif(p_ip, ''), true);

    if substring(v_password_hash from 5 for 2)
       <> lpad(c_target_cost::text, 2, '0') then
      update public.app_credentials
         set password_hash =
               extensions.crypt(p_password, extensions.gen_salt('bf', c_target_cost))
       where id = v_credential_id;
    end if;

    update public.app_credentials
       set last_used_at = now()
     where id = v_credential_id;

    return jsonb_build_object(
      'outcome', 'ok',
      'project', jsonb_build_object(
        'id', v_project_id, 'name', v_project_name, 'code', v_project_slug
      ),
      'credential', jsonb_build_object(
        'id', v_credential_id,
        'username', v_credential_username,
        'description', v_description
      )
    );
  end;
$$;

alter function public.verify_app_credential(text, text, text, text)
  owner to postgres;

-- CREATE FUNCTION grants EXECUTE to PUBLIC by default. Left as-is, any holder
-- of the public anon key -- which is compiled into the APK -- could call this
-- directly as a guessing oracle. Only the Edge Function's service-role client
-- may.
revoke all on function public.verify_app_credential(text, text, text, text)
  from public, anon, authenticated;

grant execute on function public.verify_app_credential(text, text, text, text)
  to service_role;

comment on function public.verify_app_credential(text, text, text, text) is
  'The whole app-login decision: throttle check, project/credential lookup, '
  'bcrypt verify, attempt recording and opportunistic re-hash to the current '
  'cost. Returns {outcome: ok|failed|throttled}. Callers must map failed and '
  'throttled to the same status code with different messages, and must never '
  'distinguish "no such project" from "wrong password".';

-- ---------------------------------------------------------------------------
-- create_app_credential: cost 12, and a password floor
-- ---------------------------------------------------------------------------
--
-- Unchanged from the version in 20260817102141_remote_schema.sql except for
-- the two validation blocks and gen_salt's cost argument. Restated in full
-- rather than patched because CREATE OR REPLACE FUNCTION has no other form.
--
-- A floor stops the worst passwords; it does not produce good ones. Offering a
-- generated passphrase in the portal would suit the field better than any
-- complexity rule -- see ToDo.md.

CREATE OR REPLACE FUNCTION "public"."create_app_credential"("p_project_id" "uuid", "p_username" "text", "p_password" "text", "p_description" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
  declare
    v_credential_id uuid;
    v_result jsonb;
    v_current_user_id uuid;
    c_min_password_length constant integer := 10;
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

    -- These messages reach the admin verbatim: teamService.createCredential
    -- rethrows and ProjectFieldTeam.tsx shows error.message in a toast.
    if p_password is null
       or length(p_password) < c_min_password_length then
      raise exception 'Password must be at least % characters long', c_min_password_length;
    end if;

    if lower(btrim(p_password)) = lower(btrim(coalesce(p_username, ''))) then
      raise exception 'Password must not be the same as the username';
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
      extensions.crypt(p_password, extensions.gen_salt('bf', 12)),
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
