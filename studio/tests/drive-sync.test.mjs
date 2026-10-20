import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import pg from 'pg';
import sharp from 'sharp';
import express from 'express';
import {openDatabase} from '../server/db.mjs';
import {createMediaControl,trackedStorage} from '../server/media-control.mjs';
import {createDriveJobs} from '../server/drive-jobs.mjs';
import {createDriveWorker} from '../server/drive-worker.mjs';
import {registerDriveRoutes} from '../server/drive-routes.mjs';
import {DRIVE_FOLDER} from '../server/drive-client.mjs';

const env = {DRIVE_SYNC_ENABLED:'true',DRIVE_SYNC_BATCH_SIZE:'2'};
async function fixture(postgres,{wait,now}={}) {
  const directory = await mkdtemp(path.join(os.tmpdir(),'drive-runtime-'));
  let pool;
  let schema;
  let url = null;
  if (postgres) {
    pool = new pg.Pool({connectionString:process.env.STUDIO_TEST_POSTGRES_URL});
    schema = 'drive_runtime_'+randomUUID().replaceAll('-','');
    await pool.query('CREATE SCHEMA '+schema);
    const parsed = new URL(process.env.STUDIO_TEST_POSTGRES_URL);
    parsed.searchParams.set('options','-c search_path='+schema);
    url = parsed.href;
  }
  const db = await openDatabase(directory,{url});
  const control = await createMediaControl(db,'drive-test');
  const objects = new Map();
  const hooks = {};
  const raw = {
    identity:'drive-test',
    async put(key,value) {
      objects.set(key,Buffer.from(value));
      await hooks.put?.(key);
    },
    async remove(key) { objects.delete(key); },
  };
  const storage = trackedStorage(db,raw,control);
  const files = new Map([
    ['rootfolder',{id:'rootfolder',name:'root',mimeType:DRIVE_FOLDER,parents:[],version:'1'}],
    ['albumfolder',{id:'albumfolder',name:'album',mimeType:DRIVE_FOLDER,parents:['rootfolder'],version:'1'}],
  ]);
  const bytes = new Map();
  const blue = await sharp({create:{width:48,height:32,channels:3,background:'#2266aa'}}).jpeg().toBuffer();
  const red = await sharp({create:{width:48,height:32,channels:3,background:'#dd2233'}}).jpeg().toBuffer();
  let downloads = 0;
  const drive = {
    serviceAccountEmail:'sync@test.iam.gserviceaccount.com',
    async getFile(fileId) {
      const value = files.get(fileId);
      if (!value) throw Object.assign(Error('missing'),{code:'drive_source_unavailable'});
      return hooks.get ? hooks.get(structuredClone(value)) : structuredClone(value);
    },
    async listFiles(folder,{pageToken,name}={}) {
      if (hooks.list) return hooks.list(folder,pageToken);
      if (!pageToken) return {files:[],nextPageToken:'0'};
      const rows = [...files.values()].filter(file => file.parents.includes(folder) && !file.trashed && (name === undefined || file.name === name));
      const offset = Number(pageToken);
      return {files:structuredClone(rows.slice(offset,offset+1000)),nextPageToken:rows.length>offset+1000 ? String(offset+1000) : undefined};
    },
    async download(fileId,destination,{maxBytes,checksum,signal}) {
      signal?.throwIfAborted();
      const body = bytes.get(fileId);
      assert.ok(body.length <= maxBytes);
      assert.equal(createHash('md5').update(body).digest('hex'),checksum);
      downloads++;
      await writeFile(destination,body,{flag:'wx',mode:0o600});
      await hooks.download?.(fileId);
      return {bytes:body.length,checksum};
    },
  };
  const add = (fileId,name,version='1',body=blue,parent='albumfolder') => {
    bytes.set(fileId,body);
    files.set(fileId,{id:fileId,name,mimeType:'image/jpeg',parents:[parent],version:String(version),size:String(body.length),md5Checksum:createHash('md5').update(body).digest('hex'),modifiedTime:'2026-10-16T00:00:00Z',capabilities:{canDownload:true}});
  };
  await db.run("INSERT INTO albums(id,title,category,status) VALUES('album','Album','wedding','private')");
  await db.run("INSERT INTO drive_connections(id,service_account_email,root_folder_id,status) VALUES('studio',?,'rootfolder','active')",[drive.serviceAccountEmail]);
  const jobs = createDriveJobs(db);
  const logs = [];
  const newWorker = () => createDriveWorker({db,storage,control,drive,jobs,env:{...env,DRIVE_SYNC_TEMP_DIR:path.join(directory,'temp')},logger:entry => logs.push(entry),wait,now});
  let worker = newWorker();
  const app = express();
  app.use(express.json());
  app.use((request,response,next) => { request.admin = 'tester'; next(); });
  registerDriveRoutes(app,{db,control,env});
  app.use((error,request,response,next) => response.status(error.status || 500).json({error:error.code || error.message}));
  const server = await new Promise(resolve => {
    const listening = app.listen(0,'127.0.0.1',() => resolve(listening));
  });
  async function api(method,route,body) {
    const response = await fetch('http://127.0.0.1:'+server.address().port+'/api/admin'+route,{method,headers:{'Content-Type':'application/json'},body:body === undefined ? undefined : JSON.stringify(body)});
    const data = await response.json();
    assert.ok(response.ok,JSON.stringify({route,status:response.status,data}));
    return data;
  }
  async function drain(jobId) {
    for (let attempt=0; attempt<100; attempt++) {
      const job = await jobs.get(jobId);
      if (!['queued','running','retry_wait'].includes(job.status)) return job;
      if (job.status === 'retry_wait') return job;
      await new Promise(resolve => setTimeout(resolve,2));
      await worker.runOnce();
    }
    throw Error('job did not finish '+JSON.stringify(logs));
  }
  async function queue(kind,body={}) {
    const response = await api('POST','/albums/album/drive/'+kind,body);
    return drain(response.job_id);
  }
  const linked = await api('PUT','/albums/album/drive',{folder_id:'albumfolder'});
  assert.equal((await drain(linked.job_id)).status,'completed');
  const mapping = await db.get("SELECT * FROM drive_album_links WHERE album_id='album'");
  return {db,control,files,bytes,objects,hooks,add,red,blue,jobs,get worker() { return worker; },restartWorker() { worker.stop(); worker = newWorker(); },mapping,api,drain,queue,logs,downloads:() => downloads,close:async () => {
    worker.stop();
    await new Promise(resolve => server.close(resolve));
    await control.close();
    await db.close();
    if (pool) {
      await pool.query('DROP SCHEMA '+schema+' CASCADE');
      await pool.end();
    }
    await rm(directory,{recursive:true,force:true});
  }};
}

