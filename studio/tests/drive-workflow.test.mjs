import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {driveFixture} from './drive-test-fixture.mjs';
import {createDriveJobs} from '../server/drive-jobs.mjs';
import {driveAlbumSummaries,driveJobDetails,retryDriveJob} from '../server/drive-workflow.mjs';
import {registerDriveRoutes} from '../server/drive-routes.mjs';

async function retryFixture({approval=false}={}) {
  const fixture = await driveFixture();
  const {db} = fixture;
  await db.run("INSERT INTO photos(id,album_id,filename,original,width,height,source) VALUES('published','album','storage-secret.webp','Original.jpg',20,30,'google_drive')");
  await db.run("INSERT INTO drive_source_files(id,connection_id,drive_file_id,mapping_id,photo_id) VALUES('source-done','connection','done','mapping','published')");
  await db.run("INSERT INTO drive_source_files(id,connection_id,drive_file_id,mapping_id) VALUES('source-failed','connection','failed','mapping')");
  const album = await db.get("SELECT * FROM albums WHERE id='album'");
  const manifest = {complete:true,count:2,hash:'exact-approved-manifest',catalogRevision:album.catalog_revision,selectionRevision:album.selection_revision,submissionGeneration:album.submission_generation};
  const jobs = createDriveJobs(db);
  let preview;
  if (approval) {
    preview = await jobs.enqueue({mappingId:'mapping',kind:'preview',requestKey:'preview-request'});
    await jobs.finish(await jobs.claim('worker'),{status:'awaiting_review',manifest});
    await db.run(`INSERT INTO drive_sync_approvals(id,preview_id,album_id,mapping_id,connection_generation,mapping_generation,catalog_revision,selection_revision,submission_generation,manifest_json)
      VALUES('approval',?,'album','mapping',1,1,?,?,?,?)`,[preview.id,album.catalog_revision,album.selection_revision,album.submission_generation,JSON.stringify(manifest)]);
  }
  const job = await jobs.enqueue({mappingId:'mapping',kind:'apply',requestKey:'apply-request',previewId:preview?.id,approvalId:approval ? 'approval' : undefined});
  const lease = await jobs.claim('worker');
  await jobs.putItems(lease,[{fileId:'done',action:'add',status:'applied',sourceGeneration:1,source:{sourceId:'source-done'},result:{photoId:'published'}},
    {fileId:'failed',action:'add',status:'failed',sourceGeneration:1,source:{sourceId:'source-failed',file:{id:'failed',name:'Failed.jpg',version:'1'}},errorCode:'drive_temporary_failure',ingestOperationId:'kept-ingest-operation'}]);
  await jobs.finish(lease,{status:'completed_with_errors',manifest,progress:{total:2,applied:1,failed:1}});
  return {...fixture,jobs,job,lease,manifest};
}

test('Drive album summaries use one query and prefer active work while excluding unlinked mappings',async () => {
  const fixture = await driveFixture();
  try {
    const jobs = createDriveJobs(fixture.db);
    const active = await jobs.enqueue({mappingId:'mapping',kind:'apply',requestKey:'active'});
    const newer = await jobs.enqueue({mappingId:'mapping',kind:'preview',requestKey:'newer'});
    await fixture.db.run("UPDATE drive_sync_jobs SET status='completed',created_at=9999999999999 WHERE id=?",[newer.id]);
    await fixture.db.run("UPDATE drive_sync_jobs SET progress_json=? WHERE id=?",[JSON.stringify({total:5000,applied:320}),active.id]);
    await fixture.db.run("UPDATE drive_album_links SET last_success_at=1234 WHERE id='mapping'");
    for (let index=0;index<100;index++) {
      await fixture.db.run('INSERT INTO albums(id,title,category) VALUES(?,?,?)',['album-'+index,'Album','wedding']);
      await fixture.db.run('INSERT INTO drive_album_links(id,connection_id,album_id,folder_id,state) VALUES(?,?,?,?,?)',['map-'+index,'connection','album-'+index,'folder-'+index,index === 0 ? 'unlinked' : 'attached']);
    }
    const queries = [];
    const summaries = await driveAlbumSummaries({all:(sql,args) => { queries.push(sql); return fixture.db.all(sql,args); }});
    assert.equal(queries.length,1);
    assert.doesNotMatch(queries[0],/\bphotos\b/);
    assert.equal(summaries.length,100);
    const first = summaries.find(row => row.album_id === 'album');
    assert.equal(first.job.id,active.id);
    assert.equal(first.job.progress.total,5000);
    assert.equal(Number(first.last_success_at),1234);
    assert.equal(summaries.find(row => row.album_id === 'album-1').job,null);
    assert.equal(JSON.stringify(first).includes('payload'),false);
    await fixture.db.run("UPDATE drive_sync_jobs SET status='awaiting_review' WHERE id=?",[active.id]);
    const comparison=await jobs.enqueue({mappingId:'mapping',kind:'check',requestKey:'comparison-status',payload:{operation:'compare-preview'}});
    await fixture.db.run('UPDATE drive_sync_jobs SET created_at=99999999999999 WHERE id=?',[comparison.id]);
    assert.notEqual((await driveAlbumSummaries(fixture.db)).find(row=>row.album_id==='album').job.id,comparison.id,'Private comparison work must not hide the album sync or review state');
  } finally { await fixture.close(); }
});

