import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createApp} from '../server/app.mjs';

async function fixture(enabled) {
  const directory = await mkdtemp(path.join(os.tmpdir(),'drive-security-'));
  const instance = await createApp({dataDir:directory,production:false,env:{DRIVE_SYNC_ENABLED:enabled ? 'true' : 'false',MEDIA_STORAGE_PROVIDER:'local',MEDIA_CLEANUP_ENABLED:'false'},mailer:{notifyNewInquiry:async () => ({skipped:true})}});
  const server = await new Promise(resolve => {
    const listening = instance.app.listen(0,'127.0.0.1',() => resolve(listening));
  });
  const base = 'http://127.0.0.1:'+server.address().port;
  let cookie;
  async function request(method,route,body,{authenticated=true,origin=base}={}) {
    return fetch(base+route,{method,headers:{'Content-Type':'application/json',Origin:origin,...(authenticated && cookie ? {Cookie:cookie} : {})},body:body === undefined ? undefined : JSON.stringify(body)});
  }
  const setup = await request('POST','/api/admin/setup',{email:'fixture@example.test',password:'long-fixture-password'});
  assert.equal(setup.status,201);
  cookie = setup.headers.get('set-cookie').split(';')[0];
  return {...instance,request,close:async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await instance.photoCleanup.close();
    await instance.mediaControl.close();
    await instance.db.close();
    await rm(directory,{recursive:true,force:true});
  }};
}
test('Drive admin routes enforce session, Origin, no-store and off-by-default writes',async () => {
  const current = await fixture(false);
  try {
    assert.equal((await current.request('GET','/api/admin/drive/status',undefined,{authenticated:false})).status,401);
    const status = await current.request('GET','/api/admin/drive/status');
    assert.equal(status.status,200);
    assert.match(status.headers.get('cache-control'),/no-store/);
    assert.equal((await status.json()).enabled,false);
    const body = {service_account_email:'sync@test.iam.gserviceaccount.com',root_folder_id:'rootfolder'};
    assert.equal((await current.request('PUT','/api/admin/drive/connection',body)).status,503);
    assert.equal((await current.request('PUT','/api/admin/drive/connection',body,{origin:'https://attacker.example'})).status,403);
    assert.equal((await current.db.all('SELECT * FROM drive_connections')).length,0);
  } finally { await current.close(); }
});
test('Drive config keeps credentials out of database and mutations are bounded per admin',async () => {
  const current = await fixture(true);
  try {
    const body = {service_account_email:'sync@test.iam.gserviceaccount.com',root_folder_id:'rootfolder',private_key:'do-not-store-test-value',refresh_token:'not-a-real-secret'};
    const configured = await current.request('PUT','/api/admin/drive/connection',body);
    assert.equal(configured.status,200);
    const saved = JSON.stringify(await current.db.all('SELECT * FROM drive_connections'));
    assert.ok(!saved.includes('do-not-store'));
    assert.ok(!saved.includes('not-a-real-secret'));
    assert.equal((await current.request('PUT','/api/admin/drive/connection',{...body,root_folder_id:'https://attacker.example'})).status,422);
    await current.db.run('UPDATE rate_limits SET count=119,expires=? WHERE key=?',[Date.now()+60000,'drive-admin:owner']);
    assert.equal((await current.request('POST','/api/admin/drive/check',{})).status,202);
    assert.equal((await current.request('POST','/api/admin/drive/check',{})).status,429);
    assert.equal((await current.db.all('SELECT * FROM drive_sync_jobs')).length,1);
    const lock = await current.mediaControl.acquire('fixture-backup');
    assert.equal((await current.request('PUT','/api/admin/drive/connection',body)).status,503);
    await current.mediaControl.release(lock);
  } finally { await current.close(); }
});

test('Drive shared scope is explicit, preserved when omitted, and browse enforces session, Origin and bounds',async () => {
  const f = await fixture(true);
  try {
    const body = {service_account_email:'sync@test.iam.gserviceaccount.com',root_folder_id:'rootfolder'};
    let response = await f.request('PUT','/api/admin/drive/connection',body);
    assert.equal((await response.json()).connection.folder_scope,'root');
    for (const folder_scope of ['all','',null,123]) assert.equal((await f.request('PUT','/api/admin/drive/connection',{...body,folder_scope})).status,422);
    response = await f.request('PUT','/api/admin/drive/connection',{...body,folder_scope:'shared'});
    const shared = (await response.json()).connection;
    assert.equal(shared.folder_scope,'shared');
    response = await f.request('PUT','/api/admin/drive/connection',body);
    const kept = (await response.json()).connection;
    assert.equal(kept.folder_scope,'shared');
    assert.equal(kept.generation,shared.generation+1);
    await f.db.run("UPDATE drive_connections SET status='active'");
    const browse = {folder_id:'outside',request_key:'browse-test-key'};
    assert.equal((await f.request('POST','/api/admin/drive/browse',browse,{authenticated:false})).status,401);
    assert.equal((await f.request('POST','/api/admin/drive/browse',browse,{origin:'https://attacker.example'})).status,403);
    for (const page_token of ['',{},'x'.repeat(2049),'bad token']) assert.equal((await f.request('POST','/api/admin/drive/browse',{...browse,page_token})).status,422);
    assert.equal((await f.request('POST','/api/admin/drive/browse',{...browse,folder_id:'https://attacker.example'})).status,422);
    response = await f.request('POST','/api/admin/drive/browse',{...browse,page_token:'next-page'});
    assert.equal(response.status,202);
    const job = await f.db.get('SELECT * FROM drive_sync_jobs WHERE id=?',[(await response.json()).job_id]);
    assert.equal(job.kind,'check');
    assert.equal(job.connection_generation,kept.generation);
    assert.deepEqual(JSON.parse(job.payload_json),{operation:'browse-folders',folderId:'outside',pageToken:'next-page'});
    await f.db.run('UPDATE rate_limits SET count=120,expires=? WHERE key=?',[Date.now()+60000,'drive-admin:owner']);
    assert.equal((await f.request('POST','/api/admin/drive/browse',browse)).status,429);
  } finally { await f.close(); }
});
