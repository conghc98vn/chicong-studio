import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import express from 'express';
import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../server/db.mjs';
import {createMediaControl} from '../server/media-control.mjs';
import {createDriveJobs} from '../server/drive-jobs.mjs';
import {createDriveWorker} from '../server/drive-worker.mjs';
import {registerDriveRoutes} from '../server/drive-routes.mjs';
import {DRIVE_FOLDER} from '../server/drive-client.mjs';
import {collectFolderPreviews,fetchDriveThumbnail,thumbnailUrl,cleanupFolderPreviews,FOLDER_PREVIEW_MAX_BYTES} from '../server/drive-folder-preview.mjs';

const source={id:'photo001',name:'Sample.jpg',mimeType:'image/jpeg',parents:['folder'],thumbnailLink:'https://lh3.googleusercontent.com/signed-thumbnail=s240'};
const jpeg=()=>sharp({create:{width:600,height:400,channels:3,background:'#aa66bb'}}).jpeg().toBuffer();
async function fixture(t,{browseTimeoutMs}={}) {
  const directory=await mkdtemp(path.join(os.tmpdir(),'folder-preview-'));
  let pool,schema,databaseUrl=null;
  if(process.env.STUDIO_TEST_POSTGRES_URL) {
    pool=new pg.Pool({connectionString:process.env.STUDIO_TEST_POSTGRES_URL});
    schema='folder_preview_'+randomUUID().replaceAll('-','');await pool.query('CREATE SCHEMA '+schema);
    const target=new URL(process.env.STUDIO_TEST_POSTGRES_URL);target.searchParams.set('options','-c search_path='+schema);databaseUrl=target.href;
  }
  const db=await openDatabase(directory,{url:databaseUrl});
  const control=await createMediaControl(db,'folder-preview-test');const jobs=createDriveJobs(db);
  const bytes=await jpeg();const counters={images:0,thumbnails:0};
  const drive={serviceAccountEmail:'test@studio.iam.gserviceaccount.com',
    async getFile(id){return {id,name:'Folder',mimeType:DRIVE_FOLDER};},
    async listFiles(){return {files:[]};},
    async listPreviewImages(){counters.images++;return {files:[structuredClone(source)]};},
    async thumbnail(){counters.thumbnails++;return bytes;},
    async download(){assert.fail('Full-resolution downloads forbidden');},
  };
  await db.run("INSERT INTO drive_connections(id,service_account_email,root_folder_id,folder_scope,status) VALUES('studio',?,'folder','shared','active')",[drive.serviceAccountEmail]);
  const env={DRIVE_SYNC_ENABLED:'true',DRIVE_SYNC_TEMP_DIR:path.join(directory,'temp')};
  const worker=createDriveWorker({db,control,jobs,drive,storage:{identity:'preview-test'},env,logger:()=>{},browseTimeoutMs});
  const app=express();app.use(express.json());
  app.use((req,res,next)=>{if(req.get('X-Admin')==='yes') req.admin='admin';next();});
  registerDriveRoutes(app,{db,control,env});
  const off=express.Router();registerDriveRoutes(off,{db,control,env:{DRIVE_SYNC_ENABLED:'false'}});app.use('/off',off);
  app.use((error,req,res,next)=>res.status(error.status||500).json({error:error.code||error.message}));
  const server=await new Promise(resolve=>{const server=app.listen(0,'127.0.0.1',()=>resolve(server));});
  t.after(async()=>{worker.stop();await new Promise(resolve=>server.close(resolve));await db.close();if(pool){await pool.query('DROP SCHEMA '+schema+' CASCADE');await pool.end();}await rm(directory,{recursive:true,force:true});});
  const get=(url,admin=true)=>fetch('http://127.0.0.1:'+server.address().port+url,{headers:admin?{'X-Admin':'yes'}:{}});
  async function browse(pageToken) {
    const job=await jobs.enqueue({connectionId:'studio',kind:'check',requestKey:'browse-'+Math.random().toString().slice(2),payload:{operation:'browse-folders',folderId:'folder',...(pageToken?{pageToken}:{})}});
    await worker.runOnce();const result=await jobs.get(job.id);
    assert.equal(result.status,'completed',result.error_code);return {job:result,progress:JSON.parse(result.progress_json)};
  }
  return {db,drive,browse,get,counters,jobs,worker};
}

