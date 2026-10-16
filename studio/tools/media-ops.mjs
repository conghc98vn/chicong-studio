#!/usr/bin/env node
// Deliberately does not load .env: use an explicit runner/staging env file.
import path from 'node:path';
import {readFile,mkdir,statfs} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {openDatabase} from '../server/db.mjs';
import {createStorage} from '../server/storage.mjs';
import {createMediaControl,trackedStorage} from '../server/media-control.mjs';
import {uploadPhoto} from '../server/photo-upload.mjs';
import {quietUploadTrace} from '../server/upload-trace.mjs';
import {maxUploadBytes} from '../web/upload-policy.mjs';
import {randomUUID} from 'node:crypto';
import {photoDeletion} from '../server/photo-deletion.mjs';
import {inventory,createBackup,readBackup,verifyBackup,exportBackup,restoreBackup,copyToStorage,atomicFile,jsonBytes,sha256,databaseSnapshot,mappingHash,waitForWriters} from './media-backup.mjs';
import {driveRepository} from './drive-backup.mjs';

const [command,...args]=process.argv.slice(2),options={};
for(let i=0;i<args.length;i+=2){if(!/^--[a-z-]+$/.test(args[i])||!args[i+1]||args[i+1].startsWith('--'))throw Error('Use --option value');options[args[i].slice(2)]=args[i+1];}
const required=name=>{if(!options[name])throw Error('Missing --'+name);return options[name];};
const file=name=>path.resolve(required(name));
const out=value=>console.log(JSON.stringify(value,null,2));
const readLease=async()=>JSON.parse(await readFile(file('lease'),'utf8'));
const targetStorage=()=>{
 const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>key.startsWith('TARGET_')).map(([key,value])=>[key.slice(7),value]));
 if(!env.MEDIA_STORAGE_PROVIDER)throw Error('Set TARGET_MEDIA_STORAGE_PROVIDER explicitly');
 if(env.MEDIA_STORAGE_PROVIDER==='local'&&!options['target-media'])throw Error('Set --target-media for a local copy target');
 return createStorage(options['target-media']?path.resolve(options['target-media']):'/unused',env);
};
let db,cleanup,raw;
try{
 if(command==='help'||!command){out({commands:['inventory --output report.json','status','lock --lease lease.json','drain --lease lease.json','unlock --lease lease.json','recover --lease new-lease.json --writers-stopped yes (expired lease only; confirm processes stopped)','reconcile --lease lease.json --provider-settled yes','probe-upload --lease lease.json --album DRAFT_ID --file IMAGE [--policy skip|overwrite] [--upload-key KEY]','backup --repository DIR [--drive yes] [--lease lease.json]','verify --repository DIR [--run ID]','export --repository DIR --target NEW_DIR [--run ID]','restore --repository DIR --target NEW_DIR [--run ID]','copy --repository DIR --report report.json (TARGET_* environment)','switch --repository DIR --report report.json --lease lease.json (TARGET_* environment)','drive-init','drive-export --repository DIR [--run ID]','drive-status [--max-age-hours N]'],note:'Commands never implicitly read .env. Production requires an explicit provider. Keep runner credentials separate from website runtime.'});}
 else if(['verify','export','restore','copy'].includes(command)){
  const root=file('repository');
  if(command==='verify'){const manifest=await readBackup(root,options.run);await verifyBackup(root,manifest);out({verified:true,runId:manifest.runId,objects:manifest.objects.length});}
  if(command==='export')out({runId:(await exportBackup(root,file('target'),options.run)).runId,independent:true});
  if(command==='restore')out({runId:(await restoreBackup(root,file('target'),options.run)).runId,sessionsRevoked:true});
  if(command==='copy'){const storage=targetStorage();try{await storage.init();out(await copyToStorage(root,storage,{runId:options.run,reportFile:file('report'),providerSettled:options['provider-settled']==='yes'}));}finally{storage.close?.();}}
 }
 else if(command?.startsWith('drive-')){
  const drive=driveRepository(process.env);
  if(command==='drive-init')out(await drive.createFolder());
  else if(command==='drive-export')out({runId:(await drive.exportLocal(file('repository'),options.run)).runId});
  else if(command==='drive-status'){const status=await drive.age();out(status);if(options['max-age-hours']){const max=Number(options['max-age-hours']);if(!Number.isFinite(max)||max<=0)throw Error('Invalid maximum backup age');if(status.ageHours==null||status.ageHours>max)process.exitCode=2;}}
  else throw Error('Unknown Drive command');
 }
 else{
  if(!['inventory','status','lock','drain','unlock','recover','reconcile','probe-upload','backup','switch'].includes(command))throw Error('Unknown command');
  if(!process.env.MEDIA_STORAGE_PROVIDER)throw Error('Set MEDIA_STORAGE_PROVIDER explicitly');
  const dir=path.resolve(process.env.DATA_DIR||'data/live');
  raw=createStorage(path.join(dir,'uploads'),process.env);
  db=await openDatabase(dir,{url:process.env.DATABASE_URL||null,initialize:false});
  const control=await createMediaControl(db,raw.identity),storage=trackedStorage(db,raw,control);
  cleanup=photoDeletion({db,storage,mediaControl:control}); // no initialize: no background startup
  if(command==='status')out(await control.status());
  if(command==='inventory'){
   const report=await inventory(db,raw);await atomicFile(file('output'),jsonBytes(report));out({objects:report.objectCount,bytes:report.listedBytes,missing:report.missing.length,unreferenced:report.unreferenced.length,sourceReadsForCopy:report.estimatedSourceReads});
  }
  if(command==='lock'){const target=file('lease');const lease=await control.acquire('operator-'+randomUUID(),Number(options['ttl-ms']||3600000));try{await atomicFile(target,jsonBytes(lease));}catch(error){await control.release(lease);throw error;}out({locked:true});}
  if(command==='drain'){const lease=await readLease();await waitForWriters(control,lease);await cleanup.cleanup(true,{owner:lease.owner});await control.assertDrained(lease,{queue:true});out({drained:true});}
  if(command==='unlock'){await control.release(await readLease());out({unlocked:true});}
  if(command==='recover'){const target=file('lease');const lease=await control.recover({writersStopped:options['writers-stopped']==='yes'});await atomicFile(target,jsonBytes(lease));out({recovered:true,locked:true,next:'Reconcile, drain, then unlock with the new lease'});}
  if(command==='reconcile'){
   const lease=await readLease();await control.assertLease(lease);const state=await control.status();
   if(state.writers.length)throw Error('Stop and reconcile active writers first');
   if(options['provider-settled']!=='yes')throw Error('Explicit provider-settled confirmation required; HEAD 404 alone is insufficient');
   for(const write of state.unknown){
    if(write.storage!==raw.identity)throw Error('Write belongs to a different provider');let bytes;
    try{bytes=await raw.get(write.key);}catch(error){if(!['ENOENT','STORAGE_NOT_FOUND'].includes(error.code)&&error.storageStatus!==404)throw error;}
    if(bytes&&(bytes.length!==Number(write.bytes)||sha256(bytes)!==write.sha256))throw Error('Object checksum conflict');
    const prefix=write.key.slice(0,32),used=await db.get('SELECT id FROM photos WHERE filename=?',[prefix])||await db.get("SELECT key FROM settings WHERE key='portrait' AND value=?",[prefix]);
    if(!bytes&&used)throw Error('A referenced object is missing; restore before resolving');
    await control.assertLease(lease);
    if(bytes)await db.run("UPDATE media_writes SET state='stored' WHERE key=?",[write.key]);else await db.run('DELETE FROM media_writes WHERE key=?',[write.key]);
    if(!used)await db.run('INSERT INTO photo_cleanup(photo_id,filename,has_download) VALUES(?,?,1) ON CONFLICT(photo_id) DO NOTHING',[prefix,prefix]);
   }
   out({reconciled:state.unknown.length});
  }
  if(command==='probe-upload'){
   const lease=await readLease();await control.assertLease(lease);
   const albumId=required('album'),policy=options.policy||'skip',uploadKey=options['upload-key']||randomUUID();
   if(!['skip','overwrite'].includes(policy)||! /^[a-f0-9-]{32,64}$/.test(uploadKey))throw Error('Invalid probe upload policy/key');
   const album=await db.get('SELECT id,status FROM albums WHERE id=?',[albumId]);if(!album||album.status!=='draft')throw Error('Controlled writes require an existing disposable draft album');
   const filename=file('file'),buffer=await readFile(filename);if(buffer.length>maxUploadBytes)throw Error('Probe input exceeds upload limit');
   const result=await control.run('controlled-upload',()=>uploadPhoto({db,storage,albumId,file:{buffer,originalname:path.basename(filename)},uploadKey,policy,sectionId:null,trace:quietUploadTrace}),{owner:lease.owner});
   await control.assertLease(lease);out({uploadKey,...result,locked:true});
  }
  if(command==='backup'){
   const root=file('repository');await mkdir(root,{recursive:true,mode:0o700});
   const info=await inventory(db,raw),space=await statfs(root);
   if(Number(space.bavail)*Number(space.bsize)<info.estimatedSourceBytes+128*1024*1024)throw Error('Insufficient runner disk reserve');
   let revision='unknown';try{revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();}catch{}
   const drive=options.drive==='yes'?driveRepository(process.env):null;
   // Bootstrap the cache from the last successful Drive snapshot. This lets an
   // ephemeral runner reuse bytes without rereading unchanged source objects.
   if(drive){const age=await drive.age();if(age.runId)await drive.exportLocal(root,age.runId);}
   let retentionWarning=false;
   const manifest=await createBackup({db,storage:raw,control,cleanup:cleanup.cleanup,root,appRevision:revision,existingLease:options.lease?await readLease():undefined,publish:drive?async(manifest,lease,check)=>{const guarded=driveRepository(process.env,{check});await guarded.publish(root,manifest);try{await guarded.prune();}catch{retentionWarning=true;}}:undefined});
   out({complete:true,runId:manifest.runId,objects:manifest.objects.length,drive:!!drive,retention:retentionWarning?'needs-attention':'ok'});if(retentionWarning)process.exitCode=2;
  }
  if(command==='switch'){
   const lease=await readLease(),root=file('repository'),storage=targetStorage();
   try{
    await control.assertDrained(lease,{queue:true});const manifest=await readBackup(root,options.run);
    if(mappingHash(await databaseSnapshot(db))!==manifest.mappingHash)throw Error('Live media mapping changed; take a final backup/delta first');
    await storage.init();await copyToStorage(root,storage,{runId:manifest.runId,reportFile:file('report'),providerSettled:options['provider-settled']==='yes',check:()=>control.assertLease(lease)});
    await control.switchStorage(lease,storage.identity);out({switched:true,locked:true,next:'Restart every website instance with the verified target provider. Smoke test while locked, then unlock using the same lease.'});
   }finally{storage.close?.();}
  }
 }
}catch(error){console.error(error.code||'MEDIA_OPERATION_FAILED',error.message);process.exitCode=1;}
finally{await cleanup?.close();raw?.close?.();await db?.close();}
