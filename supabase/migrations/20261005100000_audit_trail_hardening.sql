-- Hardening of the audit trail introduced in 20261005090000, closing four gaps
-- found by probing it against the design in the validation package (DK-VAL-003 §7):
--
-- 1. Every change made through the API was attributed to `authenticator`.
--    session_user is the PostgREST login role for EVERY API request, so a
--    field device syncing through app-sync (service_role) and a portal user
--    (authenticated) were indistinguishable; only direct SQL showed anything
--    else. The API role is in the request's JWT claims, which PostgREST sets
--    per request, so it is recorded from there.
--
-- 2. TRUNCATE bypassed the guards. The row-level BEFORE UPDATE/DELETE triggers
--    never fire for TRUNCATE, so the table owner could empty
--    system_audit_events, formchanges or submissions with one statement and
--    leave no trace. Statement-level BEFORE TRUNCATE triggers refuse it.
--    (A table owner can still drop or disable a trigger; that is DDL, visible
--    in migration history and platform logs, and is the residual risk the
--    validation package accepts as DK-VAL-002 R-10.)
--
-- 3. A locked project still accepted formchanges. A device edit made after
--    the lock would have its submission update refused but its change rows
--    accepted, leaving server history describing an edit the server never
--    applied. formchanges now honour the same lock, so both halves stay on the
--    device and arrive together after an authorised reopening.
--
-- 4. projects, survey_packages and crfs were not audited, although who
--    archived a project or changed a survey version is part of the record.
begin;

create or replace function public.record_system_audit_event() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
 p uuid; entity text; before_values jsonb; after_values jsonb; api_role text; actor_role text;
begin
 if tg_op <> 'INSERT' then before_values := to_jsonb(old); end if;
 if tg_op <> 'DELETE' then after_values := to_jsonb(new); end if;
 -- Bookkeeping timestamps alone are not a new revision of anything.
 before_values := before_values - 'updated_at';
 after_values := after_values - 'updated_at';
 if tg_table_name = 'submissions' then
   before_values := before_values - 'submitted_at';
   after_values := after_values - 'submitted_at';
 end if;
 if tg_op = 'UPDATE' and before_values is not distinct from after_values then return new; end if;

 -- projects carries its own id; every other audited table has project_id.
 p := coalesce((after_values->>'project_id')::uuid, (before_values->>'project_id')::uuid);
 if p is null and tg_table_name = 'projects' then
   p := coalesce((after_values->>'id')::uuid, (before_values->>'id')::uuid);
 end if;
 entity := coalesce(after_values->>'id', before_values->>'id',
                    after_values->>'project_id', before_values->>'project_id');

 -- 'api:service_role' = app-sync (a field device) or another server function;
 -- 'api:authenticated' = a signed-in portal user (actor_user_id says who);
 -- anything else = a direct database session, named by its login role.
 api_role := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
 actor_role := case when api_role is not null then 'api:' || api_role else session_user end;

 insert into public.system_audit_events(project_id, entity_type, entity_id, operation, actor_user_id,
                                        actor_database_role, uploader_username, old_values, new_values)
 values (p, tg_table_name, entity, tg_op, auth.uid(), actor_role,
         case when tg_table_name = 'submissions'
              then coalesce(after_values->>'surveyor_id', before_values->>'surveyor_id') end,
         -- Password hashes and bearer tokens must never enter an audit view/export.
         before_values - 'password_hash' - 'token', after_values - 'password_hash' - 'token');
 if tg_op = 'DELETE' then return old; end if;
 return new;
end; $$;

create trigger audit_projects after insert or update or delete on public.projects
for each row execute function public.record_system_audit_event();
create trigger audit_survey_packages after insert or update or delete on public.survey_packages
for each row execute function public.record_system_audit_event();
create trigger audit_crfs after insert or update or delete on public.crfs
for each row execute function public.record_system_audit_event();

create function public.refuse_truncate() returns trigger
language plpgsql set search_path = '' as $$
begin
 raise exception '% cannot be truncated: it holds collected data or its audit trail', tg_table_name
   using errcode = '42501';
end; $$;
revoke all on function public.refuse_truncate() from public, anon, authenticated, service_role;
create trigger refuse_truncate before truncate on public.system_audit_events
for each statement execute function public.refuse_truncate();
create trigger refuse_truncate before truncate on public.formchanges
for each statement execute function public.refuse_truncate();
create trigger refuse_truncate before truncate on public.submissions
for each statement execute function public.refuse_truncate();

-- Same lock as submissions (enforce_project_data_lock also refuses DELETE and
-- moving a row between projects, both already refused for formchanges by
-- protect_device_audit_history). Named so it sorts before that trigger:
-- BEFORE triggers fire alphabetically, and a locked project should refuse
-- even an exact replay rather than silently accept it.
create trigger enforce_formchanges_lock before insert or update or delete on public.formchanges
for each row execute function public.enforce_project_data_lock();

commit;