test('Drive job filters provide whole-job counts, bounded pages and current media without storage paths',async () => {
  const fixture = await retryFixture();
  try {
    const detail = await driveJobDetails(fixture.db,await fixture.jobs.get(fixture.job.id),{status:'failed',limit:1});
    assert.equal(detail.total,1);
    assert.equal(detail.items[0].file_id,'failed');
    assert.equal(detail.counts.actions.add,2);
    assert.equal(detail.counts.statuses.applied,1);
    assert.equal(detail.counts.statuses.failed,1);
    assert.equal(detail.items[0].current_photo,null);
    const applied = await driveJobDetails(fixture.db,await fixture.jobs.get(fixture.job.id),{status:'applied'});
    assert.equal(applied.items[0].current_photo.original,'Original.jpg');
    assert.match(applied.items[0].current_photo.thumb,/^\/media\/published\?size=thumb&v=[a-f0-9]{16}$/);
    assert.equal(JSON.stringify(applied).includes('storage-secret'),false);
    assert.equal((await driveJobDetails(fixture.db,fixture.job,{action:'replace'})).total,0);
    assert.equal((await driveJobDetails(fixture.db,fixture.job,{offset:20})).items.length,0);
    await assert.rejects(driveJobDetails(fixture.db,fixture.job,{action:'anything'}),{code:'drive_invalid_action_filter',status:422});
    await assert.rejects(driveJobDetails(fixture.db,fixture.job,{status:['failed']}),{code:'drive_invalid_status_filter',status:422});
  } finally { await fixture.close(); }
});

test('Explicit retry requeues only failed items, keeps receipts/attempt budget and is durably idempotent',async () => {
  const fixture = await retryFixture({approval:true});
  try {
    const before = await fixture.jobs.items(fixture.job.id);
    const result = await retryDriveJob(fixture.db,fixture.job.id,'retry-request');
    assert.equal(result.id,fixture.job.id);
    assert.equal(result.status,'queued');
    assert.equal(result.attempt,1);
    assert.equal(result.fence,fixture.lease.fence+1);
    assert.equal(result.finished_at,null);
    const after = await fixture.jobs.items(fixture.job.id);
    assert.deepEqual(after.find(item => item.file_id === 'done'),before.find(item => item.file_id === 'done'));
    assert.equal(after.find(item => item.file_id === 'failed').status,'pending');
    assert.equal(after.find(item => item.file_id === 'failed').ingest_operation_id,'kept-ingest-operation');
    assert.equal((await retryDriveJob(fixture.db,fixture.job.id,'retry-request')).fence,result.fence);
    await assert.rejects(retryDriveJob(fixture.db,fixture.job.id,'different-retry'),{code:'drive_retry_unavailable'});
    const lease = await fixture.jobs.claim('restarted-worker');
    assert.equal(lease.attempt,2);
    await assert.rejects(fixture.db.transaction(tx => fixture.jobs.assertLease(tx,fixture.lease)),{code:'DRIVE_LEASE_LOST'});
    await fixture.jobs.cancel(fixture.job.id);
    assert.equal((await retryDriveJob(fixture.db,fixture.job.id,'retry-request')).status,'canceled','A replay must not revive canceled work');
    await assert.rejects(retryDriveJob(fixture.db,fixture.job.id,'new-after-cancel'),{code:'drive_retry_unavailable'});
  } finally { await fixture.close(); }
});

