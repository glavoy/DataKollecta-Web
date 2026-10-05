-- Candidate data-integrity controls. Deploy only after independent review,
-- approved local/staging verification, historical-data assessment and release approval.
begin;

alter table public.formchanges add column event_time_utc timestamptz;
alter table public.formchanges add column reason_for_change text;
alter table public.formchanges add column device_utc_offset_minutes integer check(device_utc_offset_minutes between -840 and 840);

create table public.system_audit_events (
    id bigint generated always as identity primary key,
    project_id uuid not null,
    entity_type text not null,
    entity_id text not null,
    operation text not null,
    occurred_at timestamptz not null default clock_timestamp(),
    actor_user_id uuid,
    actor_database_role text not null,
    uploader_username text,
    old_values jsonb,
    new_values jsonb,
    reason text
);
comment on table public.system_audit_events is
'Append-only server observations. uploader_username identifies the authenticated uploader, not necessarily the original offline editor. Historical events are not backfilled.';
create index system_audit_events_project_time on public.system_audit_events(project_id, occurred_at, id);
alter table public.system_audit_events enable row level security;
revoke all on public.system_audit_events from anon, authenticated, service_role;
grant select on public.system_audit_events to authenticated, service_role;
create policy "Members can read system audit events" on public.system_audit_events
for select to authenticated using (
 exists(select 1 from public.project_members m where m.project_id=system_audit_events.project_id and m.user_id=auth.uid())
);

create function public.protect_system_audit_events() returns trigger
language plpgsql set search_path = '' as $$
begin
 raise exception 'Audit events cannot be modified or deleted' using errcode='42501';
end; $$;
create trigger protect_system_audit_events before update or delete on public.system_audit_events
for each row execute function public.protect_system_audit_events();

-- Retain original clinical values even when a device sends no change log.
create function public.record_system_audit_event() returns trigger
language plpgsql security definer set search_path = '' as $$
declare p uuid; entity text; before_values jsonb; after_values jsonb;
begin
 if tg_op <> 'INSERT' then before_values := to_jsonb(old); end if;
 if tg_op <> 'DELETE' then after_values := to_jsonb(new); end if;
 if tg_table_name='submissions' then
   -- Receipt/bookkeeping changes alone are not new clinical revisions.
   before_values := before_values - 'updated_at' - 'submitted_at';
   after_values := after_values - 'updated_at' - 'submitted_at';
 end if;
 if tg_op='UPDATE' and before_values is not distinct from after_values then return new; end if;
 p := coalesce((after_values->>'project_id')::uuid,(before_values->>'project_id')::uuid);
 entity := coalesce(after_values->>'id',before_values->>'id',after_values->>'project_id',before_values->>'project_id');
 insert into public.system_audit_events(project_id,entity_type,entity_id,operation,actor_user_id,actor_database_role,uploader_username,old_values,new_values)
 values(p,tg_table_name,entity,tg_op,auth.uid(),session_user,
 case when tg_table_name='submissions' then coalesce(after_values->>'surveyor_id',before_values->>'surveyor_id') else null end,
 -- Password hashes and bearer tokens must never enter an audit view/export.
 before_values - 'password_hash' - 'token',after_values - 'password_hash' - 'token');
 if tg_op='DELETE' then return old; end if;
 return new;
end; $$;
create trigger audit_submission_state after insert or update or delete on public.submissions
for each row execute function public.record_system_audit_event();
create trigger audit_project_members after insert or update or delete on public.project_members
for each row execute function public.record_system_audit_event();
create trigger audit_app_credentials after insert or update or delete on public.app_credentials
for each row execute function public.record_system_audit_event();
drop function if exists public.log_submission_change();

-- No ordinary portal role may bypass the authenticated ingestion path.
drop policy if exists "Editors can manage submissions" on public.submissions;
drop policy if exists "Editors can manage formchanges" on public.formchanges;
revoke insert,update,delete on public.submissions from anon,authenticated;
revoke insert,update,delete on public.formchanges from anon,authenticated;

create function public.protect_device_audit_history() returns trigger
language plpgsql set search_path = '' as $$
begin
 if tg_op='DELETE' then
   raise exception 'Device audit history cannot be deleted' using errcode='42501';
 end if;
 -- Exact replay is allowed, including a fresh receipt timestamp, but must
 -- return the previously recorded row without changing its original receipt.
 if (to_jsonb(new)-'synced_at') is distinct from (to_jsonb(old)-'synced_at') then
   raise exception 'An existing audit event cannot be rewritten' using errcode='42501';
 end if;
 return old;
