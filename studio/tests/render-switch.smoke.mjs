#!/usr/bin/env node
// Explicit rehearsal only: a private PostgreSQL schema and synthetic object keys.
// R2 -> ephemeral local -> R2 is not the Supabase migration or a multi-instance gate.
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
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
import {mediaType} from '../server/r2-storage.mjs';
import {createBackup,verifyBackup,copyToStorage,manifestDelta,waitForWriters,databaseSnapshot,mappingHash,sha256,tables} from '../tools/media-backup.mjs';

export const reportKey='render_staging_switch_rehearsal_v1';
const publicTables=['settings','admins','albums','photos','selections','inquiries','blocked_dates','album_slugs','album_sections','media_control'];
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const missing=error=>['ENOENT','STORAGE_NOT_FOUND'].includes(error.code)||error.storageStatus===404;
const fingerprint=async db=>{
 const result={};
 for(const table of publicTables){const rows=await db.all('SELECT * FROM public.'+table+(table==='settings'?' WHERE key<>?':''),table==='settings'?[reportKey]:[]);result[table]=sha256(Buffer.from(rows.map(row=>JSON.stringify(canonical(row))).sort().join('\n')));}
 return result;
};
export function assertSwitchEnvironment(env){
 if(env.RENDER_STAGING_SWITCH_REHEARSAL!=='synthetic-schema-roundtrip-v1')throw Error('Explicit synthetic-schema-roundtrip-v1 opt-in required');
 if(env.RENDER_EXTERNAL_URL!=='https://chicong-r2-staging.onrender.com'||env.SITE_URL!=='https://chicong-r2-staging.onrender.com')throw Error('The exact Render staging service URL is required');
 if(env.MEDIA_STORAGE_PROVIDER!=='r2'||env.R2_BUCKET!=='chicong-staging'||env.R2_ENDPOINT!=='https://a1876d723b5894ad77c864e4c35063bf.r2.cloudflarestorage.com')throw Error('The exact staging R2 account/bucket is required');
 let url;try{url=new URL(env.DATABASE_URL);}catch{throw Error('Staging PostgreSQL URL required');}
 if(!['postgres:','postgresql:'].includes(url.protocol)||decodeURIComponent(url.pathname)!=='/chicong_r2_staging_db')throw Error('Database must be chicong_r2_staging_db');
 if(url.searchParams.has('options'))throw Error('Ambient PostgreSQL options are forbidden');
}