test('folder preview is small, private, expires and is generation bound; pagination does not fetch images',async t=>{
  const f=await fixture(t);const {progress,job}=await f.browse();
  assert.equal(progress.preview.unavailable,false);assert.equal(progress.preview.images.length,1);
  assert.ok(JSON.stringify(progress).length<1000);assert.ok(!JSON.stringify(progress).includes('googleusercontent'));
  const url=progress.preview.images[0].url;
  assert.equal((await f.get(url,false)).status,401);
  assert.equal((await f.get('/off'+url)).status,503);
  const response=await f.get(url);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private,no-store');
  assert.equal(response.headers.get('x-content-type-options'),'nosniff');
  const bytes=Buffer.from(await response.arrayBuffer());assert.ok(bytes.length<=FOLDER_PREVIEW_MAX_BYTES);
  const metadata=await sharp(bytes).metadata();assert.equal(metadata.format,'webp');assert.ok(metadata.width<=240 && metadata.height<=240);
  assert.equal(Number((await f.db.get('SELECT COUNT(*) AS n FROM photos')).n),0);
  assert.equal((await f.browse('second-page')).progress.preview,undefined);assert.equal(f.counters.images,1);
  await f.db.run("UPDATE drive_connections SET generation=generation+1 WHERE id='studio'");
  assert.equal((await f.get(url)).status,404);
  await f.db.run("UPDATE drive_connections SET generation=generation-1 WHERE id='studio'");
  await f.db.run('UPDATE drive_folder_preview_cache SET expires_at=0 WHERE job_id=?',[job.id]);
  assert.equal((await f.get(url)).status,404);
});

test('thumbnail failure never fails folder browsing and unsupported adapters fall back',async t=>{
  const f=await fixture(t);f.drive.thumbnail=async()=>{throw Error('permission failure');};
  const {progress}=await f.browse();assert.deepEqual(progress.preview,{images:[],unavailable:true});
  assert.deepEqual(await collectFolderPreviews({},'folder'),{images:[],unavailable:true});
});

test('six thumbnail reads use six SELECTs and no writes; expiry still denies access before cleanup',async t=>{
  const f=await fixture(t);
  f.drive.listPreviewImages=async()=>({files:Array.from({length:6},(_,i)=>({...source,id:'sample'+i}))});
  const {progress,job}=await f.browse();
  const calls=[];
  const original=Object.fromEntries(['get','all','run','exec'].map(method=>[method,f.db[method]]));
  for(const method of Object.keys(original)) f.db[method]=async(...args)=>{calls.push({method,sql:args[0]});return original[method](...args);};
  try {
    const responses=await Promise.all(progress.preview.images.map(image=>f.get(image.url)));
    assert.ok(responses.every(response=>response.status===200));
    await Promise.all(responses.map(response=>response.arrayBuffer()));
    assert.equal(calls.length,6,JSON.stringify(calls));
    assert.ok(calls.every(call=>call.method==='get' && call.sql.startsWith('SELECT')));
    await original.run('UPDATE drive_folder_preview_cache SET expires_at=0 WHERE job_id=?',[job.id]);
    calls.length=0;
    assert.equal((await f.get(progress.preview.images[0].url)).status,404);
    assert.equal(calls.length,1);
    assert.equal(calls[0].method,'get');
    assert.equal(Number((await original.get('SELECT COUNT(*) AS n FROM drive_folder_preview_cache')).n),6);
    await cleanupFolderPreviews(f.db);
    assert.equal(Number((await original.get('SELECT COUNT(*) AS n FROM drive_folder_preview_cache')).n),0);
  } finally {Object.assign(f.db,original);}
});

test('preview metadata rejects malformed membership, duplicates, oversized pages, and unsafe URLs before fetching',async()=>{
  for(const files of [[{...source,parents:['other']}],[{...source,parents:'folder'}],[source,source],Array(7).fill(source),[{...source,mimeType:'text/html'}],[{...source,thumbnailLink:'https://attacker.example/thumb'}]]) {
    let downloaded=false;
    const result=await collectFolderPreviews({listPreviewImages:async()=>({files}),thumbnail:async()=>{downloaded=true;return jpeg();}},'folder');
    assert.equal(downloaded,false);assert.deepEqual(result,{images:[],unavailable:true});
  }
});

test('thumbnail network reader rejects redirects, untrusted hosts and oversized or non-image bodies',async()=>{
  for(const url of ['http://lh3.googleusercontent.com/image','https://lh3.googleusercontent.com.evil.test/x','https://lh3.googleusercontent.com@evil.test/x','https://127.0.0.1/x','https://drive.google.com/anything','https://lh3.googleusercontent.com:8080/x']) assert.throws(()=>thumbnailUrl(url));
  assert.ok(thumbnailUrl(source.thumbnailLink));
  for(const response of [new Response('bad',{headers:{'content-type':'text/html'}}),new Response(Buffer.alloc(512*1024+1),{headers:{'content-type':'image/jpeg'}}),new Response(null,{status:302,headers:{location:'https://evil.test'}})]) {
    await assert.rejects(fetchDriveThumbnail(source.thumbnailLink,{fetchImpl:async(url,options)=>{assert.equal(options.redirect,'error');return response;}}));
  }
});

