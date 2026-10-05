import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { admin, callFunction, createFixture, login, submission, sql, warmUp } from './helpers.ts';
Deno.test('validation controls runtime warmup', warmUp);
Deno.test('locked project rejects a pending upload without losing server values', async () => {
  const f = await createFixture();
  try {
    const token = await login(f);
    const row = submission(f);
    const first = await callFunction('app-sync', { token, submissions: [row] });
    assertEquals(first.body.failed.length, 0);
    await sql(`insert into public.project_data_locks(project_id,locked,reason,changed_by) values('${f.projectId}',true,'Synthetic lock test','${f.ownerId}');`);
    const rejected = await callFunction('app-sync', { token, submissions: [{ ...row, data: { ...(row.data as Record<string, unknown>), age: '99' } }] });
    assertEquals(rejected.body.synced.length, 0);
    assertEquals(rejected.body.failed.length, 1);
    const { data, error } = await admin.from('submissions').select('data').eq('project_id', f.projectId).single();
    assertEquals(error, null); assertEquals(data!.data, row.data);
  } finally { await f.cleanup(); }
});
Deno.test('audit retry preserves its original event and rejects a rewritten value', async () => {
  const f = await createFixture();
  try {
    const token = await login(f);
    const row = submission(f);
    await callFunction('app-sync', { token, submissions: [row] });
    const event = { formchanges_uuid: crypto.randomUUID(), record_uuid: row.local_uuid, tablename: row.table_name, fieldname: 'age', oldvalue: '20', newvalue: '21', changed_at: '2026-10-05T12:00:00', event_time_utc: '2026-10-05T09:00:00Z', device_utc_offset_minutes: 180, reason_for_change: 'Corrected against synthetic source' };
    const first = await callFunction('app-sync', { token, formchanges: [event] });
    assertEquals(first.body.formchanges_failed.length, 0);
    const before = await admin.from('formchanges').select('*').eq('formchanges_uuid', event.formchanges_uuid).single();
    const replay = await callFunction('app-sync', { token, formchanges: [event] });
    assertEquals(replay.body.formchanges_failed.length, 0);
    const after = await admin.from('formchanges').select('*').eq('formchanges_uuid', event.formchanges_uuid).single();
    assertEquals(after.data, before.data);
    assertEquals(after.data!.reason_for_change, event.reason_for_change);
    assertEquals(Date.parse(after.data!.event_time_utc), Date.parse(event.event_time_utc));
    const tampered = await callFunction('app-sync', { token, formchanges: [{ ...event, newvalue: '999' }] });
    assertEquals(tampered.body.formchanges_synced.length, 0);
    assertEquals(tampered.body.formchanges_failed.length, 1);
    const preserved = await admin.from('formchanges').select('newvalue').eq('formchanges_uuid', event.formchanges_uuid).single();
    assertEquals(preserved.data!.newvalue, '21');
    const audit = await admin.from('system_audit_events').select('*').eq('project_id', f.projectId).eq('entity_type', 'submissions');
    assert(audit.data!.some(e => e.operation === 'INSERT'));
  } finally { await f.cleanup(); }
});
