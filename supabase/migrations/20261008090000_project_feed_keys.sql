-- Project data feed keys: read-only, project-scoped machine access to a
-- project's collected data, for dashboards and scheduled analysis.
--
-- Why not a portal account. The obvious way to give a dashboard its data is a
-- Supabase Auth user added to the project as a viewer. RLS would scope its
-- reads correctly, but it is a full portal login: it can sign in to the web
-- app, read every table a viewer can, and (until the storage policies are
-- scoped) any project's survey packages. Its password would sit in a
-- dashboard's environment, where a leak hands out an interactive account.
--
-- What this is instead. A random bearer key, minted by the project OWNER,
-- stored only as a SHA-256 hash, and accepted by exactly one Edge Function,
-- project-data-feed, which reads through the service-only functions below.
-- The project is taken from the key, never from the request: there is no
-- parameter a caller can change to name a different project. A key can be
-- narrowed to some surveys, carries which data statuses it may read
-- (deployed only unless the owner says otherwise), can expire, and can be
-- revoked; creating and revoking both write to system_audit_events.
--
-- SHA-256 rather than bcrypt: the secret is 32 random bytes, not a human
-- password, so there is nothing to brute-force and a fast lookup by hash is
-- what lets the feed find the key without a username.
--
-- Also here, because the feed depends on it: submissions.updated_at is now
-- bumped by the database on every update. app-sync already set it, but
-- reclassify_submissions did not, so a record moved from deployed to test
-- would never be re-read by an incremental consumer and would stay on its
-- dashboard forever.
begin;

-- 1. Keys.
create table public.project_feed_keys (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 100),
  key_prefix text not null,
  key_hash text not null unique,
  survey_codes text[] check (survey_codes is null or cardinality(survey_codes) > 0),
  data_statuses text[] not null default array['deployed']
    check (cardinality(data_statuses) > 0 and data_statuses <@ array['test', 'deployed']),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references public.profiles(id),
  revoke_reason text
);
create index project_feed_keys_project on public.project_feed_keys(project_id);

comment on table public.project_feed_keys is
  'Read-only bearer keys for the project-data-feed Edge Function. One project per key; '
  'the plaintext is shown once by create_project_feed_key and only its SHA-256 is kept.';
comment on column public.project_feed_keys.survey_codes is
  'survey_packages.survey_code values the key may read; NULL means every survey in the project.';
comment on column public.project_feed_keys.data_statuses is
  'submissions.data_status values the key may read. Records outside it are returned as '
  'tombstones so a consumer can remove a record that was reclassified away from it.';

alter table public.project_feed_keys enable row level security;
revoke all on public.project_feed_keys from anon, authenticated, service_role;
-- Owners and admins see their keys, but never key_hash: column grants keep it
-- out of reach even of a select('*').
grant select (id, project_id, name, key_prefix, survey_codes, data_statuses, created_by,
              created_at, expires_at, last_used_at, revoked_at, revoked_by, revoke_reason)
  on public.project_feed_keys to authenticated;
grant select, update (last_used_at) on public.project_feed_keys to service_role;
create policy "Owners and admins can read feed keys" on public.project_feed_keys
for select to authenticated using (
  exists(select 1 from public.project_members m
          where m.project_id = project_feed_keys.project_id
            and m.user_id = auth.uid()
            and m.role::text in ('owner', 'admin'))
);

