import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import pg from 'pg';
import express from 'express';
import sharp from 'sharp';
import {openDatabase} from '../server/db.mjs';
import {createMediaControl} from '../server/media-control.mjs';
import {createDriveJobs} from '../server/drive-jobs.mjs';
import {createDriveWorker} from '../server/drive-worker.mjs';
import {registerDriveComparisonRoutes,cleanupDriveComparisons,runDriveComparison,COMPARISON_MAX_BYTES} from '../server/drive-comparisons.mjs';
import {DRIVE_FOLDER} from '../server/drive-client.mjs';

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(),'drive-comparison-'));
  let pool,schema,databaseUrl=null;
  if(process.env.STUDIO_TEST_POSTGRES_URL){
    pool=new pg.Pool({connectionString:process.env.STUDIO_TEST_POSTGRES_URL});
    schema='comparison_'+randomUUID().replaceAll('-','');await pool.query('CREATE SCHEMA '+schema);
    const target=new URL(process.env.STUDIO_TEST_POSTGRES_URL);target.searchParams.set('options','-c search_path='+schema);databaseUrl=target.href;
  }
  const db = await openDatabase(directory,{url:databaseUrl});
  const control = await createMediaControl(db,'comparison-test');
  const jobs = createDriveJobs(db);
  const bytes = await sharp({create:{width:96,height:64,channels:3,background:'#a32342'}}).jpeg().toBuffer();
  const currentThumb = await sharp({create:{width:96,height:64,channels:3,background:'#235ba3'}}).webp().toBuffer();
  const file = {id:'sourcefile',name:'changed.jpg',version:'2',mimeType:'image/jpeg',size:String(bytes.length),md5Checksum:createHash('md5').update(bytes).digest('hex'),parents:['folder'],capabilities:{canDownload:true}};
  const files = new Map([['root',{id:'root',name:'root',mimeType:DRIVE_FOLDER,parents:[]}],['folder',{id:'folder',name:'Album folder',mimeType:DRIVE_FOLDER,parents:['root']}],[file.id,file]]);
  const hooks = {};
  let downloads = 0;
  const drive = {serviceAccountEmail:'test@studio.iam.gserviceaccount.com',
    async getFile(id) { const value=structuredClone(files.get(id)); return hooks.get ? hooks.get(value) : value; },
    async listFiles(folder) { return {files:[...files.values()].filter(row=>row.parents?.includes(folder)).map(row=>structuredClone(row))}; },
    async download(id,destination,{signal}) { signal?.throwIfAborted(); downloads++; await writeFile(destination,bytes,{flag:'wx',mode:0o600}); await hooks.download?.(); },
  };
  await db.run("INSERT INTO albums(id,title,category,status) VALUES('album','Album','wedding','private')");
  await db.run("INSERT INTO photos(id,album_id,filename,original,width,height,source) VALUES('photo','album','original-rendition','old.jpg',96,64,'google_drive')");
  await db.run("INSERT INTO drive_connections(id,service_account_email,root_folder_id,status) VALUES('studio',?,'root','active')",[drive.serviceAccountEmail]);
  await db.run("INSERT INTO drive_album_links(id,connection_id,album_id,folder_id) VALUES('mapping','studio','album','folder')");
  await db.run("INSERT INTO drive_source_files(id,connection_id,drive_file_id,mapping_id,photo_id,source_generation,imported_generation,imported_version) VALUES('source','studio','sourcefile','mapping','photo',1,1,'1')");
  const preview = await jobs.enqueue({connectionId:'studio',mappingId:'mapping',kind:'preview',requestKey:'preview-request'});
  const lease = await jobs.claim('preview-fixture');
  const album = await db.get("SELECT * FROM albums WHERE id='album'");
  await jobs.putItems(lease,[{id:'replace-item',fileId:file.id,action:'replace',version:file.version,sourceGeneration:1,source:{sourceId:'source',file}}]);
  await jobs.finish(lease,{status:'awaiting_review',manifest:{complete:true,count:1,hash:'unchanged-preview-hash',catalogRevision:album.catalog_revision,selectionRevision:album.selection_revision,submissionGeneration:album.submission_generation}});
  const storage = {async get(key) { assert.equal(key,'original-rendition-thumb.webp');return currentThumb; },async put() { throw Error('Comparison must never publish'); }};
  const env = {DRIVE_SYNC_ENABLED:'true',DRIVE_SYNC_TEMP_DIR:path.join(directory,'temporary')};
  const worker = createDriveWorker({db,storage,control,drive,jobs,env,logger:()=>{}});
  const app = express();
  app.use(express.json());
  app.use((request,response,next)=>{ if(request.get('X-Test-Admin')==='yes') request.admin='test-admin'; next(); });
  registerDriveComparisonRoutes(app,{db,storage,control,env,jobs});
  app.use((error,request,response,next)=>response.status(error.status||500).json({error:error.code||error.message}));
  const server = await new Promise(resolve=>{const value=app.listen(0,'127.0.0.1',()=>resolve(value));});
  const url = 'http://127.0.0.1:'+server.address().port;
  t.after(async()=>{worker.stop();await new Promise(resolve=>server.close(resolve));await db.close();if(pool){await pool.query('DROP SCHEMA '+schema+' CASCADE');await pool.end();}await rm(directory,{recursive:true,force:true});});
  async function request(route,{method='GET',body,admin=true}={}) {
    return fetch(url+route,{method,headers:{'Content-Type':'application/json',...(admin?{'X-Test-Admin':'yes'}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  }
  async function enqueue(key='comparison-key') {
    const response=await request('/api/admin/drive/jobs/'+preview.id+'/items/replace-item/comparison',{method:'POST',body:{request_key:key}});
    assert.equal(response.status,202,await response.clone().text());return (await response.json()).job_id;
  }
  return {db,jobs,worker,files,hooks,file,preview,request,enqueue,drive,currentThumb,directory,downloads:()=>downloads};
}

test('private comparison produces a bounded image without changing catalog or provenance, expires independently',async t=>{
  const f=await fixture(t);
  const albumBefore=await f.db.get("SELECT * FROM albums WHERE id='album'");
  const sourceBefore=await f.db.get("SELECT * FROM drive_source_files WHERE id='source'");
  const jobId=await f.enqueue();
  assert.equal(await f.enqueue(),jobId);
  const result=await f.worker.runOnce();
  assert.equal(result.status,'completed');assert.equal(f.downloads(),1);
  const response=await f.request('/api/admin/drive/comparisons/'+jobId);
  assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private,no-store');
  const status=await response.json();assert.equal(status.file_name,'changed.jpg');assert.ok(status.incoming.url);
  assert.ok(JSON.stringify(status).length<1000);assert.ok(!JSON.stringify(await f.jobs.get(jobId)).includes('image_base64'));
  assert.equal((await f.request(status.incoming.url,{admin:false})).status,401);
  const incoming=await f.request(status.incoming.url);assert.equal(incoming.status,200);assert.equal(incoming.headers.get('content-type'),'image/webp');
  const image=Buffer.from(await incoming.arrayBuffer());const metadata=await sharp(image).metadata();
  assert.ok(image.length<=COMPARISON_MAX_BYTES);assert.ok(metadata.width<=900 && metadata.height<=900);
  const current=await f.request(status.current.url);assert.deepEqual(Buffer.from(await current.arrayBuffer()),f.currentThumb);
  assert.deepEqual(await f.db.get("SELECT * FROM albums WHERE id='album'"),albumBefore);
  assert.deepEqual(await f.db.get("SELECT * FROM drive_source_files WHERE id='source'"),sourceBefore);
  assert.equal(Number((await f.db.get('SELECT COUNT(*) AS n FROM photos')).n),1);
  await f.db.run('UPDATE drive_comparison_cache SET expires_at=0 WHERE job_id=?',[jobId]);
  await cleanupDriveComparisons(f.db);
  const expired=await f.request('/api/admin/drive/comparisons/'+jobId);assert.equal((await expired.json()).error_code,'drive_comparison_expired');
  assert.equal((await f.request(status.incoming.url)).status,410);
});

test('comparison denies stale catalog, moved Drive membership, and canceled work',async t=>{
  await t.test('catalog change blocks both images',async t=>{
    const f=await fixture(t);const id=await f.enqueue();await f.worker.runOnce();
    await f.db.run("UPDATE photos SET caption='edited' WHERE id='photo'");
    const response=await f.request('/api/admin/drive/comparisons/'+id+'/image');assert.equal(response.status,409);assert.equal((await response.json()).error,'drive_preview_stale');
  });
  await t.test('move after download with omitted get parents is detected',async t=>{
    const f=await fixture(t);f.hooks.get=value=>{if(value.id===f.file.id) delete value.parents;return value;};
    f.hooks.download=()=>{f.file.parents=['elsewhere'];};
    await f.enqueue();const result=await f.worker.runOnce();assert.equal(result.status,'failed');assert.equal(result.error_code,'drive_preview_stale');
    assert.equal(Number((await f.db.get('SELECT COUNT(*) AS n FROM drive_comparison_cache')).n),0);
  });
  await t.test('cancellation fences the encoded result',async t=>{
    const f=await fixture(t);const id=await f.enqueue();f.hooks.download=()=>f.jobs.cancel(id);
    const result=await f.worker.runOnce();assert.equal(result.status,'canceled');
    assert.equal(Number((await f.db.get('SELECT COUNT(*) AS n FROM drive_comparison_cache')).n),0);
  });
});

test('folder inspection reports chosen folder and does not link an album',async t=>{
  const f=await fixture(t);
  const before=await f.db.all('SELECT * FROM drive_album_links');
  await f.jobs.enqueue({connectionId:'studio',kind:'check',requestKey:'inspect-folder-key',payload:{operation:'inspect-folder',folderId:'folder'}});
  const result=await f.worker.runOnce();assert.equal(result.status,'completed');assert.deepEqual(result.progress.folder,{id:'folder',name:'Album folder'});
  assert.deepEqual(await f.db.all('SELECT * FROM drive_album_links'),before);
});
