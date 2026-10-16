#!/usr/bin/env node
// Opt-in, synthetic staging rehearsal. Never loads .env or changes storage binding.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {openDatabase,id} from '../server/db.mjs';
import {createStorage} from '../server/storage.mjs';
import {createMediaControl,trackedStorage} from '../server/media-control.mjs';
import {photoDeletion} from '../server/photo-deletion.mjs';
import {uploadPhoto} from '../server/photo-upload.mjs';
import {quietUploadTrace} from '../server/upload-trace.mjs';
import {createBackup,verifyBackup,exportBackup,restoreBackup,copyToStorage,manifestDelta,waitForWriters,sha256} from '../tools/media-backup.mjs';

export const reportKey='render_staging_rehearsal_v1';
export function assertStagingEnvironment(env){
 if(env.RENDER_STAGING_REHEARSAL!=='synthetic-ops-v1')throw Error('Set RENDER_STAGING_REHEARSAL=synthetic-ops-v1 explicitly');
 if(env.MEDIA_STORAGE_PROVIDER!=='r2'||env.R2_BUCKET!=='chicong-staging')throw Error('This rehearsal requires the chicong-staging R2 bucket');
 let url;try{url=new URL(env.DATABASE_URL);}catch{throw Error('A staging PostgreSQL URL is required');}
 if(!['postgres:','postgresql:'].includes(url.protocol)||decodeURIComponent(url.pathname)!=='/chicong_r2_staging_db')throw Error('This rehearsal requires database chicong_r2_staging_db');
 if(!/^https:\/\/[a-f0-9]{32}\.r2\.cloudflarestorage\.com\/?$/.test(env.R2_ENDPOINT||''))throw Error('An explicit Cloudflare R2 endpoint is required');
}

