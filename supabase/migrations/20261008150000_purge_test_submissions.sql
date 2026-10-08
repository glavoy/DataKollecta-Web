-- Purging test data: the one controlled exception to "collected data is never
-- deleted" (20261005090000).
--
-- Why an exception at all. Records received while a survey was in draft or
-- test are practice interviews, not study data, and since data_status
-- (20261006090000) they are labelled as such. Keeping them forever is safe but
-- leaves every project carrying its rehearsal. This lets the project OWNER
-- remove records labelled 'test', with a reason, and nothing else.
--
-- Two ways a plain "delete where data_status = 'test'" goes wrong, and what
-- closes each:
--
-- 1. Resurrection as deployed data. app-sync upserts on (project_id,
--    table_name, local_unique_id). A tester's phone that still holds a purged
--    record and syncs after deployment would INSERT it afresh, and
--    stamp_submission_data_status would label it 'deployed' -- turning tidied
--    test data into contamination of the real dataset. purged_submissions
--    keeps the key of every purged record, and discard_purged_submission
--    drops a re-upload of one before it is written (and says so in the audit
--    trail). The device is told the record synced, so it stops retrying.
--
-- 2. Destroying a real record by relabelling it first. reclassify_submissions
--    can move a deployed record to 'test'. That path is deliberately allowed
--    to end in a purge: its legitimate use is exactly the tester's phone that
--    uploaded practice records after deployment. The control is detective,
--    not preventive: received_status records what each row was labelled on
--    arrival and never changes, so the portal lists "received as deployed"
--    rows separately before a purge and the PURGE event names them; and the
--    row-level DELETE event keeps every purged record's full content in the
--    append-only audit trail, so a purge is never unrecoverable.
--
-- Data feeds (20261008090000) emit a tombstone only for a row they can read.
-- A purged row is gone, so feed_submissions now also emits one tombstone per
-- purged record; otherwise a consumer would keep its copy forever.
begin;

-- 1. received_status: data_status as it was when the server first received
--    the record. Constant default first (catalog-only, no per-row audit), then
--    only the rows that differ are written.
alter table public.submissions
  add column received_status text not null default 'deployed'
  constraint submissions_received_status_check check (received_status in ('test', 'deployed'));

-- Rows a portal user has relabelled take the label they had before the first
-- such relabel (actor_user_id is set only for an RPC call by a signed-in user,
-- so the prismcss2026 migration backfill does not count as one). Every other
-- row was received with its current label. Each written row gets an UPDATE
-- audit event, as with the 20261006090000 backfill; a locked project makes
-- this fail loudly rather than skip it.
with first_relabel as (
  select distinct on (e.entity_id) e.entity_id, e.old_values ->> 'data_status' as original
    from public.system_audit_events e
   where e.entity_type = 'submissions'
     and e.operation = 'UPDATE'
     and e.actor_user_id is not null
     and e.old_values ? 'data_status'
     and e.old_values ->> 'data_status' is distinct from e.new_values ->> 'data_status'
   order by e.entity_id, e.id
)
update public.submissions s
   set received_status = 'test'
  from public.submissions s2
  left join first_relabel r on r.entity_id = s2.id::text
 where s2.id = s.id
   and coalesce(r.original, s2.data_status) = 'test';

alter table public.submissions alter column received_status drop default;

insert into public.system_audit_events(project_id, entity_type, entity_id, operation,
                                       actor_database_role, new_values, reason)
select s.project_id, 'submissions', s.project_id::text, 'BACKFILL', session_user,
       jsonb_build_object('column', 'received_status',
                          'test', count(*) filter (where s.received_status = 'test'),
                          'deployed', count(*) filter (where s.received_status = 'deployed')),
       'received_status introduced by migration 20261008150000; set from data_status, or from '
       'the label before the first portal reclassification'
  from public.submissions s
 group by s.project_id;

-- 2. The stamp now sets both labels on INSERT, and received_status can never
--    change afterwards -- not even inside reclassify_submissions.
create or replace function public.stamp_submission_data_status() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  survey_status text;
begin
  if tg_op = 'UPDATE' then
    new.received_status := old.received_status;
    if coalesce(current_setting('datakollecta.reclassify', true), '') <> 'on' then
      new.data_status := old.data_status;
    end if;
    return new;
  end if;

  select sp.status::text into survey_status
    from public.survey_packages sp
   where sp.id = new.survey_package_id;

  new.data_status := case when survey_status in ('deployed', 'complete')
                          then 'deployed' else 'test' end;
  new.received_status := new.data_status;
  return new;
end; $$;

comment on column public.submissions.received_status is
  'test | deployed: data_status when the server FIRST received this record. Never changes, '
  'even when data_status is reclassified; a purge of a row received as deployed is flagged.';