test('Retry rejects catalog, selection, submission, mapping, connection, source and approval drift atomically',async () => {
  const mutations = [
    "UPDATE albums SET title='Changed' WHERE id='album'",
    "UPDATE albums SET selection_revision=selection_revision+1 WHERE id='album'",
    "UPDATE albums SET submission_generation=submission_generation+1 WHERE id='album'",
    "UPDATE drive_album_links SET generation=generation+1 WHERE id='mapping'",
    "UPDATE drive_connections SET generation=generation+1 WHERE id='connection'",
    "UPDATE drive_source_files SET source_generation=source_generation+1 WHERE id='source-failed'",
    "UPDATE drive_source_files SET state='suppressed' WHERE id='source-failed'",
    "UPDATE drive_sync_approvals SET invalidated_at=1 WHERE id='approval'",
  ];
  for (const mutation of mutations) {
    const fixture = await retryFixture({approval:true});
    try {
      await fixture.db.run(mutation);
      await assert.rejects(retryDriveJob(fixture.db,fixture.job.id,'stale-retry'),{code:'drive_preview_stale'},mutation);
      assert.equal((await fixture.jobs.get(fixture.job.id)).status,'completed_with_errors');
      assert.equal((await fixture.jobs.items(fixture.job.id)).find(item => item.file_id === 'failed').status,'failed');
      assert.equal(await fixture.db.get("SELECT request_key FROM drive_job_requests WHERE request_key='stale-retry'"),undefined);
    } finally { await fixture.close(); }
  }
});

test('Retry refuses exhausted attempts, conflicting keys, active work and interrupted pending inventory',async () => {
  const cases = [
    ["UPDATE drive_sync_jobs SET attempt=5",'drive_retry_exhausted'],
    ["UPDATE drive_sync_job_items SET status='pending' WHERE file_id='done'",'drive_preview_stale'],
    ["UPDATE drive_sync_jobs SET status='canceled',cancel_requested=1",'drive_retry_unavailable'],
    ["UPDATE drive_sync_job_items SET action='conflict' WHERE file_id='failed'",'drive_retry_unavailable'],
  ];
  for (const [mutation,code] of cases) {
    const fixture = await retryFixture();
    try { await fixture.db.run(mutation); await assert.rejects(retryDriveJob(fixture.db,fixture.job.id,'retry-request'),{code}); }
    finally { await fixture.close(); }
  }
  const fixture = await retryFixture();
  try {
    await assert.rejects(retryDriveJob(fixture.db,fixture.job.id,'apply-request'),{code:'drive_request_conflict'});
    await fixture.jobs.enqueue({mappingId:'mapping',kind:'preview',requestKey:'active-preview'});
    await assert.rejects(retryDriveJob(fixture.db,fixture.job.id,'retry-request'),{code:'drive_job_active'});
  } finally { await fixture.close(); }
});

test('Drive workflow HTTP routes keep no-store, reject bad filters and enqueue a checked folder only when available',async () => {
  const fixture = await retryFixture();
  let server;
  try {
    await fixture.db.run("UPDATE drive_connections SET status='disabled' WHERE id='connection'");
    await fixture.db.run("INSERT INTO drive_connections(id,service_account_email,root_folder_id,status) VALUES('studio','test@test.iam.gserviceaccount.com','rootfolder','active')");
    const app = express();
    app.use(express.json());
    app.use((request,response,next) => { request.admin='test-admin'; next(); });
    registerDriveRoutes(app,{db:fixture.db,env:{DRIVE_SYNC_ENABLED:'true'}});
    app.use((error,request,response,next) => response.status(error.status || 500).json({error:error.code}));
    server = await new Promise(resolve => { const instance=app.listen(0,'127.0.0.1',() => resolve(instance)); });
    const url = 'http://127.0.0.1:'+server.address().port+'/api/admin/drive';
    const call = (path,body) => fetch(url+path,{method:body ? 'POST' : 'GET',headers:{'Content-Type':'application/json'},body:body ? JSON.stringify(body) : undefined});
    const summaries = await call('/albums');
    assert.equal(summaries.headers.get('cache-control'),'private,no-store');
    assert.equal((await summaries.json()).albums.length,1);
    assert.equal((await call('/jobs/'+fixture.job.id+'?action=invalid')).status,422);
    const details = await (await call('/jobs/'+fixture.job.id+'?status=failed')).json();
    assert.equal(details.total,1);
    assert.equal(details.items.length,1);
    const check = await call('/folder-check',{folder_id:'availablefolder',request_key:'check-folder-request'});
    assert.equal(check.status,202);
    const checkJob = await check.json();
    const persisted = await fixture.jobs.get(checkJob.job_id);
    assert.deepEqual(persisted.payload,{operation:'inspect-folder',folderId:'availablefolder'});
    assert.equal(persisted.mapping_id,null);
    const again = await (await call('/folder-check',{folder_id:'availablefolder',request_key:'check-folder-request'})).json();
    assert.equal(again.job_id,checkJob.job_id);
    await fixture.db.run("INSERT INTO albums(id,title,category) VALUES('occupied','Occupied','wedding')");
    await fixture.db.run("INSERT INTO drive_album_links(id,connection_id,album_id,folder_id) VALUES('occupied-map','studio','occupied','occupiedfolder')");
    const occupied = await call('/folder-check',{folder_id:'occupiedfolder',request_key:'occupied-request'});
    assert.equal(occupied.status,409);
    assert.equal((await occupied.json()).error,'drive_folder_already_linked');
    await fixture.db.run("UPDATE drive_connections SET status='disabled' WHERE id='studio'");
    await fixture.db.run("UPDATE drive_connections SET status='active' WHERE id='connection'");
    const retried = await call('/jobs/'+fixture.job.id+'/retry',{request_key:'retry-through-http'});
    assert.equal(retried.status,202);
    assert.equal((await retried.json()).job_id,fixture.job.id);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await fixture.close();
  }
});

