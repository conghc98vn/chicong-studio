import {initializeDriveComparisons} from '../server/drive-comparisons.mjs';
import {initializeFolderPreviews} from '../server/drive-folder-preview.mjs';
import {createDriveJobs} from '../server/drive-jobs.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,readdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {openDatabase} from '../server/db.mjs';
import {createStorage} from '../server/storage.mjs';
import {createMediaControl,trackedStorage} from '../server/media-control.mjs';
import {photoDeletion} from '../server/photo-deletion.mjs';
import {inventory,createBackup,readBackup,verifyBackup,exportBackup,restoreBackup,copyToStorage,manifestDelta,retentionPlan} from '../tools/media-backup.mjs';
async function fixture(){
 const dir=await mkdtemp(path.join(tmpdir(),'media-backup-')),source=path.join(dir,'source'),repository=path.join(dir,'backup');let pool,schema,url=null;
 if(process.env.STUDIO_TEST_POSTGRES_URL){pool=new pg.Pool({connectionString:process.env.STUDIO_TEST_POSTGRES_URL});schema='backup_'+randomUUID().replaceAll('-','');await pool.query('CREATE SCHEMA '+schema);const target=new URL(process.env.STUDIO_TEST_POSTGRES_URL);target.searchParams.set('options','-c search_path='+schema);url=target.href;}
 const db=await openDatabase(source,{url}),raw=createStorage(path.join(source,'uploads'),{}),control=await createMediaControl(db,raw.identity),storage=trackedStorage(db,raw,control),cleanup=photoDeletion({db,storage,mediaControl:control});
 const album='a'.repeat(32),photo='b'.repeat(32),filename='c'.repeat(32),legacy='d'.repeat(32),portrait='e'.repeat(32);
 await db.run('INSERT INTO albums(id,title,category,status) VALUES(?,?,?,?)',[album,'Private wedding','wedding','private']);
 await db.run('INSERT INTO admins(id,email,password) VALUES(?,?,?)',['owner','fixture@example.test','hash']);
 await db.run('INSERT INTO sessions(token,admin_id,expires) VALUES(?,?,?)',['fixture-session','owner',Date.now()+999999]);
 await db.run('INSERT INTO photos(id,album_id,filename,width,height,download_bytes) VALUES(?,?,?,?,?,?)',[photo,album,filename,100,100,4]);
 await db.run('INSERT INTO photos(id,album_id,filename,width,height) VALUES(?,?,?,?,?)',[legacy,album,legacy,100,100]);
 await db.run('INSERT INTO selections(album_id,photo_id,updated) VALUES(?,?,?)',[album,photo,'2026-10-16']);
 await db.run("INSERT INTO settings(key,value) VALUES('portrait',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[portrait]);
 for(const key of [filename+'.webp',filename+'-thumb.webp',filename+'-download.jpg',legacy+'.webp',legacy+'-thumb.webp',portrait+'.webp'])await raw.put(key,Buffer.from('data'));
 const backup=options=>createBackup({db,storage:raw,control,cleanup:cleanup.cleanup,root:repository,appRevision:'fixture',...options});
 return {dir,source,repository,db,raw,control,backup,album,photo,filename,legacy,portrait,close:async()=>{await cleanup.close();await db.close();if(pool){await pool.query('DROP SCHEMA '+schema+' CASCADE');await pool.end();}await rm(dir,{recursive:true,force:true});}};
}
test('Inventory uses current filename, all private/legacy renditions and portrait; offline restore needs no source',async()=>{
 const f=await fixture();try{
  const report=await inventory(f.db,f.raw);assert.equal(report.references.length,6);assert.ok(report.references.some(o=>o.key===f.filename+'.webp'));assert.ok(!report.references.some(o=>o.key===f.photo+'.webp'));
  const manifest=await f.backup();assert.equal(manifest.objects.length,6);const snapshot=await verifyBackup(f.repository,manifest);assert.equal(snapshot.tables.admins.length,1);assert.equal(snapshot.tables.sessions.length,1);
  const independent=path.join(f.dir,'offline');await exportBackup(f.repository,independent);await rm(path.join(f.source,'uploads'),{recursive:true});await rm(f.repository,{recursive:true});
  const restored=path.join(f.dir,'restored');await restoreBackup(independent,restored);const db=await openDatabase(restored,{url:null});try{assert.equal((await db.all('SELECT * FROM sessions')).length,0);assert.equal((await db.all('SELECT * FROM selections')).length,1);assert.equal((await db.get('SELECT filename FROM photos WHERE id=?',[f.photo])).filename,f.filename);assert.equal((await db.all('SELECT * FROM photo_cleanup')).length,0);}finally{await db.close();}
  assert.equal((await readdir(path.join(restored,'uploads'))).length,6);await assert.rejects(restoreBackup(independent,restored),{code:'EEXIST'});
 }finally{await f.close();}
});
test('Missing required file and lost protection never replace the last successful snapshot',async()=>{
 const f=await fixture();try{
  const first=await f.backup(),next='f'.repeat(32);await f.db.run('UPDATE photos SET filename=? WHERE id=?',[next,f.photo]);
  await f.raw.put(next+'.webp',Buffer.from('data'));await f.raw.put(next+'-thumb.webp',Buffer.from('data'));
  await assert.rejects(f.backup(),/ENOENT/);assert.equal((await readBackup(f.repository)).runId,first.runId);assert.equal((await f.control.status()).control.owner,null);
  await f.raw.put(next+'-download.jpg',Buffer.from('data'));
  const original=f.control.assertLease;let expired=false;f.control.assertLease=async lease=>{if(!expired){expired=true;await f.db.run('UPDATE media_control SET deadline=0');}return original(lease);};
  await assert.rejects(f.backup(),/expired/);assert.equal((await readBackup(f.repository)).runId,first.runId);assert.ok((await f.control.status()).control.owner);
 }finally{await f.close();}
});
test('Copy resumes by verifying destination bytes, refuses conflicts and reports delta without deletion',async()=>{
 const f=await fixture();try{
  const manifest=await f.backup(),destination=createStorage(path.join(f.dir,'destination'),{}),reportFile=path.join(f.dir,'copy.json');
  assert.equal((await copyToStorage(f.repository,destination,{reportFile})).state,'verified');assert.equal((await copyToStorage(f.repository,destination,{reportFile})).verified.length,6);
  await destination.put(manifest.objects[0].key,Buffer.from('wrong'));await assert.rejects(copyToStorage(f.repository,destination),/conflict/);
  const delta=manifestDelta(manifest,{objects:[{key:'new',sha256:'new'},...manifest.objects.slice(1)]});assert.deepEqual(delta.added,['new']);assert.deepEqual(delta.removed,[manifest.objects[0].key]);
  await writeFile(path.join(f.repository,'blobs',manifest.objects[0].sha256),'bad');await assert.rejects(verifyBackup(f.repository,manifest),/checksum/);
 }finally{await f.close();}
});
test('30 Vietnam calendar days retain shared bytes and always preserve the last good backup',async()=>{
 const f=await fixture();try{
  const manifest=await f.backup(),now=Date.parse('2026-10-16T00:00:00+07:00');
  const snapshots=[{...manifest,runId:'old',capturedAt:'2026-09-16T23:59:59+07:00'},{...manifest,runId:'boundary',capturedAt:'2026-09-17T00:00:00+07:00'},{...manifest,runId:'current',capturedAt:'2026-10-16T00:00:00+07:00'}];
  const plan=retentionPlan(snapshots,now);assert.deepEqual(plan.drop.map(m=>m.runId),['old']);assert.deepEqual(plan.unreferenced,[]);assert.equal(retentionPlan([snapshots[0]],now).keep.length,1);
 }finally{await f.close();}
});

test('A timed out migration PUT cannot be retried just because a following GET says missing',async()=>{
 const f=await fixture();try{
  await f.backup();let calls=0;const destination={identity:'unknown-target',get:async()=>{throw Object.assign(Error('missing'),{code:'STORAGE_NOT_FOUND'});},put:async()=>{calls++;throw Error('timeout');}};
  const reportFile=path.join(f.dir,'pending.json');await assert.rejects(copyToStorage(f.repository,destination,{reportFile}),/timeout/);assert.equal(calls,1);
  await assert.rejects(copyToStorage(f.repository,destination,{reportFile}),/outcome is unknown/);assert.equal(calls,1);
 }finally{await f.close();}
});

test('Final cutover snapshot reuses the operator lease and never opens writes between backup and switch',async()=>{
 const f=await fixture();try{
  const lease=await f.control.acquire('operator');const manifest=await f.backup({existingLease:lease});
  assert.equal((await f.control.status()).control.owner,'operator');await f.control.assertDrained(lease,{queue:true});
  await assert.rejects(f.control.run('admin-upload',async()=>{}),{code:'MEDIA_LOCKED'});
  assert.equal((await readBackup(f.repository)).runId,manifest.runId);await f.control.release(lease);
 }finally{await f.close();}
});


test('Private comparison and folder preview caches are excluded; unknown tables still stop backups',async()=>{
 const f=await fixture();try{
  await initializeDriveComparisons(f.db);
  await initializeFolderPreviews(f.db);
  await f.db.run("INSERT INTO drive_connections(id,service_account_email,root_folder_id,status) VALUES('cache-studio','test@studio.iam.gserviceaccount.com','root','active')");
  const job=await createDriveJobs(f.db).enqueue({connectionId:'cache-studio',kind:'check',requestKey:'cache-backup-test'});
  await f.db.run('INSERT INTO drive_comparison_cache(job_id,preview_id,item_id,photo_id,filename,image_base64,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)',[job.id,'preview','item',f.photo,f.filename,'PRIVATE_COMPARISON_EXCLUDED',Date.now(),Date.now()+900000]);
  await f.db.run('INSERT INTO drive_folder_preview_cache(job_id,file_id,folder_id,image_base64,created_at,expires_at) VALUES(?,?,?,?,?,?)',[job.id,'example-photo','root','PRIVATE_FOLDER_PREVIEW_EXCLUDED',Date.now(),Date.now()+300000]);
  const manifest=await f.backup(),snapshot=await verifyBackup(f.repository,manifest);
  assert.equal(Object.hasOwn(snapshot.tables,'drive_comparison_cache'),false);
  assert.equal(Object.hasOwn(snapshot.tables,'drive_folder_preview_cache'),false);
  assert.equal(JSON.stringify(snapshot).includes('PRIVATE_COMPARISON_EXCLUDED'),false);
  assert.equal(JSON.stringify(snapshot).includes('PRIVATE_FOLDER_PREVIEW_EXCLUDED'),false);
  assert.equal(snapshot.tables.photos.length,2);
  assert.equal(Number((await f.db.get('SELECT COUNT(*) AS n FROM drive_comparison_cache')).n),1,'Snapshot exclusion must not mutate active previews');
  assert.equal(Number((await f.db.get('SELECT COUNT(*) AS n FROM drive_folder_preview_cache')).n),1,'Snapshot exclusion must not mutate folder previews');
  await f.db.exec('CREATE TABLE unrecognized_test_data(id TEXT)');
  await assert.rejects(f.backup(),/Unrecognized database tables/);
 }finally{await f.close();}
});