-- 3. The keys of purged records. No write grants: only purge_test_submissions
--    (security definer) inserts. survey_code is copied, not joined, because a
--    survey version whose records were all purged may later be deleted.
create table public.purged_submissions (
  submission_id uuid primary key,
  project_id uuid not null references public.projects(id) on delete cascade,
  survey_package_id uuid not null,
  survey_code text not null,
  table_name text not null,
  local_unique_id text not null,
  received_status text not null,
  purged_at timestamptz not null default clock_timestamp(),
  purged_by uuid not null references public.profiles(id),
  reason text not null check (length(btrim(reason)) > 0)
);
create unique index purged_submissions_key
  on public.purged_submissions (project_id, table_name, local_unique_id);
create index purged_submissions_feed_cursor_idx
  on public.purged_submissions (project_id, table_name, purged_at, submission_id);

alter table public.purged_submissions enable row level security;
revoke all on public.purged_submissions from anon, authenticated, service_role;
grant select on public.purged_submissions to authenticated, service_role;
create policy "Members can read purged submissions" on public.purged_submissions
for select to authenticated using (exists(
  select 1 from public.project_members m
   where m.project_id = purged_submissions.project_id and m.user_id = auth.uid()));

comment on table public.purged_submissions is
  'One row per test record removed by purge_test_submissions. A re-upload of the same '
  '(project_id, table_name, local_unique_id) is discarded; the record''s content is in '
  'system_audit_events (its DELETE event).';

-- 4. A re-upload of a purged record is dropped before anything else sees it.
--    BEFORE triggers fire alphabetically, so this precedes enforce_submission_lock
--    and stamp_submission_data_status. Returning NULL from a BEFORE INSERT
--    trigger also skips app-sync's ON CONFLICT path, so the statement succeeds
--    and writes nothing.
create function public.discard_purged_submission() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  purged public.purged_submissions;
  api_role text;
begin
  select * into purged
    from public.purged_submissions p
   where p.project_id = new.project_id
     and p.table_name = new.table_name
     and p.local_unique_id = new.local_unique_id;
  if purged.submission_id is null then
    return new;
  end if;

  api_role := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
  insert into public.system_audit_events(project_id, entity_type, entity_id, operation, actor_user_id,
                                         actor_database_role, uploader_username, new_values)
  values (new.project_id, 'submissions', purged.submission_id::text, 'DISCARD_PURGED', auth.uid(),
          case when api_role is not null then 'api:' || api_role else session_user end,
          new.surveyor_id,
          jsonb_build_object('local_unique_id', new.local_unique_id,
                             'table_name', new.table_name,
                             'device_id', new.device_id,
                             'purged_at', purged.purged_at));
  return null;
end; $$;
revoke all on function public.discard_purged_submission() from public, anon, authenticated, service_role;

create trigger discard_purged_submission before insert on public.submissions
for each row execute function public.discard_purged_submission();

-- 5. DELETE stays refused on every route except inside purge_test_submissions,
--    which sets a transaction-local flag. A data lock still wins.
create or replace function public.enforce_project_data_lock() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 if tg_op='DELETE' then
   if tg_table_name = 'submissions'
      and coalesce(current_setting('datakollecta.purge', true), '') = 'on' then
     perform 1 from public.projects where id=old.project_id for update;
     if exists(select 1 from public.project_data_locks l where l.project_id=old.project_id and l.locked) then
       raise exception 'Project data are locked; test records cannot be purged' using errcode='42501';
     end if;
     return old;
   end if;
   raise exception 'Collected data cannot be permanently deleted; archive the project' using errcode='42501';
 end if;
 if tg_op='UPDATE' and old.project_id is distinct from new.project_id then
   raise exception 'Clinical records cannot change project' using errcode='42501';
 end if;
 perform 1 from public.projects where id=new.project_id for update;
 if exists(select 1 from public.project_data_locks l where l.project_id=new.project_id and l.locked) then
   raise exception 'Project data are locked; reconcile the pending record after authorised reopening' using errcode='42501';
 end if;
 return new;
end; $$;

-- 6. The purge. Owner-only and reason-required, like reclassify_submissions.
--    Only rows currently labelled 'test' are removed; any other requested id is
--    left alone and counted as not purged. Each removed row gets its own
--    DELETE event (with its full content) from audit_submission_state; one
--    PURGE event carries the reason and names the rows received as deployed.
create function public.purge_test_submissions(p_project_id uuid, p_ids uuid[], p_reason text)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  purged integer;
  purged_ids jsonb;
  previously_deployed jsonb;
  api_role text;