test('decode rejects disguised SVG and oversized decoded images; partial previews survive',async()=>{
  const files=[source,{...source,id:'photo002'}];let call=0;
  const result=await collectFolderPreviews({listPreviewImages:async()=>({files}),thumbnail:async()=>++call===1?Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="3" height="3"/>'):jpeg()},'folder');
  assert.equal(result.unavailable,true);assert.equal(result.images.length,1);assert.equal(result.images[0].id,'photo002');
  const large=await sharp({create:{width:2100,height:2100,channels:3,background:'white'}}).jpeg().toBuffer();
  const rejected=await collectFolderPreviews({listPreviewImages:async()=>({files:[source]}),thumbnail:async()=>large},'folder');
  assert.deepEqual(rejected,{images:[],unavailable:true});
});


test('cache evicts older preview rows at its fixed capacity',async t=>{
  const f=await fixture(t);
  f.drive.listPreviewImages=async()=>({files:Array.from({length:6},(_,i)=>({...source,id:'sample'+i}))});
  const first=await f.browse();
  for(let i=0;i<10;i++) await f.browse();
  assert.equal(Number((await f.db.get('SELECT COUNT(*) AS n FROM drive_folder_preview_cache')).n),60);
  assert.equal((await f.get(first.progress.preview.images[0].url)).status,404);
});

test('thumbnail authorization waits are bounded, and caller cancellation propagates',async()=>{
  const abort=new AbortController();
  const pending=fetchDriveThumbnail(source.thumbnailLink,{signal:abort.signal,getHeaders:()=>new Promise(()=>{})});
  abort.abort(new Error('cancel fixture'));
  await assert.rejects(pending,/cancel fixture/);
  const canceled=new AbortController();canceled.abort(new Error('stop preview'));
  await assert.rejects(collectFolderPreviews({listPreviewImages:()=>new Promise(()=>{}),thumbnail:async()=>jpeg()},'folder',{signal:canceled.signal}),/stop preview/);
});


test('browse publishes navigation and thumbnails before slow overview, merging progress while running',async t=>{
  const f=await fixture(t);let releaseCount;
  f.drive.listFolderOverview=()=>new Promise(resolve=>{releaseCount=()=>resolve({files:[{id:'photo001',mimeType:'image/jpeg',parents:['folder']}]});});
  const job=await f.jobs.enqueue({connectionId:'studio',kind:'check',requestKey:'early-navigation',payload:{operation:'browse-folders',folderId:'folder'}});
  const running=f.worker.runOnce();
  try {
    let current;
    for(let attempt=0;attempt<100;attempt++) {
      current=await f.jobs.get(job.id);
      if(current.progress?.preview?.images?.length) break;
      await new Promise(resolve=>setTimeout(resolve,10));
    }
    assert.equal(current.status,'running');assert.equal(current.progress.ready,true);
    assert.equal(current.progress.summary.status,'loading');
    assert.equal((await f.get(current.progress.preview.images[0].url)).status,200);
    releaseCount();await running;
    current=await f.jobs.get(job.id);assert.equal(current.status,'completed');
    assert.equal(current.progress.summary.images,1);assert.equal(current.progress.preview.images.length,1);
    f.drive.listFolderOverview=()=>assert.fail('Pagination must not recount');
    assert.equal((await f.browse('next')).progress.summary,undefined);
  } finally {releaseCount?.();await running;}
});

test('overview publication cannot cross cancellation or connection generation change',async t=>{
  const f=await fixture(t);
  for(const change of ['cancel','generation']) {
    let releaseCount;
    f.drive.listFolderOverview=()=>new Promise(resolve=>{releaseCount=()=>resolve({files:[{id:'photo001',mimeType:'image/jpeg',parents:['folder']}]});});
    const job=await f.jobs.enqueue({connectionId:'studio',kind:'check',requestKey:'overview-fence-'+change,payload:{operation:'browse-folders',folderId:'folder'}});
    const running=f.worker.runOnce();
    try {
      for(let i=0;i<100&&!releaseCount;i++) await new Promise(resolve=>setTimeout(resolve,10));
      assert.ok(releaseCount);
      if(change==='cancel') await f.jobs.cancel(job.id);
      else await f.db.run("UPDATE drive_connections SET generation=generation+1 WHERE id='studio'");
      releaseCount();await running;
      const current=await f.jobs.get(job.id);
      assert.notEqual(current.status,'completed');assert.notEqual(current.progress.summary?.status,'ready');
    } finally {releaseCount?.();await running;}
  }
});

test('ready folder and totals remain usable while thumbnail processing is pending',async t=>{
  const f=await fixture(t);let releaseThumbnail;
  f.drive.listFolderOverview=async()=>({files:[{id:'photo001',mimeType:'image/jpeg',parents:['folder']}]});
  f.drive.thumbnail=()=>new Promise(resolve=>{releaseThumbnail=async()=>resolve(await jpeg());});
  const job=await f.jobs.enqueue({connectionId:'studio',kind:'check',requestKey:'early-overview-before-thumbnail',payload:{operation:'browse-folders',folderId:'folder'}});
  const running=f.worker.runOnce();
  try {
    let current;
    for(let attempt=0;attempt<100;attempt++) {
      current=await f.jobs.get(job.id);
      if(current.progress?.summary?.status==='ready' && releaseThumbnail) break;
      await new Promise(resolve=>setTimeout(resolve,10));
    }
    assert.equal(current.status,'running');assert.equal(current.progress.ready,true);
    assert.equal(current.progress.summary.images,1);assert.equal(current.progress.preview.pending,true);
    await releaseThumbnail();await running;
    current=await f.jobs.get(job.id);assert.equal(current.status,'completed');
    assert.equal(current.progress.preview.pending,undefined);assert.equal(current.progress.preview.images.length,1);
  } finally {await releaseThumbnail?.();await running;}
});

test('enrichment deadline includes permission rechecks and prevents late publication',async t=>{
  const f=await fixture(t,{browseTimeoutMs:100});
  const releases=[];let reads=0;
  f.drive.listFolderOverview=async()=>({files:[{id:'photo001',mimeType:'image/jpeg',parents:['folder']}]});
  f.drive.getFile=async id=>{
    const result={id,name:'Folder',mimeType:DRIVE_FOLDER};
    if(++reads<=2)return result;
    // Simulate an auth provider ignoring cancellation after initial validation.
    return new Promise(resolve=>releases.push(()=>resolve(result)));
  };
  const job=await f.jobs.enqueue({connectionId:'studio',kind:'check',requestKey:'bounded-final-verification',payload:{operation:'browse-folders',folderId:'folder'}});
  let watchdog;
  try {
    await Promise.race([f.worker.runOnce(),new Promise((_,reject)=>{watchdog=setTimeout(()=>reject(Error('Permission check blocked the worker')),3000);})]);
    const failed=await f.jobs.get(job.id);
    assert.equal(failed.status,'failed');assert.equal(failed.error_code,'drive_browse_timeout');
    assert.equal(failed.progress.ready,true);assert.equal(failed.progress.summary.status,'loading');
    assert.deepEqual(failed.progress.preview.images,[]);assert.ok(releases.length>0);
    for(const release of releases)release();
    await new Promise(resolve=>setTimeout(resolve,30));
    assert.deepEqual((await f.jobs.get(job.id)).progress,failed.progress);
    assert.equal(Number((await f.db.get('SELECT COUNT(*) AS n FROM drive_folder_preview_cache')).n),0);
  } finally {clearTimeout(watchdog);for(const release of releases)release();}
});

test('canceling abandoned browse interrupts enrichment and frees the worker for the next folder',async t=>{
  const f=await fixture(t);let releaseOverview;
  f.drive.listFolderOverview=()=>new Promise(resolve=>{releaseOverview=()=>resolve({files:[]});});
  const job=await f.jobs.enqueue({connectionId:'studio',kind:'check',requestKey:'abandoned-folder',payload:{operation:'browse-folders',folderId:'folder'}});
  const running=f.worker.runOnce();let watchdog;
  try {
    for(let i=0;i<100&&!releaseOverview;i++)await new Promise(resolve=>setTimeout(resolve,10));
    assert.ok(releaseOverview);assert.equal((await f.jobs.get(job.id)).progress.ready,true);
    await f.jobs.cancel(job.id);
    await Promise.race([running,new Promise((_,reject)=>{watchdog=setTimeout(()=>reject(Error('Canceled folder still occupies worker')),2500);})]);
    assert.equal((await f.jobs.get(job.id)).status,'canceled');
    f.drive.listFolderOverview=async()=>({files:[]});
    assert.equal((await f.browse()).progress.summary.images,0);
    releaseOverview();await new Promise(resolve=>setTimeout(resolve,20));
    assert.equal((await f.jobs.get(job.id)).progress.summary.status,'loading');
  } finally {clearTimeout(watchdog);releaseOverview?.();await running;}
});