-- 2. Minting. Owner only. Returns the plaintext once; nothing can read it back.
create function public.create_project_feed_key(p_project_id uuid, p_name text,
                                               p_survey_codes text[] default null,
                                               p_data_statuses text[] default array['deployed'],
                                               p_expires_at timestamptz default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  prefix text;
  secret text;
  full_key text;
  new_id uuid;
  unknown_codes text[];
  api_role text;
begin
  if auth.uid() is null or not exists(
       select 1 from public.project_members m
        where m.project_id = p_project_id and m.user_id = auth.uid() and m.role = 'owner') then
    raise exception 'Only the project owner may create data feed keys' using errcode = '42501';
  end if;
  if p_name is null or length(btrim(p_name)) = 0 or length(btrim(p_name)) > 100 then
    raise exception 'A name of 1 to 100 characters is required' using errcode = '22023';
  end if;
  if p_data_statuses is null or cardinality(p_data_statuses) = 0
     or not (p_data_statuses <@ array['test', 'deployed']) then
    raise exception 'Data statuses must be test and/or deployed' using errcode = '22023';
  end if;
  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'The expiry date must be in the future' using errcode = '22023';
  end if;
  if p_survey_codes is not null then
    if cardinality(p_survey_codes) = 0 then
      p_survey_codes := null;
    else
      select array_agg(c) into unknown_codes
        from unnest(p_survey_codes) c
       where not exists(select 1 from public.survey_packages sp
                         where sp.project_id = p_project_id and sp.survey_code = c);
      if unknown_codes is not null then
        raise exception 'Unknown survey code(s) in this project: %', array_to_string(unknown_codes, ', ')
          using errcode = '22023';
      end if;
    end if;
  end if;
  if (select count(*) from public.project_feed_keys k
       where k.project_id = p_project_id and k.revoked_at is null) >= 20 then
    raise exception 'This project already has 20 active feed keys; revoke one first' using errcode = '22023';
  end if;

  prefix := encode(extensions.gen_random_bytes(4), 'hex');
  secret := encode(extensions.gen_random_bytes(32), 'hex');
  full_key := 'dkf_' || prefix || '_' || secret;

  insert into public.project_feed_keys(project_id, name, key_prefix, key_hash, survey_codes,
                                       data_statuses, created_by, expires_at)
  values (p_project_id, btrim(p_name), prefix, encode(extensions.digest(full_key, 'sha256'), 'hex'),
          p_survey_codes, p_data_statuses, auth.uid(), p_expires_at)
  returning id into new_id;

  api_role := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
  insert into public.system_audit_events(project_id, entity_type, entity_id, operation, actor_user_id,
                                         actor_database_role, new_values)
  values (p_project_id, 'project_feed_keys', new_id::text, 'FEED_KEY_CREATED', auth.uid(),
          case when api_role is not null then 'api:' || api_role else session_user end,
          jsonb_build_object('name', btrim(p_name), 'key_prefix', prefix,
                             'survey_codes', to_jsonb(p_survey_codes),
                             'data_statuses', to_jsonb(p_data_statuses),
                             'expires_at', p_expires_at));

  return jsonb_build_object('id', new_id, 'key', full_key, 'key_prefix', prefix);
end; $$;
revoke all on function public.create_project_feed_key(uuid, text, text[], text[], timestamptz)
  from public, anon, service_role;
grant execute on function public.create_project_feed_key(uuid, text, text[], text[], timestamptz)
  to authenticated;

-- 3. Revoking. Owner only, reason required, immediate, permanent.
create function public.revoke_project_feed_key(p_key_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  k public.project_feed_keys;
  api_role text;
begin
  select * into k from public.project_feed_keys where id = p_key_id for update;
  if auth.uid() is null or k.id is null or not exists(
       select 1 from public.project_members m
        where m.project_id = k.project_id and m.user_id = auth.uid() and m.role = 'owner') then
    raise exception 'Only the project owner may revoke data feed keys' using errcode = '42501';
  end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'A reason is required' using errcode = '22023';
  end if;
  if k.revoked_at is not null then
    return;
  end if;

  update public.project_feed_keys
     set revoked_at = clock_timestamp(), revoked_by = auth.uid(), revoke_reason = btrim(p_reason)
   where id = p_key_id;

  api_role := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
  insert into public.system_audit_events(project_id, entity_type, entity_id, operation, actor_user_id,
                                         actor_database_role, old_values, reason)
  values (k.project_id, 'project_feed_keys', k.id::text, 'FEED_KEY_REVOKED', auth.uid(),
          case when api_role is not null then 'api:' || api_role else session_user end,
          jsonb_build_object('name', k.name, 'key_prefix', k.key_prefix),
          btrim(p_reason));
end; $$;
revoke all on function public.revoke_project_feed_key(uuid, text) from public, anon, service_role;
grant execute on function public.revoke_project_feed_key(uuid, text) to authenticated;

-- 4. The feed's own reads. service_role only: the Edge Function hashes the
--    bearer key and passes the hash; every read after that takes the key id
--    and derives the project from it here, in SQL, so even a bug in the
--    function cannot widen what a key sees.

-- Returns the key's scope, or no row for an unknown, revoked or expired key
-- or an archived project. A paused project stays readable: pausing stops
-- field collection, not analysis. last_used_at is written at most once a
-- minute so a paging consumer does not turn every page into a write.
create function public.feed_authenticate(p_key_hash text)
returns table(key_id uuid, project_id uuid, project_slug text, survey_codes text[], data_statuses text[])
language plpgsql security definer set search_path = '' as $$
declare
  k public.project_feed_keys;
  slug text;
begin
  select * into k from public.project_feed_keys pk where pk.key_hash = p_key_hash;
  if k.id is null or k.revoked_at is not null or (k.expires_at is not null and k.expires_at <= now()) then
    return;
  end if;
  select p.slug into slug from public.projects p where p.id = k.project_id and p.archived_at is null;
  if slug is null then
    return;
  end if;
  if k.last_used_at is null or k.last_used_at < now() - interval '1 minute' then
    update public.project_feed_keys set last_used_at = now() where id = k.id;
  end if;
  return query select k.id, k.project_id, slug, k.survey_codes, k.data_statuses;
end; $$;

-- The forms a key can read, with the versions that declare them.
create function public.feed_forms(p_key_id uuid)
returns table(table_name text, display_name text, parent_table text, primary_key text,
              linking_field text, is_base boolean, survey_code text, versions integer[], fields jsonb)
language sql stable security definer set search_path = '' as $$
  with k as (select * from public.project_feed_keys where id = p_key_id and revoked_at is null),
  forms as (
    select c.table_name, c.display_name, c.parent_table, c.primary_key, c.linking_field, c.is_base,
           c.display_order, sp.survey_code, sp.version, c.fields
      from k
      join public.survey_packages sp on sp.project_id = k.project_id
                                    and (k.survey_codes is null or sp.survey_code = any(k.survey_codes))
      join public.crfs c on c.survey_package_id = sp.id
  )
  select f.table_name,
         (array_agg(f.display_name order by f.version desc))[1],
         (array_agg(f.parent_table order by f.version desc))[1],
         (array_agg(f.primary_key order by f.version desc))[1],
         (array_agg(f.linking_field order by f.version desc))[1],
         bool_or(f.is_base),
         f.survey_code,
         array_agg(f.version order by f.version),
         (array_agg(f.fields order by f.version desc))[1]
    from forms f
   group by f.survey_code, f.table_name
   order by f.survey_code, min(f.display_order), f.table_name;
$$;

-- One page of a form's records, oldest change first, keyset-paged on
-- (updated_at, id). Each row is the record's `data` with the same leading
-- columns the portal's CSV export writes, or a tombstone when the record's
-- data_status is outside the key's -- so a consumer can delete a record that
-- was reclassified from deployed to test.
create function public.feed_submissions(p_key_id uuid, p_table text, p_since timestamptz,
                                        p_after uuid, p_limit integer)
returns table(id uuid, updated_at timestamptz, deleted boolean, row_data jsonb)
language sql stable security definer set search_path = '' as $$
  select s.id,
         s.updated_at,
         not (s.data_status = any(k.data_statuses)),
         case when s.data_status = any(k.data_statuses)
              then (s.data - 'synced_at') || jsonb_build_object(
                     'survey_version', sp.version,
                     'data_status', s.data_status,
                     'local_unique_id', s.local_unique_id,
                     'surveyor_id', s.surveyor_id,
                     'collected_at', s.collected_at,
                     'submitted_at', s.submitted_at)
              else jsonb_build_object('local_unique_id', s.local_unique_id, '_deleted', true)
         end
    from public.project_feed_keys k
    join public.submissions s on s.project_id = k.project_id and s.table_name = p_table
    join public.survey_packages sp on sp.id = s.survey_package_id
   where k.id = p_key_id
     and k.revoked_at is null
     and (k.survey_codes is null or sp.survey_code = any(k.survey_codes))
     and (p_since is null
          or (s.updated_at, s.id) > (p_since, coalesce(p_after, '00000000-0000-0000-0000-000000000000'::uuid)))
   order by s.updated_at, s.id
   limit least(greatest(coalesce(p_limit, 1000), 1), 2000);
$$;

-- One page of device edit history for records the key can currently read,
-- keyset-paged on (synced_at, formchanges_uuid). A formchange is never
-- rewritten after it arrives (protect_device_audit_history), so synced_at is
-- a stable cursor.
create function public.feed_formchanges(p_key_id uuid, p_since timestamptz, p_after text, p_limit integer)
returns table(formchanges_uuid text, synced_at timestamptz, row_data jsonb)
language sql stable security definer set search_path = '' as $$
  select f.formchanges_uuid,
         coalesce(f.synced_at, '-infinity'::timestamptz),
         jsonb_build_object(
           'formchanges_uuid', f.formchanges_uuid,
           'record_uuid', f.record_uuid,
           'tablename', f.tablename,
           'fieldname', f.fieldname,
           'oldvalue', f.oldvalue,
           'newvalue', f.newvalue,
           'surveyor_id', f.surveyor_id,
           'changed_at', f.changed_at,
           'event_time_utc', f.event_time_utc,
           'device_utc_offset_minutes', f.device_utc_offset_minutes,
           'reason_for_change', f.reason_for_change,
           'synced_at', f.synced_at)
    from public.project_feed_keys k
    join public.formchanges f on f.project_id = k.project_id
   where k.id = p_key_id
     and k.revoked_at is null
     and exists(select 1
                  from public.submissions s
                  join public.survey_packages sp on sp.id = s.survey_package_id
                 where s.project_id = k.project_id
                   and s.local_unique_id = f.record_uuid
                   and s.data_status = any(k.data_statuses)
                   and (k.survey_codes is null or sp.survey_code = any(k.survey_codes)))
     and (p_since is null
          or (coalesce(f.synced_at, '-infinity'::timestamptz), f.formchanges_uuid) > (p_since, coalesce(p_after, '')))
   order by coalesce(f.synced_at, '-infinity'::timestamptz), f.formchanges_uuid
   limit least(greatest(coalesce(p_limit, 1000), 1), 2000);
$$;

-- One EXPORT event per feed run (the function calls this on the first page
-- of a resource only), so feed reads appear in the audit trail next to
-- portal exports without one event per page.
create function public.feed_record_read(p_key_id uuid, p_details jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  k public.project_feed_keys;
begin
  select * into k from public.project_feed_keys where id = p_key_id;
  if k.id is null then
    return;
  end if;
  if p_details is null or jsonb_typeof(p_details) <> 'object' or octet_length(p_details::text) > 8192 then
    raise exception 'Invalid feed read metadata';
  end if;
  insert into public.system_audit_events(project_id, entity_type, entity_id, operation,
                                         actor_database_role, uploader_username, new_values)
  values (k.project_id, 'export', gen_random_uuid()::text, 'EXPORT', 'api:feed_key',
          'feed key ' || k.key_prefix || ' (' || k.name || ')',
          p_details || jsonb_build_object('feed_key_id', k.id, 'key_prefix', k.key_prefix));
end; $$;

revoke all on function public.feed_authenticate(text) from public, anon, authenticated;
revoke all on function public.feed_forms(uuid) from public, anon, authenticated;
revoke all on function public.feed_submissions(uuid, text, timestamptz, uuid, integer) from public, anon, authenticated;
revoke all on function public.feed_formchanges(uuid, timestamptz, text, integer) from public, anon, authenticated;
revoke all on function public.feed_record_read(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.feed_authenticate(text) to service_role;
grant execute on function public.feed_forms(uuid) to service_role;
grant execute on function public.feed_submissions(uuid, text, timestamptz, uuid, integer) to service_role;
grant execute on function public.feed_formchanges(uuid, timestamptz, text, integer) to service_role;
grant execute on function public.feed_record_read(uuid, jsonb) to service_role;

-- 5. Incremental cursors.
create function public.touch_submission_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end; $$;
revoke all on function public.touch_submission_updated_at() from public, anon, authenticated, service_role;
create trigger touch_submission_updated_at before update on public.submissions
for each row execute function public.touch_submission_updated_at();

create index submissions_feed_cursor_idx on public.submissions (project_id, table_name, updated_at, id);
create index formchanges_feed_cursor_idx on public.formchanges (project_id, synced_at, formchanges_uuid);

commit;