for (const postgres of [false,true]) {
  const options = {skip:postgres && !process.env.STUDIO_TEST_POSTGRES_URL};
  const label = postgres ? 'PostgreSQL' : 'SQLite';
  test(label+': shared scope browses outside folders without importing and preserves old mapping preview',options,async () => {
    const f = await fixture(postgres);
    try {
      f.files.set('outside',{id:'outside',name:'Outside',mimeType:DRIVE_FOLDER,parents:[]});
      f.files.set('nested',{id:'nested',name:'Nested',mimeType:DRIVE_FOLDER,parents:['outside']});
      f.hooks.list = (folder,pageToken) => folder === 'rootfolder' ? {files:[]} : pageToken ? {files:[]} : {files:[f.files.get('nested')],nextPageToken:'page2'};
      let response = await f.api('POST','/drive/browse',{folder_id:'outside'});
      let job = await f.drain(response.job_id);
      assert.equal(job.error_code,'drive_folder_outside_root');
      assert.equal((await f.db.get("SELECT last_error_code FROM drive_connections WHERE id='studio'")).last_error_code,null);
      await f.api('PUT','/drive/connection',{service_account_email:'sync@test.iam.gserviceaccount.com',root_folder_id:'rootfolder',folder_scope:'shared'});
      response = await f.api('POST','/drive/check',{});
      assert.equal((await f.drain(response.job_id)).status,'completed');
      response = await f.api('POST','/drive/browse',{folder_id:'outside'});
      job = await f.drain(response.job_id);
      assert.equal(job.status,'completed');
      assert.deepEqual(JSON.parse(job.progress_json),{folder:{id:'outside',name:'Outside'},folders:[{id:'nested',name:'Nested'}],nextPageToken:'page2',scope:'shared',ready:true,summary:{status:'unavailable',images:null,folders:null,otherFiles:null,complete:false,scanned:0,updatedAt:null},preview:{images:[],unavailable:true}});
      response = await f.api('POST','/drive/browse',{folder_id:'outside',page_token:'page2'});
      job = await f.drain(response.job_id);
      assert.deepEqual(JSON.parse(job.progress_json).folders,[]);
      assert.equal(JSON.parse(job.progress_json).nextPageToken,null);
      assert.equal(f.downloads(),0);
      assert.equal((await f.db.all('SELECT * FROM albums')).length,1);
      assert.equal((await f.db.all('SELECT * FROM drive_album_links')).length,1);
      assert.equal((await f.db.all('SELECT * FROM photos')).length,0);
      f.hooks.list = undefined;
      f.add('oldphoto','Existing.jpg');
      assert.equal((await f.queue('preview')).status,'awaiting_review');
      assert.equal(f.downloads(),0);
    } finally { await f.close(); }
  });
  test(label+': browse rejects incomplete pages, nonfolders, repeated tokens and generation races',options,async () => {
    const f = await fixture(postgres);
    try {
      for (const page of [{files:[],incompleteSearch:true},{files:[{id:'image',name:'File',mimeType:'image/jpeg'}]},{files:[],nextPageToken:'page2'},{files:[],nextPageToken:123},{files:Array(101).fill({id:'nested',name:'Nested',mimeType:DRIVE_FOLDER})}]) {
        f.hooks.list = () => page;
        const response = await f.api('POST','/drive/browse',{folder_id:'rootfolder',page_token:'page2'});
        assert.equal((await f.drain(response.job_id)).status,'failed');
      }
      f.hooks.list = async () => {
        await f.db.run('UPDATE drive_connections SET generation=generation+1');
        return {files:[]};
      };
      const response = await f.api('POST','/drive/browse',{folder_id:'rootfolder'});
      const job = await f.drain(response.job_id);
      assert.equal(job.error_code,'drive_connection_stale');
      assert.deepEqual(JSON.parse(job.progress_json),{});
      assert.equal(f.downloads(),0);
    } finally { await f.close(); }
  });
  test(label+': running worker resumes a yielded batch immediately and retains idle polling',options,async()=>{
    const delays=[];
    const state=await fixture(postgres,{wait:async delay=>{
      delays.push(delay);
      if(delays.length===1)await new Promise(resolve=>setTimeout(resolve,2));
      else if(delays.length===3)state.worker.stop();
    }});
    try{
      for(let index=1;index<=3;index++)state.add('loopfile'+index,'Loop '+index+'.jpg');
      const preview=await state.queue('preview');
      const approved=await state.api('POST','/albums/album/drive/approve',{preview_id:preview.id,request_key:'worker-loop-review'});
      await state.worker.start();
      assert.equal((await state.jobs.get(approved.job_id)).status,'completed');
      assert.equal(state.downloads(),3);
      assert.equal(delays.length,3);
      assert.ok(delays[0]>=1&&delays[0]<=10,JSON.stringify(delays));
      assert.equal(delays[1],1);
      assert.equal(delays[2],5000);
    }finally{await state.close();}
  });
  test(label+': consecutive folder browse jobs drain without idle delays and then resume idle polling',options,async()=>{
    const delays=[];
    const state=await fixture(postgres,{wait:async delay=>{
      delays.push(delay);
      if(delays.length===3)state.worker.stop();
    }});
    try {
      state.hooks.list=async()=>({files:[]});
      const first=await state.api('POST','/drive/browse',{folder_id:'rootfolder'});
      const second=await state.api('POST','/drive/browse',{folder_id:'albumfolder'});
      await state.worker.start();
      assert.equal((await state.jobs.get(first.job_id)).status,'completed');
      assert.equal((await state.jobs.get(second.job_id)).status,'completed');
      assert.ok(delays[0]<=10&&delays[1]<=10,JSON.stringify(delays));
      assert.equal(delays[2],5000);
      assert.equal(state.downloads(),0);
    } finally {await state.close();}
  });
  test(label+': idle worker throttles heartbeat and cache cleanup while checking maintenance every tick',options,async()=>{
    let clock=Date.now();
    const f=await fixture(postgres,{now:()=>clock});
    const originalRun=f.db.run,originalStatus=f.control.status;
    const writes=[];let maintenanceChecks=0;
    try {
      f.db.run=async(sql,...args)=>{
        if(sql.startsWith('INSERT INTO drive_worker_heartbeats') || /^DELETE FROM drive_(comparison|folder_preview)_cache WHERE expires_at/.test(sql)) writes.push({sql,params:args[0]});
        return originalRun.call(f.db,sql,...args);
      };
      f.control.status=async()=>{maintenanceChecks++;return originalStatus();};
      f.restartWorker();
      for(let tick=0;tick<30;tick++) {
        assert.equal(await f.worker.runOnce(),null);
        clock+=1000;
      }
      assert.equal(maintenanceChecks,30);
      assert.equal(writes.filter(write=>write.sql.startsWith('INSERT')).length,3);
      assert.equal(writes.filter(write=>write.sql.startsWith('DELETE')).length,2);
      // Cleanup remains due at sixty seconds even when heartbeat has its own cadence.
      clock+=30000;
      await f.worker.runOnce();
      assert.equal(writes.filter(write=>write.sql.startsWith('DELETE')).length,4);
      assert.equal(writes.filter(write=>write.sql.startsWith('INSERT')).length,4);
      // A job cannot slip through a backup fence on a throttled tick.
      const queued=await f.api('POST','/drive/browse',{folder_id:'rootfolder'});
      const lease=await f.control.acquire('worker-performance-test');
      try {
        await f.worker.runOnce();
        await f.worker.runOnce();
        assert.equal((await f.jobs.get(queued.job_id)).status,'queued');
        assert.equal(maintenanceChecks,33);
      } finally {await f.control.release(lease);}
    } finally {
      f.db.run=originalRun;f.control.status=originalStatus;
      await f.close();
    }
  });
  test(label+': worker publishes running, idle and stopped heartbeat transitions without throttle delay',options,async()=>{
    const clock=Date.now();
    const f=await fixture(postgres,{now:()=>clock});
    const originalRun=f.db.run;
    const states=[];
    try {
      f.db.run=async(sql,...args)=>{
        if(sql.startsWith('INSERT INTO drive_worker_heartbeats')) states.push(args[0][4]);
        return originalRun.call(f.db,sql,...args);
      };
      f.restartWorker();
      await f.worker.runOnce();
      assert.deepEqual(states,['idle']);
      f.hooks.list=async()=>{
        assert.equal((await f.db.get('SELECT state FROM drive_worker_heartbeats WHERE id=?',[f.worker.owner])).state,'running');
        return {files:[]};
      };
      let queued=await f.api('POST','/drive/browse',{folder_id:'rootfolder'});
      assert.equal((await f.worker.runOnce()).id,queued.job_id);
      assert.deepEqual(states,['idle','running','idle']);
      f.hooks.list=async()=>{f.worker.stop();return {files:[]};};
      queued=await f.api('POST','/drive/browse',{folder_id:'rootfolder'});
      await f.worker.runOnce();
      assert.deepEqual(states,['idle','running','idle','running','stopped']);
      assert.equal((await f.db.get('SELECT state FROM drive_worker_heartbeats WHERE id=?',[f.worker.owner])).state,'stopped');
    } finally {f.db.run=originalRun;await f.close();}
  });
  test(label+': failed cache cleanup retries next tick and only successful cleanup starts its interval',options,async()=>{
    const f=await fixture(postgres,{now:()=>100000});
    const originalRun=f.db.run;
    let comparisons=0,previews=0;
    try {
      f.restartWorker();
      f.db.run=async(sql,...args)=>{
        if(sql.startsWith('DELETE FROM drive_comparison_cache WHERE expires_at')) comparisons++;
        if(sql.startsWith('DELETE FROM drive_folder_preview_cache WHERE expires_at')) {
          previews++;
          if(previews===1) throw new Error('temporary cleanup failure');
        }
        return originalRun.call(f.db,sql,...args);
      };
      await assert.rejects(f.worker.runOnce(),/temporary cleanup failure/);
      assert.deepEqual([comparisons,previews],[1,1]);
      assert.equal(await f.worker.runOnce(),null);
      assert.deepEqual([comparisons,previews],[2,2]);
      assert.equal(await f.worker.runOnce(),null);
      assert.deepEqual([comparisons,previews],[2,2]);
    } finally {f.db.run=originalRun;await f.close();}
  });
  for(const kind of ['apply','preview']) test(label+': '+kind+' releases the worker for queued browsing before idle backoff',options,async()=>{
    const delays=[],firstStatuses=[];
    let firstId,browseId;
    const f=await fixture(postgres,{wait:async delay=>{
      delays.push(delay);
      if(delays.length===1) {
        firstStatuses.push((await f.jobs.get(firstId)).status,(await f.jobs.get(browseId)).status);
      }
      if(delays.length===3) f.worker.stop();
    }});
    try {
      f.add('queuedphoto','Queued.jpg');
      if(kind==='apply') {
        const preview=await f.queue('preview');
        firstId=(await f.api('POST','/albums/album/drive/approve',{preview_id:preview.id})).job_id;
      } else firstId=(await f.api('POST','/albums/album/drive/preview',{})).job_id;
      browseId=(await f.api('POST','/drive/browse',{folder_id:'rootfolder'})).job_id;
      // Explicit eligibility order makes this independent of millisecond ties.
      await f.db.run('UPDATE drive_sync_jobs SET available_at=? WHERE id=?',[Date.now()-100,firstId]);
      await f.db.run('UPDATE drive_sync_jobs SET available_at=? WHERE id=?',[Date.now()-50,browseId]);
      await f.worker.start();
      assert.deepEqual(delays,[1,1,5000]);
      assert.deepEqual(firstStatuses,[kind==='apply'?'completed':'awaiting_review','queued']);
      assert.equal((await f.jobs.get(browseId)).status,'completed');
      assert.equal(f.downloads(),kind==='apply'?1:0);
    } finally {await f.close();}
  });
  test(label+': preview, paginated import, stable identity, rename, replace, manual collision and missing',options,async () => {
    const fixtureState = await fixture(postgres);
    const {db,add,queue,files,downloads,api,drain} = fixtureState;
    try {
      await db.run("INSERT INTO photos(id,album_id,filename,original,caption,width,height,source) VALUES('manual','album','manual','IMG_2.jpg','manual caption',48,32,'manual')");
      for (const number of [10,2,1]) add('drivefile'+number,'IMG_'+number+'.jpg');
      add('duplicate','IMG_2.jpg');
      const preview = await queue('preview');
      assert.equal(preview.status,'awaiting_review');
      assert.equal(downloads(),0);
      const approval = await api('POST','/albums/album/drive/approve',{preview_id:preview.id});
      const applied = await drain(approval.job_id);
      assert.equal(applied.status,'completed',JSON.stringify(applied));
      assert.equal(downloads(),4);
      assert.equal((await db.all('SELECT * FROM photos')).length,5);
      const source = await db.get("SELECT * FROM drive_source_files WHERE drive_file_id='drivefile2'");
      const first = await db.get('SELECT * FROM photos WHERE id=?',[source.photo_id]);
      await db.run('UPDATE photos SET caption=? WHERE id=?',['editor caption',first.id]);
      await db.run("INSERT INTO selections(album_id,photo_id,updated) VALUES('album',?,'now')",[first.id]);
      files.set('drivefile2',{...files.get('drivefile2'),name:'renamed.jpg',version:'2'});
      assert.equal((await queue('sync')).status,'completed');
      assert.equal(downloads(),4);
      const renamed = await db.get('SELECT * FROM photos WHERE id=?',[first.id]);
      assert.equal(renamed.caption,'editor caption');
      assert.equal(renamed.original,'renamed.jpg');
      add('drivefile2','renamed.jpg','3',fixtureState.red);
      assert.equal((await queue('sync')).status,'completed');
      const replaced = await db.get('SELECT * FROM photos WHERE id=?',[first.id]);
      assert.notEqual(replaced.filename,first.filename);
      assert.equal(replaced.caption,'editor caption');
      assert.ok(await db.get('SELECT * FROM selections WHERE photo_id=?',[first.id]));
      assert.equal((await db.get("SELECT * FROM photos WHERE id='manual'")).caption,'manual caption');
      const retired = await db.get('SELECT * FROM photo_cleanup WHERE filename=?',[first.filename]);
      assert.equal(retired.kind,'retired');
      assert.equal(retired.not_before,null);
      files.delete('drivefile2');
      assert.equal((await queue('sync')).status,'completed');
      assert.equal((await db.get('SELECT * FROM drive_source_files WHERE id=?',[source.id])).state,'missing_in_drive');
      assert.ok(await db.get('SELECT * FROM photos WHERE id=?',[first.id]));
      assert.ok(await db.get('SELECT * FROM selections WHERE photo_id=?',[first.id]));
    } finally { await fixtureState.close(); }
  });
  test(label+': submission holds changes and exact approval cannot survive selection or source drift',options,async () => {
    const fixtureState = await fixture(postgres);
    const {db,add,queue,api,drain,downloads} = fixtureState;
    try {
      add('drivefile','photo.jpg');
      const baseline = await queue('preview');
      await queue('sync',{preview_id:baseline.id});
      await db.run("UPDATE albums SET drive_review_required=1,submission_generation=1 WHERE id='album'");
      add('secondfile','photo_2.jpg');
      const held = await queue('sync');
      assert.equal(held.status,'awaiting_review');
      assert.equal(downloads(),1);
      const approval = await api('POST','/albums/album/drive/approve',{preview_id:held.id});
      await db.run("UPDATE albums SET selection_revision=selection_revision+1 WHERE id='album'");
      const stale = await drain(approval.job_id);
      assert.equal(stale.status,'failed');
      assert.equal(stale.error_code,'drive_preview_stale');
      assert.equal(downloads(),1);
      const fresh = await queue('preview');
      const accepted = await api('POST','/albums/album/drive/approve',{preview_id:fresh.id});
      assert.equal((await drain(accepted.job_id)).status,'completed');
      assert.equal(downloads(),2);
      const replay = await api('POST','/albums/album/drive/approve',{preview_id:fresh.id});
      assert.equal(replay.job_id,accepted.job_id);
      assert.equal((await db.get("SELECT * FROM albums WHERE id='album'")).drive_review_required,1);
      add('thirdfile','photo_3.jpg');
      const next = await queue('preview');
      fixtureState.files.set('thirdfile',{...fixtureState.files.get('thirdfile'),version:'2'});
      const outdated = await api('POST','/albums/album/drive/approve',{preview_id:next.id});
      assert.equal((await drain(outdated.job_id)).error_code,'drive_preview_stale');
    } finally { await fixtureState.close(); }
  });
  test(label+': omitted get parents uses folder membership across restart and repeated sync stays a no-op',options,async () => {
    const state = await fixture(postgres);
    try {
      state.hooks.get = file => {
        if (file.mimeType !== DRIVE_FOLDER) delete file.parents;
        return file;
      };
      for (let index=0; index<3; index++) state.add('image'+index,"same'\\name.jpg");
      const preview = await state.queue('preview');
      const approval = await state.api('POST','/albums/album/drive/approve',{preview_id:preview.id});
      await state.worker.runOnce();
      assert.equal((await state.jobs.get(approval.job_id)).status,'queued');
      assert.equal(state.downloads(),2);
      state.restartWorker();
      assert.equal((await state.drain(approval.job_id)).status,'completed');
      assert.equal(state.downloads(),3);
      const original = await state.db.all('SELECT id,filename FROM photos ORDER BY id');
      const keys = [...state.objects.keys()].sort();
      assert.equal(keys.length,9);
      state.restartWorker();
      assert.equal((await state.queue('sync')).status,'completed');
      assert.equal(state.downloads(),3);
      assert.deepEqual([...state.objects.keys()].sort(),keys);
      assert.deepEqual(await state.db.all('SELECT id,filename FROM photos ORDER BY id'),original);
    } finally { await state.close(); }
  });
  test(label+': moving source without version drift blocks publish with present or omitted get parents',options,async () => {
    for (const omitParents of [false,true]) {
      for (const boundary of ['download','publish','restart']) {
        const state = await fixture(postgres);
        try {
          state.hooks.get = file => {
            if (omitParents && file.mimeType !== DRIVE_FOLDER) file.parents = [];
            return file;
          };
          state.add('image0','same.jpg');
          state.add('image1','same.jpg');
          state.add('image2','same.jpg');
          const preview = await state.queue('preview');
          const approval = await state.api('POST','/albums/album/drive/approve',{preview_id:preview.id});
          const move = id => state.files.set(id,{...state.files.get(id),parents:['outside']});
          let expected = 0;
          if (boundary === 'download') state.hooks.download = move;
          if (boundary === 'publish') state.hooks.put = () => move('image0');
          if (boundary === 'restart') {
            await state.worker.runOnce();
            assert.equal(state.downloads(),2);
            move('image2');
            state.restartWorker();
            expected = 2;
          }
          const stale = await state.drain(approval.job_id);
          assert.equal(stale.error_code,'drive_preview_stale',JSON.stringify({omitParents,boundary,stale}));
          assert.equal((await state.db.all('SELECT id FROM photos')).length,expected);
          assert.equal(state.objects.size,expected*3);
          assert.equal(state.downloads(),boundary === 'restart' ? 2 : 1);
        } finally { await state.close(); }
      }
    }
  });
  test(label+': retry midway through a cached batch preserves natural order and every pending item',options,async () => {
    const state = await fixture(postgres);
    try {
      for (const index of [10,2,1]) state.add('image'+index,'IMG_'+index+'.jpg');
      const preview = await state.queue('preview');
      const approval = await state.api('POST','/albums/album/drive/approve',{preview_id:preview.id});
      let failed = false;
      state.hooks.get = file => {
        if (file.id === 'image2' && !failed) {
          failed = true;
          throw Object.assign(Error('transient fixture failure'),{code:'drive_api_failed',retryable:true});
        }
        return file;
      };
      await state.worker.runOnce();
      assert.equal((await state.jobs.get(approval.job_id)).status,'retry_wait');
      assert.equal(state.downloads(),1);
      await state.db.run('UPDATE drive_sync_jobs SET available_at=0 WHERE id=?',[approval.job_id]);
      await state.worker.runOnce();
      assert.equal((await state.drain(approval.job_id)).status,'completed');
      assert.equal(state.downloads(),3);
      assert.deepEqual((await state.db.all('SELECT original FROM photos ORDER BY position')).map(photo => photo.original),['IMG_1.jpg','IMG_2.jpg','IMG_10.jpg']);
    } finally { await state.close(); }
  });
  test(label+': detached file requires explicit reimport intent and preserves manual copy',options,async () => {
    const fixtureState = await fixture(postgres);
    const {db,add,queue,api,drain,downloads} = fixtureState;
    try {
      add('drivefile','photo.jpg');
      const baseline = await queue('preview');
      await queue('sync',{preview_id:baseline.id});
      const original = await db.get('SELECT * FROM photos');
      await api('POST','/photos/'+original.id+'/drive/detach',{});
      await queue('sync');
      assert.equal(downloads(),1);
      const requested = await api('POST','/albums/album/drive/reimport',{file_id:'drivefile'});
      const preview = await drain(requested.job_id);
      assert.equal(preview.status,'awaiting_review');
      await queue('sync',{preview_id:preview.id});
      assert.equal(downloads(),2);
      const photos = await db.all('SELECT * FROM photos');
      assert.equal(photos.length,2);
      assert.equal(photos.find(photo => photo.id === original.id).source,'manual');
      assert.equal(photos.filter(photo => photo.source === 'google_drive').length,1);
      assert.equal((await db.get('SELECT * FROM drive_reimport_intents')).status,'completed');
    } finally { await fixtureState.close(); }
  });
  test(label+': source drift during download and cancellation after PUT cannot publish stale candidates',options,async () => {
    const fixtureState = await fixture(postgres);
    const {db,add,queue,hooks,files,api,drain,jobs,objects} = fixtureState;
    try {
      add('drivefile','photo.jpg');
      const preview = await queue('preview');
      hooks.download = async fileId => {
        files.set(fileId,{...files.get(fileId),version:'2'});
      };
      const stale = await queue('sync',{preview_id:preview.id});
      assert.equal(stale.error_code,'drive_preview_stale');
      assert.equal((await db.all('SELECT * FROM photos')).length,0);
      assert.equal(objects.size,0);
      delete hooks.download;
      const fresh = await queue('preview');
      const pending = await api('POST','/albums/album/drive/sync',{preview_id:fresh.id});
      let canceled = false;
      hooks.put = async () => {
        if (!canceled) {
          canceled = true;
          await jobs.cancel(pending.job_id);
        }
      };
      const canceledJob = await drain(pending.job_id);
      assert.equal(canceledJob.status,'canceled');
      assert.equal((await db.all('SELECT * FROM photos')).length,0);
      assert.equal(objects.size,0);
      assert.equal((await db.all('SELECT * FROM media_writers')).length,0);
    } finally { await fixtureState.close(); }
  });
  test(label+': incomplete inventory never marks missing; pause cancels queued work and resume can enqueue',options,async () => {
    const fixtureState = await fixture(postgres);
    const {db,add,queue,hooks,files,api,drain} = fixtureState;
    try {
      add('drivefile','photo.jpg');
      const preview = await queue('preview');
      await queue('sync',{preview_id:preview.id});
      files.delete('drivefile');
      hooks.list = async () => ({files:[],incompleteSearch:true});
      assert.equal((await queue('sync')).error_code,'drive_inventory_incomplete');
      assert.equal((await db.get('SELECT * FROM drive_source_files')).state,'active');
      delete hooks.list;
      const queued = await api('POST','/albums/album/drive/sync',{});
      await api('POST','/albums/album/drive/pause',{paused:true});
      assert.equal((await drain(queued.job_id)).status,'canceled');
      await api('POST','/albums/album/drive/pause',{paused:false});
      const after = await queue('sync');
      assert.equal(after.status,'completed');
      assert.equal((await db.get('SELECT * FROM drive_source_files')).state,'missing_in_drive');
    } finally { await fixtureState.close(); }
  });
  test(label+': 5000-file preview persists every page and reports metadata without downloading images',options,async () => {
    const fixtureState = await fixture(postgres);
    try {
      for (let index=0; index<5000; index++) fixtureState.add('drivefile'+index,'IMG_'+index+'.jpg');
      const preview = await fixtureState.queue('preview');
      assert.equal(preview.status,'awaiting_review',JSON.stringify(preview));
      assert.equal(preview.manifest.count,5000);
      assert.equal(fixtureState.downloads(),0);
      assert.equal(Number((await fixtureState.db.get('SELECT COUNT(*) AS count FROM drive_sync_job_items WHERE job_id=?',[preview.id])).count),5000);
      const page = await fixtureState.api('GET','/drive/jobs/'+preview.id+'?offset=4999&limit=1');
      assert.equal(page.items.length,1);
      assert.equal(page.limit,1);
    } finally { await fixtureState.close(); }
  });
  test(label+': schedule starts disabled, needs explicit opt-in and still respects global switch',options,async () => {
    const fixtureState = await fixture(postgres);
    try {
      const {db,mapping,add,queue,api,jobs} = fixtureState;
      assert.equal(mapping.next_run_at,null);
      assert.deepEqual(await jobs.schedule({enabled:true}),[]);
      add('drivefile','photo.jpg');
      const preview = await queue('preview');
      await queue('sync',{preview_id:preview.id});
      const configured = await api('POST','/albums/album/drive/schedule',{enabled:true});
      assert.ok(Number(configured.mapping.next_run_at) > Date.now());
      assert.equal(configured.scheduler_enabled,false);
      await db.run('UPDATE drive_album_links SET next_run_at=0 WHERE id=?',[mapping.id]);
      assert.deepEqual(await jobs.schedule(),[]);
      const scheduled = await jobs.schedule({enabled:true});
      assert.equal(scheduled.length,1);
      assert.equal(scheduled[0].kind,'apply');
      assert.equal((await fixtureState.drain(scheduled[0].id)).status,'completed');
      await api('POST','/albums/album/drive/schedule',{enabled:false});
      assert.equal((await db.get('SELECT * FROM drive_album_links WHERE id=?',[mapping.id])).next_run_at,null);
    } finally { await fixtureState.close(); }
  });

}
