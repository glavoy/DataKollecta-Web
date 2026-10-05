-- Local engineering tests for 20261005100000_audit_trail_hardening.sql.
-- Run: psql "$SUPABASE_DB_URL" -f supabase/tests/audit_trail_hardening.sql
-- All synthetic fixtures are rolled back.
\set ON_ERROR_STOP on
begin;
select gen_random_uuid() as owner_id, gen_random_uuid() as project_id, gen_random_uuid() as package_id \gset
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data,aud,role)
values(:'owner_id','hardening-'||:'owner_id'||'@example.test','{}','{}','authenticated','authenticated');
select set_config('t.project_id', :'project_id', true);
select set_config('t.package_id', :'package_id', true);
select set_config('t.owner_id', :'owner_id', true);

-- 4. projects, survey_packages and crfs are audited (insert here; update below).
insert into public.projects(id,name,slug,created_by) values(:'project_id','Hardening project','hardening-'||:'project_id',:'owner_id');
insert into public.project_members(project_id,user_id,role) values(:'project_id',:'owner_id','owner') on conflict(project_id,user_id) do nothing;
insert into public.survey_packages(id,project_id,name,display_name,version_date,survey_code,version,status,created_by,manifest)
values(:'package_id',:'project_id','hardening-'||:'package_id','Hardening fixture',current_date,'hardening-'||:'package_id',1,'draft',:'owner_id',
       jsonb_build_object('surveyId','hardening-'||:'package_id','databaseName','hardening-'||:'package_id'));
insert into public.crfs(survey_package_id,project_id,table_name,display_name,display_order,is_base)
values(:'package_id',:'project_id','visit','Visit',1,true);
update public.projects set description = 'renamed for audit test' where id = :'project_id';
do $$ declare t text; begin
 foreach t in array array['projects','survey_packages','crfs'] loop
   if not exists(select 1 from public.system_audit_events
                 where project_id = current_setting('t.project_id')::uuid and entity_type = t and operation = 'INSERT') then
     raise exception '% insert not audited', t;
   end if;
 end loop;
 if not exists(select 1 from public.system_audit_events
               where project_id = current_setting('t.project_id')::uuid and entity_type = 'projects' and operation = 'UPDATE'
                 and old_values->>'description' is null and new_values->>'description' = 'renamed for audit test') then
   raise exception 'project update not audited with old and new values';
 end if;
 -- updated_at alone is bookkeeping, not a revision.
 update public.projects set updated_at = now() + interval '1 minute' where id = current_setting('t.project_id')::uuid;
 if (select count(*) from public.system_audit_events
     where project_id = current_setting('t.project_id')::uuid and entity_type = 'projects' and operation = 'UPDATE') <> 1 then
   raise exception 'an updated_at-only change was audited as a revision';
 end if;
end $$;

-- 1. The actor's role is recorded, not the PostgREST login role.
insert into public.submissions(project_id,survey_package_id,table_name,local_unique_id,data,surveyor_id)
values(:'project_id',:'package_id','visit','direct-sql','{"age":1}','direct');
do $$ begin
 if (select actor_database_role from public.system_audit_events
     where project_id = current_setting('t.project_id')::uuid and entity_type = 'submissions' and operation = 'INSERT'
       and new_values->>'local_unique_id' = 'direct-sql') <> session_user then
   raise exception 'direct SQL change not attributed to the database login role';
 end if;
end $$;
-- Simulate an API request exactly as PostgREST presents one.
select set_config('request.jwt.claims', jsonb_build_object('role','service_role')::text, true);
set local role service_role;
insert into public.submissions(project_id,survey_package_id,table_name,local_unique_id,data,surveyor_id)
values(:'project_id',:'package_id','visit','via-api','{"age":2}','field.worker');
reset role;
select set_config('request.jwt.claims', '', true);
do $$ begin
 if (select actor_database_role from public.system_audit_events
     where project_id = current_setting('t.project_id')::uuid and entity_type = 'submissions' and operation = 'INSERT'
       and new_values->>'local_unique_id' = 'via-api') <> 'api:service_role' then
   raise exception 'API change not attributed to its API role';
 end if;
end $$;

-- 2. TRUNCATE is refused, even for the table owner.
do $$ declare t text; begin
 foreach t in array array['system_audit_events','formchanges','submissions'] loop
   begin
     execute format('truncate public.%I', t);
     raise exception 'truncate of % unexpectedly succeeded', t;
   exception when insufficient_privilege then null;
   end;
 end loop;
end $$;

-- 3. A locked project refuses formchanges as well as submissions.
insert into public.project_data_locks(project_id,locked,reason,changed_by) values(:'project_id',true,'Hardening lock test',:'owner_id');
do $$ begin
 begin
   insert into public.formchanges(formchanges_uuid,project_id,record_uuid,tablename,fieldname,oldvalue,newvalue,surveyor_id,changed_at)
   values(gen_random_uuid()::text,current_setting('t.project_id')::uuid,'via-api','visit','age','2','3','field.worker','2026-10-05 12:00');
   raise exception 'formchange accepted into a locked project';
 exception when insufficient_privilege then null;
 end;
end $$;
update public.project_data_locks set locked = false where project_id = :'project_id';
insert into public.formchanges(formchanges_uuid,project_id,record_uuid,tablename,fieldname,oldvalue,newvalue,surveyor_id,changed_at)
values(gen_random_uuid()::text,:'project_id','via-api','visit','age','2','3','field.worker','2026-10-05 12:00');

rollback;
\echo 'Audit trail hardening checks passed; fixtures rolled back'