// Dependency injection permits an isolated local equivalent without cloud credentials.
// Only the CLI entry point is permitted to create the real staging dependencies.
export async function runRehearsal({db,raw,root,revision='unknown'}){
 const prior=await db.get('SELECT value FROM settings WHERE key=?',[reportKey]);
 if(prior){
  const saved=JSON.parse(prior.value),state=await db.get('SELECT * FROM media_control WHERE id=1');
  if(saved.version===1&&saved.success===true&&state?.storage===raw.identity&&!state.owner)return {...saved,skipped:true};
  throw Error('An earlier rehearsal needs operator review');
 }
 const control=await createMediaControl(db,raw.identity),storage=trackedStorage(db,raw,control);
 const cleanup=photoDeletion({db,storage,mediaControl:control});
 const report={version:1,success:false,startedAt:new Date().toISOString(),revision,steps:[],providerSwitched:false};
 let lease;
 const step=async(name,fn)=>{const began=Date.now();await fn();report.steps.push({name,milliseconds:Date.now()-began});};
 const ownerWrite=fn=>control.run('staging-rehearsal',fn,{owner:lease.owner});
 const repository=path.join(root,'repository'),offline=path.join(root,'offline'),album=id();
 let first,second,firstPhoto,secondPhoto;
 const upload=async(color,name)=>{
  const buffer=await sharp({create:{width:640,height:480,channels:3,background:color}}).jpeg().toBuffer();
  return ownerWrite(()=>uploadPhoto({db,storage,albumId:album,file:{buffer,originalname:name},uploadKey:randomUUID(),policy:'skip',sectionId:null,trace:quietUploadTrace}));
 };
 try{
  lease=await control.acquire('render-rehearsal-'+randomUUID(),3600000);
  await step('maintenance-drain-and-fence',async()=>{
   await waitForWriters(control,lease,{timeoutMs:60000});
   await cleanup.cleanup(true,{owner:lease.owner});await control.assertDrained(lease,{queue:true});
   const other=await createMediaControl(db,raw.identity);
   try{await assert.rejects(other.run('simulated-existing-instance',async()=>assert.fail('A locked write entered')),{code:'MEDIA_LOCKED'});}finally{await other.close();}
  });
  await step('synthetic-album-and-first-snapshot',async()=>{
   await ownerWrite(()=>db.run("INSERT INTO albums(id,title,category,status,created) VALUES(?,?,?,'draft',?)",[album,'Synthetic Render ops rehearsal','test',new Date().toISOString()]));
   firstPhoto=await upload('#227744','synthetic-before-snapshot.jpg');assert.equal(firstPhoto.success,true);
   await ownerWrite(()=>db.run('INSERT INTO selections(album_id,photo_id,updated) VALUES(?,?,?)',[album,firstPhoto.id,new Date().toISOString()]));
   first=await createBackup({db,storage:raw,control,cleanup:cleanup.cleanup,root:repository,appRevision:revision,existingLease:lease});
   await verifyBackup(repository,first);
  });
  await step('new-write-after-snapshot-and-final-delta',async()=>{
   secondPhoto=await upload('#3366aa','synthetic-after-snapshot.jpg');assert.equal(secondPhoto.success,true);
   second=await createBackup({db,storage:raw,control,cleanup:cleanup.cleanup,root:repository,appRevision:revision,existingLease:lease});
   const delta=manifestDelta(first,second);assert.equal(delta.added.length,3);assert.equal(delta.changed.length,0);assert.equal(delta.removed.length,0);
   assert.ok(delta.added.every(key=>key.startsWith(secondPhoto.id)));
   const snapshot=await verifyBackup(repository,second);assert.equal(snapshot.tables.photos.filter(p=>p.album_id===album).length,2);
   report.deltaObjects=delta.added.length;report.backupObjects=second.objects.length;
   await exportBackup(repository,offline,second.runId);
  });
  await step('offline-missing-file-and-deleted-album-recovery',async()=>{
   const damaged=path.join(root,'damaged'),restored=path.join(root,'restored');
   await restoreBackup(offline,damaged,second.runId);
   await unlink(path.join(damaged,'uploads',firstPhoto.id+'.webp'));
   const damagedDb=await openDatabase(damaged,{url:null,initialize:false});
   try{await damagedDb.run('DELETE FROM albums WHERE id=?',[album]);assert.equal((await damagedDb.all('SELECT id FROM photos WHERE album_id=?',[album])).length,0);}finally{await damagedDb.close();}
   // Recovery uses only the exported repository into a new destination. Neither
   // the damaged copy nor source storage is consulted during restore/verification.
   await restoreBackup(offline,restored,second.runId);
   for(const object of second.objects)assert.equal(sha256(await readFile(path.join(restored,'uploads',object.key))),object.sha256);
   const restoredDb=await openDatabase(restored,{url:null,initialize:false});
   try{
    assert.equal((await restoredDb.all('SELECT id FROM photos WHERE album_id=?',[album])).length,2);
    assert.equal((await restoredDb.all('SELECT photo_id FROM selections WHERE album_id=?',[album])).length,1);
    assert.equal((await restoredDb.all('SELECT token FROM sessions')).length,0);
   }finally{await restoredDb.close();}
   report.offlineRecoveredPhotos=2;report.offlineSessionsRevoked=true;
  });
  await step('verified-copy-without-provider-switch',async()=>{
   const target=createStorage(path.join(root,'copy'),{MEDIA_STORAGE_PROVIDER:'local'});
   const copied=await copyToStorage(offline,target,{runId:second.runId,reportFile:path.join(root,'copy.json'),check:()=>control.assertLease(lease)});
   assert.equal(copied.state,'verified');assert.equal(copied.verified.length,second.objects.length);
   assert.equal((await control.status()).control.storage,raw.identity);
  });
  await step('remove-only-owned-fixtures-and-drain',async()=>{
   // Delete references while holding our writer; cleanup runs afterward with the
   // same owner. No other album or stored media is selected for deletion here.
   await ownerWrite(()=>db.transaction(async tx=>{
    const photos=await tx.all('SELECT * FROM photos WHERE album_id=?',[album]);
    for(const photo of photos)await tx.run('INSERT INTO photo_cleanup(photo_id,filename,has_download) VALUES(?,?,?)',[photo.id,photo.filename,photo.download_bytes==null?0:1]);
    await tx.run('DELETE FROM albums WHERE id=?',[album]);
   }));
   await cleanup.cleanup(true,{owner:lease.owner});await control.assertDrained(lease,{queue:true});
   for(const photo of [firstPhoto,secondPhoto])for(const suffix of ['.webp','-thumb.webp','-download.jpg']){
    await assert.rejects(raw.get(photo.id+suffix),error=>['ENOENT','STORAGE_NOT_FOUND'].includes(error.code)||error.storageStatus===404);
   }
  });
  report.success=true;report.finishedAt=new Date().toISOString();
  // Publish under the fence before releasing. A failed commit retains the lock;
  // a repeat run refuses a completed report whose lock still needs recovery.
  // The report has no data, URLs or credentials.
  await control.fenced(lease,async tx=>{
   await tx.run('INSERT INTO settings(key,value) VALUES(?,?)',[reportKey,JSON.stringify(report)]);
  });
  await control.release(lease);
  return report;
 }catch(error){
  // Retain the lease on every failure, including ambiguous object/database I/O.
  // Operators must inspect/reconcile and explicitly recover it after expiry.
  console.error(JSON.stringify({rehearsal:'failed',maintenanceLockRetained:!!lease,completedSteps:report.steps.length}));
  throw error;
 }finally{await cleanup.close();await control.close();}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 let db,raw;
 try{
  assertStagingEnvironment(process.env);
  const root=await mkdtemp(path.join(tmpdir(),'chicong-staging-ops-'));
  db=await openDatabase(root,{url:process.env.DATABASE_URL,initialize:false});
  raw=createStorage('/unused',process.env);await raw.init();
  const report=await runRehearsal({db,raw,root,revision:process.env.RENDER_GIT_COMMIT||'unknown'});
  console.log(JSON.stringify({rehearsal:'complete',skipped:report.skipped===true,steps:report.steps.length,deltaObjects:report.deltaObjects,providerSwitched:false,reportKey}));
 }catch{
  // Error messages from a provider can contain connection details. Persist only
  // the safe summary above; no raw exception or credential reaches hosted logs.
  console.error('STAGING_REHEARSAL_FAILED');process.exitCode=1;
 }finally{raw?.close?.();await db?.close();}
}