test('Folder polling preserves the job contract with one database query instead of three',async () => {
  const fixture = await driveFixture();
  let server;
  try {
    const jobs = createDriveJobs(fixture.db);
    const queries = [];
    const measured = new Proxy(fixture.db,{get(target,key) {
      const value = target[key];
      return ['get','all','run'].includes(key)
        ? (sql,args) => { queries.push(sql); return value.call(target,sql,args); }
        : typeof value === 'function' ? value.bind(target) : value;
    }});
    const app = express();
    registerDriveRoutes(app,{db:measured,env:{DRIVE_SYNC_ENABLED:'true'}});
    app.use((error,request,response,next) => response.status(error.status || 500).json({error:error.code}));
    server = await new Promise(resolve => { const instance=app.listen(0,'127.0.0.1',() => resolve(instance)); });
    const url = 'http://127.0.0.1:'+server.address().port+'/api/admin/drive/jobs/';
    for (const operation of ['browse-folders','inspect-folder']) {
      const job = await jobs.enqueue({connectionId:'connection',kind:'check',requestKey:operation,payload:{operation,folderId:'folder'}});
      const expected = await driveJobDetails(measured,job,{offset:10,limit:20});
      assert.equal(queries.length,2,'The original detail path performs two extra item queries');
      for (const status of ['queued','running','completed','failed','canceled']) {
        await fixture.db.run('UPDATE drive_sync_jobs SET status=?,progress_json=? WHERE id=?',[status,JSON.stringify({ready:true,folder:{id:'folder',name:'Folder'},summary:{images:33}}),job.id]);
        queries.length=0;
        const response = await fetch(url+job.id+'?offset=10&limit=20');
        assert.equal(response.status,200);
        assert.equal(response.headers.get('cache-control'),'private,no-store');
        const {job:actual,...details} = await response.json();
        assert.deepEqual(details,expected);
        assert.equal(actual.status,status);
        assert.equal(actual.progress.summary.images,33);
        assert.equal(actual.payload_json,undefined);
        assert.equal(queries.length,1);
        assert.doesNotMatch(queries[0],/drive_sync_job_items|drive_source_files|photos/);
      }
      for (const filter of ['action=invalid','status=invalid','status=failed&status=applied']) {
        assert.equal((await fetch(url+job.id+'?'+filter)).status,422);
      }
      queries.length=0;
    }
    const apply = await jobs.enqueue({mappingId:'mapping',kind:'apply',requestKey:'poll-apply'});
    await jobs.putItems(await jobs.claim('fixture-worker'),[{fileId:'image',action:'add',status:'pending',sourceGeneration:1,source:{}}]);
    queries.length=0;
    const applyResponse = await (await fetch(url+apply.id)).json();
    assert.equal(applyResponse.items.length,1);
    assert.equal(applyResponse.total,1);
    assert.equal(queries.length,3,'Import details retain the complete inventory path');
    const missing = await fetch(url+'missing');
    assert.equal(missing.status,404);
    assert.equal((await missing.json()).error,'drive_job_missing');
  } finally {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    await fixture.close();
  }
});
