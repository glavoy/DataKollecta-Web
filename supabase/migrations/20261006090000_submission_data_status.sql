-- Test vs deployed data: every submission records whether its survey was in
-- testing or deployed when the server first received it.
--
-- Why a column, and why here. A survey moves test -> deployed IN PLACE: the
-- same survey_packages row, the same zip, the same databaseName. Phones never
-- re-download it and never learn its status -- the "[TEST]" prefix exists only
-- in app-login's download list, never in the installed package. So test and
-- deployed records arrive in one table under one survey_package_id, and since
-- 20261005090000 a record cannot be deleted. The only place that knows the
-- status at the moment a record arrives is this database, so the stamp is a
-- trigger rather than anything app-sync or the device sends.
--
-- What it means, exactly: the survey's status at FIRST receipt. A resync of
-- the same record never changes it. A tester's phone that uploads old test
-- records after deployment gets them stamped 'deployed'; reclassify_submissions
-- (owner-only, reason required, audited) is the correction path.
--
-- Two values rather than the four survey statuses: draft and test map to
-- 'test'; deployed and complete map to 'deployed'. Filtering and exports only
-- ever need that split.
begin;

-- 1. The column. A constant default is a catalog-only change, so existing rows
--    get 'deployed' without a table rewrite and without the row-level audit
--    trigger firing once per historical record. The default is then dropped:
--    from here on every row is stamped by the trigger below, and a NOT NULL
--    violation is better than a silent default if that ever stops happening.
alter table public.submissions
  add column data_status text not null default 'deployed'
  constraint submissions_data_status_check check (data_status in ('test', 'deployed'));
alter table public.submissions alter column data_status drop default;

-- 2. Historical data. Everything already collected is treated as deployed,
--    except project prismcss2026 (PRISM CSS 2026), whose data so far is all
--    test data -- confirmed by the project owner when this was introduced.
--    Done BEFORE the stamping trigger exists, so the update is not reverted by
--    it; it still passes through audit_submission_state, so every relabelled
--    record has its own old/new audit event. A data lock on the project makes
--    this fail loudly rather than skip it.
update public.submissions s
   set data_status = 'test'
  from public.projects p
 where p.id = s.project_id
   and p.slug = 'prismcss2026';

-- One summary event per project saying how its existing records were
-- labelled, since the default above leaves no per-row trace.
insert into public.system_audit_events(project_id, entity_type, entity_id, operation,
                                       actor_database_role, new_values, reason)
select s.project_id, 'submissions', s.project_id::text, 'BACKFILL', session_user,
       jsonb_build_object('column', 'data_status',
                          'test', count(*) filter (where s.data_status = 'test'),
                          'deployed', count(*) filter (where s.data_status = 'deployed')),
       'data_status introduced; records received before it were labelled by migration '
       '20261006090000 (prismcss2026 as test, all other projects as deployed)'
  from public.submissions s
 group by s.project_id;

-- 3. The stamp.
--    INSERT: from the survey package the row is attributed to.
--    UPDATE: always the existing value, whatever the statement said -- so
--    app-sync's upsert of a resynced record cannot relabel it -- unless the
--    transaction-local flag that only reclassify_submissions sets is on.
--    Compares status::text, like the lifecycle guards, so no enum literal
--    appears in the body.
create function public.stamp_submission_data_status() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  survey_status text;
begin
  if tg_op = 'UPDATE' then
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
  return new;
end; $$;

create trigger stamp_submission_data_status before insert or update on public.submissions
for each row execute function public.stamp_submission_data_status();

revoke all on function public.stamp_submission_data_status() from public, anon, authenticated, service_role;

-- 4. Filtered counts and exports read by (project, package, form, status).
create index submissions_data_status_idx
  on public.submissions (project_id, survey_package_id, table_name, data_status);

-- 5. The correction path. Owner-only and reason-required, like
--    set_project_data_lock. Each changed row gets its own old/new event from
--    audit_submission_state; one summary event carries the reason and the
--    full list of requested ids. A locked project refuses it, through
--    enforce_project_data_lock, like any other change to its records.
create function public.reclassify_submissions(p_project_id uuid, p_ids uuid[],
                                              p_data_status text, p_reason text)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  changed integer;
  api_role text;
begin
  if auth.uid() is null or not exists(
       select 1 from public.project_members m
        where m.project_id = p_project_id and m.user_id = auth.uid() and m.role = 'owner') then
    raise exception 'Only the project owner may reclassify records' using errcode = '42501';
  end if;
  if p_data_status is null or p_data_status not in ('test', 'deployed') then
    raise exception 'Records can only be classified as test or deployed' using errcode = '22023';
  end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'A reason is required' using errcode = '22023';
  end if;
  if p_ids is null or cardinality(p_ids) = 0 then
    raise exception 'No records selected' using errcode = '22023';
  end if;

  perform set_config('datakollecta.reclassify', 'on', true);
  update public.submissions
     set data_status = p_data_status
   where project_id = p_project_id
     and id = any(p_ids)
     and data_status <> p_data_status;
  get diagnostics changed = row_count;
  perform set_config('datakollecta.reclassify', 'off', true);

  api_role := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
  insert into public.system_audit_events(project_id, entity_type, entity_id, operation, actor_user_id,
                                         actor_database_role, new_values, reason)
  values (p_project_id, 'submissions', gen_random_uuid()::text, 'RECLASSIFY', auth.uid(),
          case when api_role is not null then 'api:' || api_role else session_user end,
          jsonb_build_object('data_status', p_data_status,
                             'requested', cardinality(p_ids),
                             'changed', changed,
                             'submission_ids', to_jsonb(p_ids)),
          btrim(p_reason));
  return changed;
end; $$;

revoke all on function public.reclassify_submissions(uuid, uuid[], text, text) from public, anon, service_role;
grant execute on function public.reclassify_submissions(uuid, uuid[], text, text) to authenticated;

comment on column public.submissions.data_status is
  'test | deployed: the survey''s status when the server FIRST received this record '
  '(draft/test -> test, deployed/complete -> deployed). Set by stamp_submission_data_status; '
  'a resync never changes it. Changeable only through reclassify_submissions, which is '
  'owner-only, requires a reason and is audited.';

commit;