end; $$;
create trigger protect_device_audit_history before update or delete on public.formchanges
for each row execute function public.protect_device_audit_history();

create table public.project_data_locks (
 project_id uuid primary key references public.projects(id),
 locked boolean not null default false,
 reason text not null check(length(btrim(reason))>0),
 changed_by uuid not null references public.profiles(id),
 changed_at timestamptz not null default clock_timestamp()
);
alter table public.project_data_locks enable row level security;
revoke all on public.project_data_locks from anon,authenticated,service_role;
grant select on public.project_data_locks to authenticated,service_role;
create policy "Members can read project locks" on public.project_data_locks
for select to authenticated using(exists(select 1 from public.project_members m where m.project_id=project_data_locks.project_id and m.user_id=auth.uid()));
create trigger audit_project_lock after insert or update on public.project_data_locks
for each row execute function public.record_system_audit_event();

create function public.set_project_data_lock(p_project_id uuid,p_locked boolean,p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
 if auth.uid() is null or not exists(select 1 from public.project_members m where m.project_id=p_project_id and m.user_id=auth.uid() and m.role='owner') then
   raise exception 'Only the project owner may change a data lock' using errcode='42501';
 end if;
 if p_reason is null or length(btrim(p_reason))=0 then raise exception 'A reason is required'; end if;
 -- Serialises a lock transition with clinical ingestion for this project.
 perform 1 from public.projects where id=p_project_id for update;
 insert into public.project_data_locks(project_id,locked,reason,changed_by)
 values(p_project_id,p_locked,btrim(p_reason),auth.uid())
 on conflict(project_id) do update set locked=excluded.locked,reason=excluded.reason,changed_by=excluded.changed_by,changed_at=clock_timestamp();
end; $$;
revoke all on function public.set_project_data_lock(uuid,boolean,text) from public,anon,service_role;
grant execute on function public.set_project_data_lock(uuid,boolean,text) to authenticated;

create function public.enforce_project_data_lock() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 if tg_op='DELETE' then
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
create trigger enforce_submission_lock before insert or update or delete on public.submissions
for each row execute function public.enforce_project_data_lock();

create function public.prevent_collected_data_destruction() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 if tg_table_name='projects' then
   if exists(select 1 from public.submissions s where s.project_id=old.id)
      or exists(select 1 from public.formchanges f where f.project_id=old.id) then
     raise exception 'Project contains retained data; archive it instead of deleting' using errcode='42501';
   end if;
 else
   if exists(select 1 from public.submissions s where s.survey_package_id=old.id) then
     raise exception 'Survey contains retained data and cannot be deleted' using errcode='42501';
   end if;
 end if;
 return old;
end; $$;
create trigger protect_project_data before delete on public.projects
for each row execute function public.prevent_collected_data_destruction();
create trigger protect_survey_data before delete on public.survey_packages
for each row execute function public.prevent_collected_data_destruction();

-- Narrow audited interface for browser exports, including read-only users.
create function public.record_data_export(p_project_id uuid,p_details jsonb) returns bigint
language plpgsql security definer set search_path = '' as $$
declare event_id bigint;
begin
 if auth.uid() is null or not exists(select 1 from public.project_members m where m.project_id=p_project_id and m.user_id=auth.uid()) then
   raise exception 'Project access required' using errcode='42501';
 end if;
 if p_details is null or jsonb_typeof(p_details)<>'object' or octet_length(p_details::text)>65536 then raise exception 'Invalid export metadata'; end if;
 insert into public.system_audit_events(project_id,entity_type,entity_id,operation,actor_user_id,actor_database_role,new_values)
 values(p_project_id,'export',gen_random_uuid()::text,'EXPORT',auth.uid(),session_user,p_details)
 returning id into event_id;
 return event_id;
end; $$;
revoke all on function public.record_data_export(uuid,jsonb) from public,anon,service_role;
grant execute on function public.record_data_export(uuid,jsonb) to authenticated;
-- Trigger functions are not external RPCs.
revoke all on function public.record_system_audit_event() from public,anon,authenticated,service_role;
revoke all on function public.protect_system_audit_events() from public,anon,authenticated,service_role;
revoke all on function public.protect_device_audit_history() from public,anon,authenticated,service_role;
revoke all on function public.enforce_project_data_lock() from public,anon,authenticated,service_role;
revoke all on function public.prevent_collected_data_destruction() from public,anon,authenticated,service_role;
commit;
