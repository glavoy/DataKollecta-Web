-- Local engineering tests only. All synthetic fixtures are rolled back.
\set ON_ERROR_STOP on
begin;
select gen_random_uuid() as owner_id,gen_random_uuid() as project_id,gen_random_uuid() as package_id \gset
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data,aud,role)
values(:'owner_id','validation-'||:'owner_id'||'@example.test','{}','{}','authenticated','authenticated');
insert into public.projects(id,name,slug,created_by) values(:'project_id','Synthetic validation project','validation-'||:'project_id',:'owner_id');
insert into public.project_members(project_id,user_id,role) values(:'project_id',:'owner_id','owner') on conflict(project_id,user_id) do nothing;
insert into public.survey_packages(id,project_id,name,display_name,version_date,survey_code,version,status,created_by,manifest)
values(:'package_id',:'project_id','validation-'||:'package_id','Validation fixture',current_date,'validation-'||:'package_id',1,'draft',:'owner_id',jsonb_build_object('surveyId','validation-'||:'package_id','databaseName','validation-'||:'package_id'));
insert into public.submissions(project_id,survey_package_id,table_name,local_unique_id,data,surveyor_id)
values(:'project_id',:'package_id','visit','validation-record','{"age":20,"note":"original"}','individual-uploader');
select set_config('validation.project_id',:'project_id',true);
select set_config('validation.package_id',:'package_id',true);
do $$ begin
 if not exists(select 1 from public.system_audit_events where project_id=current_setting('validation.project_id')::uuid and entity_type='submissions' and operation='INSERT' and new_values->'data'->>'age'='20') then raise exception 'Initial audit event missing'; end if;
end $$;
update public.submissions set data='{"age":21,"note":null}' where project_id=:'project_id';
do $$ begin
 if not exists(select 1 from public.system_audit_events where project_id=current_setting('validation.project_id')::uuid and entity_type='submissions' and operation='UPDATE' and old_values->'data'->>'age'='20' and new_values->'data'->>'age'='21') then raise exception 'Prior clinical values lost'; end if;
 begin update public.system_audit_events set operation='FAKE' where project_id=current_setting('validation.project_id')::uuid;
   raise exception 'Audit modification unexpectedly succeeded'; exception when insufficient_privilege then null; end;
 begin delete from public.system_audit_events where project_id=current_setting('validation.project_id')::uuid;
   raise exception 'Audit deletion unexpectedly succeeded'; exception when insufficient_privilege then null; end;
 begin delete from public.projects where id=current_setting('validation.project_id')::uuid;
   raise exception 'Project deletion unexpectedly succeeded'; exception when insufficient_privilege then null; end;
 begin delete from public.survey_packages where id=current_setting('validation.package_id')::uuid;
   raise exception 'Survey deletion unexpectedly succeeded'; exception when insufficient_privilege then null; end;
end $$;
insert into public.formchanges(formchanges_uuid,project_id,record_uuid,tablename,fieldname,oldvalue,newvalue,surveyor_id,changed_at)
values('validation-'||:'project_id',:'project_id','validation-record','visit','age','20','21','individual-uploader','2026-10-05 12:00:00');
update public.formchanges set synced_at=clock_timestamp() where project_id=:'project_id';
do $$ begin
 begin update public.formchanges set newvalue='99' where project_id=current_setting('validation.project_id')::uuid;
   raise exception 'Device history rewrite unexpectedly succeeded'; exception when insufficient_privilege then null; end;
 begin delete from public.formchanges where project_id=current_setting('validation.project_id')::uuid;
   raise exception 'Device history deletion unexpectedly succeeded'; exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub',:'owner_id',true);
select set_config('request.jwt.claims',jsonb_build_object('sub',:'owner_id','role','authenticated')::text,true);
set local role authenticated;
select public.set_project_data_lock(:'project_id',true,'Approved synthetic lock test');
select public.record_data_export(:'project_id','{"outcome":"prepared","scope":"synthetic test"}');
do $$ begin
 if not exists(select 1 from public.system_audit_events where project_id=current_setting('validation.project_id')::uuid and entity_type='project_data_locks') then raise exception 'Lock event missing'; end if;
 if not exists(select 1 from public.system_audit_events where project_id=current_setting('validation.project_id')::uuid and entity_type='export') then raise exception 'Export event missing'; end if;
 begin insert into public.submissions(project_id,survey_package_id,table_name,local_unique_id,data) values(current_setting('validation.project_id')::uuid,current_setting('validation.package_id')::uuid,'visit','bypass','{}');
   raise exception 'Direct portal write unexpectedly succeeded'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role service_role;
do $$ begin
 begin update public.submissions set data='{"age":99}' where project_id=current_setting('validation.project_id')::uuid;
   raise exception 'Locked ingestion unexpectedly succeeded'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role authenticated;
select public.set_project_data_lock(:'project_id',false,'Authorised synthetic reopening');
reset role;
update public.submissions set data='{"age":22}' where project_id=:'project_id';
do $$ begin
 if not exists(select 1 from public.submissions where project_id=current_setting('validation.project_id')::uuid and data->>'age'='22') then raise exception 'Reopened ingestion failed'; end if;
end $$;
select set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
set local role authenticated;
do $$ begin
 if exists(select 1 from public.system_audit_events where project_id=current_setting('validation.project_id')::uuid) then raise exception 'Cross-project audit read succeeded'; end if;
 begin perform public.set_project_data_lock(current_setting('validation.project_id')::uuid,true,'Unauthorised');
   raise exception 'Unauthorised lock succeeded'; exception when insufficient_privilege then null; end;
 begin perform public.record_data_export(current_setting('validation.project_id')::uuid,'{}');
   raise exception 'Unauthorised export logging succeeded'; exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
\echo 'Validation control engineering checks passed; fixtures rolled back'