// Tests inject a disposable local storage and loopback PG. The guarded CLI below
// is the only entry point that builds actual Render/R2 dependencies.
export async function runRoundTrip({databaseUrl,source,root,revision='unknown'}){
 const publicUrl=new URL(databaseUrl);publicUrl.searchParams.set('options','-c search_path=public');
 const pub=await openDatabase(root,{url:publicUrl.href,initialize:false});
 let db,markerValue,ownsMarker=false,schema,lease,ownership,report;
 const controls=[],cleaners=[];
 const stopPrivate=async()=>{for(const cleaner of cleaners)await cleaner.close();for(const control of controls)await control.close();await db?.close();db=null;};
 try{
  const claimed=await pub.transaction(async tx=>{
   await tx.get('SELECT pg_advisory_xact_lock(hashtext(?))',[reportKey]);
   const prior=await tx.get('SELECT value FROM public.settings WHERE key=?',[reportKey]);
   if(prior){const saved=JSON.parse(prior.value);if(saved.version===1&&saved.success===true&&saved.schemaRemoved===true)return {saved};throw Error('Incomplete switch rehearsal requires operator review; never recreate its local provider');}
   schema='r2_switch_'+randomUUID().replaceAll('-','');
   const marker={version:1,success:false,state:'running',schema,startedAt:new Date().toISOString(),revision};markerValue=JSON.stringify(marker);
   await tx.run('INSERT INTO public.settings(key,value) VALUES(?,?)',[reportKey,markerValue]);
   return {marker};
  });
  if(claimed.saved)return {...claimed.saved,skipped:true};
  ownsMarker=true;
  report={...claimed.marker,sourceProvider:source.provider,physicalR2:source.provider==='r2',syntheticOnly:true,steps:[],publicFingerprintTables:publicTables,limitations:['Single-process synthetic R2/local round trip in an isolated PostgreSQL schema','Does not satisfy Supabase-to-R2 migration or cross-instance production gates']};
  const before=await fingerprint(pub);
  assert.match(schema,/^r2_switch_[a-f0-9]{32}$/);
  await pub.exec('CREATE SCHEMA '+schema);
  const privateUrl=new URL(databaseUrl);privateUrl.searchParams.set('options','-c search_path='+schema);
  db=await openDatabase(root,{url:privateUrl.href});
  assert.equal((await db.get('SELECT current_schema() AS schema')).schema,schema);
  assert.equal((await db.get('SHOW search_path')).search_path,schema);
  const album=id(),booking=id(),session=id();
  ownership={album,booking,session,keys:[],sourceAttempts:[],localDirectory:path.join(root,'local'),schema};
  const keys=new Set(),sourceAttempts=new Set();
  const saveOwnership=()=>db.run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',['switch_rehearsal_ownership',JSON.stringify(ownership)]);
  await saveOwnership();
  const remember=async(key,inSource=false)=>{
   mediaType(key);keys.add(key);ownership.keys=[...keys];
   if(inSource){sourceAttempts.add(key);ownership.sourceAttempts=[...sourceAttempts];}
   await saveOwnership();
  };
  const owned=key=>{mediaType(key);assert.ok(keys.has(key),'Unowned object access refused');};
  const guardedSource={...source,
   async put(key,bytes,options){
    if(!sourceAttempts.has(key)){
     try{await source.get(key);throw Error('Refusing to overwrite a preexisting object');}catch(error){if(!missing(error))throw error;}
    }
    await remember(key,true);return source.put(key,bytes,options);
   },
   async get(key,options){owned(key);return source.get(key,options);},
   async stat(key,options){owned(key);return source.stat(key,options);},
   async remove(key,options){owned(key);assert.ok(sourceAttempts.has(key),'Refusing to remove an object never written by this run');return source.remove(key,options);},
   async list(){return (await source.list()).filter(object=>keys.has(object.key));}
  };
  const localRaw=createStorage(ownership.localDirectory,{MEDIA_STORAGE_PROVIDER:'local'});
  const local={...localRaw,async put(key,bytes,options){await remember(key);return localRaw.put(key,bytes,options);},async remove(key,options){owned(key);return localRaw.remove(key,options);}};
  const context=async raw=>{
   const control=await createMediaControl(db,raw.identity),storage=trackedStorage(db,raw,control),cleanup=photoDeletion({db,storage,mediaControl:control});controls.push(control);cleaners.push(cleanup);return {raw,control,storage,cleanup};
  };
  let active=await context(guardedSource);const staleSource=active;
  lease=await active.control.acquire('switch-rehearsal-'+randomUUID(),3600000);
  const write=fn=>active.control.run('controlled-switch-rehearsal',fn,{owner:lease.owner});
  const step=async(name,fn)=>{const started=Date.now();await fn();report.steps.push({name,milliseconds:Date.now()-started});};
  const upload=async(color,filename,policy='skip')=>{
   const buffer=await sharp({create:{width:640,height:480,channels:3,background:color}}).jpeg().toBuffer();
   return write(()=>uploadPhoto({db,storage:active.storage,albumId:album,file:{buffer,originalname:filename},uploadKey:randomUUID(),policy,sectionId:null,trace:quietUploadTrace}));
  };
  const repository=path.join(root,'repository');let initial,final,first,second,firstFilename;
  const backup=()=>createBackup({db,storage:active.raw,control:active.control,cleanup:active.cleanup.cleanup,root:repository,appRevision:revision,existingLease:lease});
  await step('isolated-source-fixture-and-snapshot',async()=>{
   await waitForWriters(active.control,lease);await active.control.assertDrained(lease,{queue:true});
   await write(async()=>{
    await db.run("INSERT INTO albums(id,title,category,status,created) VALUES(?,?,?,'draft',?)",[album,'Synthetic isolated storage switch','test',new Date().toISOString()]);
    await db.run('INSERT INTO sessions(token,album_id,expires) VALUES(?,?,?)',[session,album,Date.now()+3600000]);
   });
   first=await upload('#226644','kept-selected.jpg');assert.equal(first.success,true);firstFilename=(await db.get('SELECT filename FROM photos WHERE id=?',[first.id])).filename;
   await write(()=>db.run('INSERT INTO selections(album_id,photo_id,updated) VALUES(?,?,?)',[album,first.id,new Date().toISOString()]));
   initial=await backup();assert.equal(initial.objects.length,3);await verifyBackup(repository,initial);
  });
  await step('verified-source-to-local-switch-and-stale-source-fence',async()=>{
   const copied=await copyToStorage(repository,local,{runId:initial.runId,reportFile:path.join(root,'to-local.json'),check:()=>active.control.assertLease(lease)});assert.equal(copied.state,'verified');
   assert.equal(mappingHash(await databaseSnapshot(db)),initial.mappingHash);await active.control.assertDrained(lease,{queue:true});await active.control.switchStorage(lease,local.identity);
   await assert.rejects(staleSource.control.run('stale-source-write',()=>assert.fail('Stale source writer entered'),{owner:lease.owner}),{code:'STORAGE_BINDING_MISMATCH'});
   await assert.rejects(staleSource.cleanup.cleanup(true,{owner:lease.owner}),{code:'STORAGE_BINDING_MISMATCH'});await staleSource.cleanup.close();
   active=await context(local);
  });
  await step('local-new-data-overwrite-delete-and-final-delta',async()=>{
   second=await upload('#3355aa','new-after-switch.jpg');assert.equal(second.success,true);
   const replaced=await upload('#883355','kept-selected.jpg','overwrite');assert.equal(replaced.id,first.id);assert.equal(replaced.replaced,true);
   assert.notEqual((await db.get('SELECT filename FROM photos WHERE id=?',[first.id])).filename,firstFilename);
   const disposable=await upload('#995511','disposable-local.jpg');assert.equal(disposable.success,true);
   await write(()=>db.transaction(async tx=>{
    await tx.get('SELECT id FROM albums WHERE id=? FOR UPDATE',[album]);
    const photo=await tx.get('SELECT * FROM photos WHERE id=?',[disposable.id]);
    await tx.run('INSERT INTO photo_cleanup(photo_id,filename,has_download) VALUES(?,?,1)',[photo.id,photo.filename]);await tx.run('DELETE FROM photos WHERE id=?',[photo.id]);
    await tx.run('INSERT INTO selections(album_id,photo_id,updated) VALUES(?,?,?)',[album,second.id,new Date().toISOString()]);
    await tx.run("INSERT INTO inquiries(id,name,email,service,message,status,created) VALUES(?,?,?,?,?,'new',?)",[booking,'Synthetic booking','synthetic@example.invalid','test','Created after storage switch',new Date().toISOString()]);
   }));
   await active.cleanup.cleanup(true,{owner:lease.owner});await active.control.assertDrained(lease,{queue:true});
   final=await backup();await verifyBackup(repository,final);assert.equal(final.objects.length,6);
   const delta=manifestDelta(initial,final);assert.equal(delta.added.length,6);assert.equal(delta.removed.length,3);assert.equal(delta.changed.length,0);
   report.delta={added:6,removed:3,changed:0};
  });
  const staleLocal=active;
  await step('verified-final-copy-and-rollback-with-current-database',async()=>{
   const copied=await copyToStorage(repository,guardedSource,{runId:final.runId,reportFile:path.join(root,'rollback.json'),check:()=>active.control.assertLease(lease)});assert.equal(copied.state,'verified');assert.equal(copied.verified.length,6);
   assert.equal(mappingHash(await databaseSnapshot(db)),final.mappingHash);await active.control.assertDrained(lease,{queue:true});await active.control.switchStorage(lease,guardedSource.identity);
   await assert.rejects(staleLocal.control.run('stale-local-write',()=>assert.fail('Stale local writer entered'),{owner:lease.owner}),{code:'STORAGE_BINDING_MISMATCH'});
   await assert.rejects(staleLocal.cleanup.cleanup(true,{owner:lease.owner}),{code:'STORAGE_BINDING_MISMATCH'});await staleLocal.cleanup.close();
   active=await context(guardedSource);
   assert.equal((await db.all('SELECT id FROM photos WHERE album_id=?',[album])).length,2);assert.equal((await db.all('SELECT photo_id FROM selections WHERE album_id=?',[album])).length,2);
   assert.ok(await db.get('SELECT id FROM inquiries WHERE id=?',[booking]));assert.ok(await db.get('SELECT token FROM sessions WHERE token=?',[session]));
   for(const object of final.objects){assert.equal(sha256(await active.raw.get(object.key)),object.sha256);const metadata=await active.raw.stat(object.key);assert.equal(metadata.bytes,object.bytes);assert.equal(metadata.contentType,object.contentType);}
   report.preserved={photos:2,selections:2,postSwitchBookings:1,sessions:1};report.finalObjectsVerified=6;
  });
  await step('cleanup-explicit-owned-objects-only',async()=>{
   await active.control.assertDrained(lease,{queue:true});
   await write(()=>db.transaction(async tx=>{await tx.run('DELETE FROM sessions WHERE token=?',[session]);await tx.run('DELETE FROM inquiries WHERE id=?',[booking]);await tx.run('DELETE FROM albums WHERE id=?',[album]);}));
   for(const key of sourceAttempts)await write(()=>active.storage.remove(key));
   for(const key of sourceAttempts)await assert.rejects(source.get(key),missing);
   await active.control.assertDrained(lease,{queue:true});
   report.ownedKeys=keys.size;report.sourceKeysRemoved=sourceAttempts.size;
   assert.deepEqual(await fingerprint(pub),before);report.publicFingerprintUnchanged=true;
   const found=await db.all('SELECT tablename AS name FROM pg_tables WHERE schemaname=current_schema()');assert.deepEqual(found.map(row=>row.name).sort(),[...tables].sort());
  });
  // All private controls are closed before their schema can disappear. Drop and
  // public success marker commit together; any failure preserves the held lease.
  await stopPrivate();
  await rm(root,{recursive:true,force:true});
  report.success=true;report.state='complete';report.schemaRemoved=true;report.finishedAt=new Date().toISOString();
  await pub.transaction(async tx=>{
   const changed=await tx.run('UPDATE public.settings SET value=? WHERE key=? AND value=?',[JSON.stringify(report),reportKey,markerValue]);assert.equal(changed.changes,1);
   await tx.exec('DROP SCHEMA '+schema+' CASCADE');
  });
  return report;
 }catch(error){
  if(ownsMarker){
   const failure={...report,success:false,state:'failed',maintenanceLockRetained:!!lease,finishedAt:new Date().toISOString(),failureCode:error.code||'SWITCH_REHEARSAL_FAILED'};
   await pub.run('UPDATE public.settings SET value=? WHERE key=? AND value=?',[JSON.stringify(failure),reportKey,markerValue]).catch(()=>{});
  }
  throw error;
 }finally{await stopPrivate();await pub.close();}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 let raw;
 try{
  assertSwitchEnvironment(process.env);
  raw=createStorage('/unused',process.env);await raw.init();
  const root=await mkdtemp(path.join(tmpdir(),'chicong-switch-rehearsal-'));
  const report=await runRoundTrip({databaseUrl:process.env.DATABASE_URL,source:raw,root,revision:process.env.RENDER_GIT_COMMIT||'unknown'});
  console.log(JSON.stringify({rehearsal:'complete',success:report.success,skipped:report.skipped===true,steps:report.steps.length,physicalR2:report.physicalR2,publicFingerprintUnchanged:report.publicFingerprintUnchanged,reportKey}));
 }catch{console.error('STAGING_SWITCH_REHEARSAL_FAILED_OPERATOR_REVIEW_REQUIRED');process.exitCode=1;}
 finally{raw?.close?.();}
}