begin
  if auth.uid() is null or not exists(
       select 1 from public.project_members m
        where m.project_id = p_project_id and m.user_id = auth.uid() and m.role = 'owner') then
    raise exception 'Only the project owner may purge test records' using errcode = '42501';
  end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'A reason is required' using errcode = '22023';
  end if;
  if p_ids is null or cardinality(p_ids) = 0 then
    raise exception 'No records selected' using errcode = '22023';
  end if;
  if exists(select 1 from public.project_data_locks l where l.project_id = p_project_id and l.locked) then
    raise exception 'Project data are locked; test records cannot be purged' using errcode = '42501';
  end if;

  perform set_config('datakollecta.purge', 'on', true);
  with gone as (
    delete from public.submissions s
     where s.project_id = p_project_id
       and s.id = any(p_ids)
       and s.data_status = 'test'
    returning s.id, s.project_id, s.survey_package_id, s.table_name, s.local_unique_id, s.received_status
  ), kept as (
    insert into public.purged_submissions(submission_id, project_id, survey_package_id, survey_code,
                                          table_name, local_unique_id, received_status, purged_by, reason)
    select g.id, g.project_id, g.survey_package_id, sp.survey_code, g.table_name, g.local_unique_id,
           g.received_status, auth.uid(), btrim(p_reason)
      from gone g
      join public.survey_packages sp on sp.id = g.survey_package_id
    returning submission_id, received_status
  )
  select count(*),
         coalesce(jsonb_agg(submission_id), '[]'::jsonb),
         coalesce(jsonb_agg(submission_id) filter (where received_status = 'deployed'), '[]'::jsonb)
    into purged, purged_ids, previously_deployed
    from kept;
  perform set_config('datakollecta.purge', 'off', true);

  api_role := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
  insert into public.system_audit_events(project_id, entity_type, entity_id, operation, actor_user_id,
                                         actor_database_role, new_values, reason)
  values (p_project_id, 'submissions', gen_random_uuid()::text, 'PURGE', auth.uid(),
          case when api_role is not null then 'api:' || api_role else session_user end,
          jsonb_build_object('requested', cardinality(p_ids),
                             'purged', purged,
                             'submission_ids', purged_ids,
                             'previously_deployed_count', jsonb_array_length(previously_deployed),
                             'previously_deployed', previously_deployed),
          btrim(p_reason));
  return purged;
end; $$;

revoke all on function public.purge_test_submissions(uuid, uuid[], text) from public, anon, service_role;
grant execute on function public.purge_test_submissions(uuid, uuid[], text) to authenticated;

-- 7. Feeds: a purged record is a tombstone, on the same (updated_at, id)
--    cursor, so a consumer that held it deletes its copy.
create or replace function public.feed_submissions(p_key_id uuid, p_table text, p_since timestamptz,
                                                   p_after uuid, p_limit integer)
returns table(id uuid, updated_at timestamptz, deleted boolean, row_data jsonb)
language sql stable security definer set search_path = '' as $$
  select * from (
    select s.id,
           s.updated_at,
           not (s.data_status = any(k.data_statuses)) as deleted,
           case when s.data_status = any(k.data_statuses)
                then (s.data - 'synced_at') || jsonb_build_object(
                       'survey_version', sp.version,
                       'data_status', s.data_status,
                       'local_unique_id', s.local_unique_id,
                       'surveyor_id', s.surveyor_id,
                       'collected_at', s.collected_at,
                       'submitted_at', s.submitted_at)
                else jsonb_build_object('local_unique_id', s.local_unique_id, '_deleted', true)
           end as row_data
      from public.project_feed_keys k
      join public.submissions s on s.project_id = k.project_id and s.table_name = p_table
      join public.survey_packages sp on sp.id = s.survey_package_id
     where k.id = p_key_id
       and k.revoked_at is null
       and (k.survey_codes is null or sp.survey_code = any(k.survey_codes))
       and (p_since is null
            or (s.updated_at, s.id) > (p_since, coalesce(p_after, '00000000-0000-0000-0000-000000000000'::uuid)))
    union all
    select p.submission_id,
           p.purged_at,
           true,
           jsonb_build_object('local_unique_id', p.local_unique_id, '_deleted', true)
      from public.project_feed_keys k
      join public.purged_submissions p on p.project_id = k.project_id and p.table_name = p_table
     where k.id = p_key_id
       and k.revoked_at is null
       and (k.survey_codes is null or p.survey_code = any(k.survey_codes))
       and (p_since is null
            or (p.purged_at, p.submission_id) > (p_since, coalesce(p_after, '00000000-0000-0000-0000-000000000000'::uuid)))
  ) page
  order by page.updated_at, page.id
  limit least(greatest(coalesce(p_limit, 1000), 1), 2000);
$$;

revoke all on function public.feed_submissions(uuid, text, timestamptz, uuid, integer) from public, anon, authenticated;
grant execute on function public.feed_submissions(uuid, text, timestamptz, uuid, integer) to service_role;

commit;
