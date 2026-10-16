import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,readdir,unlink} from 'node:fs/promises';
import path from 'node:path';
import {openDatabase} from '../server/db.mjs';
import {createStorage} from '../server/storage.mjs';
import {mediaType} from '../server/r2-storage.mjs';

export const tables=['settings','admins','albums','album_sections','album_slugs','photos','selections','sessions','photo_upload_receipts','photo_cleanup','inquiries','blocked_dates','rate_limits','media_control','media_writers','media_writes','backup_runs'];
export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
export const jsonBytes=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
export async function atomicFile(file,bytes){await mkdir(path.dirname(file),{recursive:true,mode:0o700});const tmp=file+'.'+randomUUID()+'.tmp';await writeFile(tmp,bytes,{flag:'wx',mode:0o600});await rename(tmp,file);}
export async function databaseSnapshot(db){
 return db.transaction(async tx=>{
  if(tx.cloud)await tx.exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const found=tx.cloud?(await tx.all("SELECT tablename AS name FROM pg_tables WHERE schemaname=current_schema()")):(await tx.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"));
  if(found.some(r=>!tables.includes(r.name)))throw Error('Unrecognized database tables: update the backup schema before proceeding');
  const data={};for(const table of tables)data[table]=await tx.all('SELECT * FROM '+table);
  return {schemaVersion:1,capturedAt:new Date().toISOString(),tables:data};
 });
}
export function mediaReferences(snapshot){
 const files=new Map();
 const add=(key,role,photo,bytes)=>{
  const contentType=mediaType(key),ref={role,albumId:photo?.album_id||null,photoId:photo?.id||null,filename:photo?.filename||key.slice(0,32)};
  if(files.has(key)){files.get(key).references.push(ref);return;}
  files.set(key,{key,contentType,expectedBytes:bytes==null?null:Number(bytes),references:[ref]});
 };
 for(const p of snapshot.tables.photos){
  add(p.filename+'.webp','image',p,p.image_bytes);add(p.filename+'-thumb.webp','thumbnail',p,p.thumb_bytes);
  if(p.download_bytes!=null)add(p.filename+'-download.jpg','download',p,p.download_bytes);
 }
 const portrait=snapshot.tables.settings.find(s=>s.key==='portrait')?.value;if(portrait)add(portrait+'.webp','portrait');
 return [...files.values()].sort((a,b)=>a.key.localeCompare(b.key));
}
export const mappingHash=snapshot=>sha256(jsonBytes(mediaReferences(snapshot)));
const missing=error=>error.code==='ENOENT'||error.code==='STORAGE_NOT_FOUND'||error.storageStatus===404;
export async function inventory(db,storage){
 const snapshot=await databaseSnapshot(db),references=mediaReferences(snapshot),objects=await storage.list();
 const referenced=new Set(references.map(r=>r.key)),listed=new Map(objects.map(o=>[o.key,o]));
 return {version:1,created:new Date().toISOString(),storage:storage.identity,mappingHash:mappingHash(snapshot),references,missing:references.filter(o=>!listed.has(o.key)).map(o=>o.key),unreferenced:objects.filter(o=>!referenced.has(o.key)),cleanup:snapshot.tables.photo_cleanup,unknown:snapshot.tables.media_writes.filter(o=>o.state!=='stored'),objectCount:objects.length,listedBytes:objects.reduce((n,o)=>n+(o.bytes||0),0),estimatedSourceReads:references.length,estimatedSourceBytes:references.reduce((n,o)=>n+(listed.get(o.key)?.bytes||0),0),note:'Read-only inventory; no object bytes read. Mutable listings require a final locked snapshot.'};
}
export async function putBlob(root,hash,bytes){
 if(sha256(bytes)!==hash)throw Error('Blob checksum mismatch');
 const file=path.join(root,'blobs',hash);
 try{if(sha256(await readFile(file))!==hash)throw Error('Existing backup blob is corrupt');}
 catch(error){if(error.code!=='ENOENT')throw error;await atomicFile(file,bytes);}
 return file;
}
export function validateManifest(manifest){
 if(manifest?.version!==1||manifest.state!=='complete'||!/^[-a-zA-Z0-9_]+$/.test(manifest.runId)||!Array.isArray(manifest.objects)||!Number.isFinite(Date.parse(manifest.capturedAt)))throw Error('Invalid complete backup manifest');
 if(!/^[a-f0-9]{64}$/.test(manifest.databaseSha256))throw Error('Invalid database checksum');
 const keys=new Set();for(const o of manifest.objects){if(keys.has(o.key)||mediaType(o.key)!==o.contentType||!Number.isSafeInteger(o.bytes)||o.bytes<1||!/^[a-f0-9]{64}$/.test(o.sha256))throw Error('Invalid manifest object');keys.add(o.key);}
 return manifest;
}
export async function readBackup(root,runId){
 if(!runId){const names=(await readdir(path.join(root,'snapshots'))).filter(n=>/^[a-zA-Z0-9_-]+\.json$/.test(n));const manifests=await Promise.all(names.map(async name=>validateManifest(JSON.parse(await readFile(path.join(root,'snapshots',name),'utf8')))));manifests.sort((a,b)=>Date.parse(b.capturedAt)-Date.parse(a.capturedAt));if(!manifests.length)throw Error('No complete backup');return manifests[0];}
 if(!/^[-a-zA-Z0-9_]+$/.test(runId))throw Error('Invalid backup run ID');
 return validateManifest(JSON.parse(await readFile(path.join(root,'snapshots',runId+'.json'),'utf8')));
}
export async function verifyBackup(root,manifest){
 validateManifest(manifest);
 const bytes=await readFile(path.join(root,'blobs',manifest.databaseSha256));if(sha256(bytes)!==manifest.databaseSha256)throw Error('Database checksum mismatch');
 const snapshot=JSON.parse(bytes);if(snapshot.schemaVersion!==1||tables.some(t=>!Array.isArray(snapshot.tables[t])))throw Error('Unsupported database snapshot');
 if(mappingHash(snapshot)!==manifest.mappingHash)throw Error('Snapshot/manifest mapping mismatch');
 const refs=mediaReferences(snapshot);if(refs.length!==manifest.objects.length||refs.some(ref=>!manifest.objects.some(o=>o.key===ref.key&&o.contentType===ref.contentType&&(ref.expectedBytes==null||ref.expectedBytes===o.bytes))))throw Error('Snapshot requires missing or different renditions');
 for(const o of manifest.objects){const bytes=await readFile(path.join(root,'blobs',o.sha256));if(bytes.length!==o.bytes||sha256(bytes)!==o.sha256)throw Error('Media checksum mismatch: '+o.key);}
 return snapshot;
}
export async function waitForWriters(control,lease,{timeoutMs=30000}={}){
 const deadline=Date.now()+timeoutMs;
 for(;;){await control.assertLease(lease);const state=await control.status();if(!state.writers.length){if(state.unknown.length)throw Error('Unresolved storage writes block backup');return;}if(Date.now()>=deadline)throw Error('Media drain timed out; maintenance lock retained');await new Promise(r=>setTimeout(r,100));}
}
export async function createBackup({db,storage,control,cleanup,root,appRevision='unknown',ttlMs=3600000,publish,existingLease}){
 const runId=new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID();
 const lease=existingLease||await control.acquire(runId,ttlMs);
 await control.assertLease(lease);
 let complete=false;
 try{
  await db.run("INSERT INTO backup_runs(id,created,state) VALUES(?,?,'running')",[runId,Date.now()]);
  await waitForWriters(control,lease);
  await cleanup?.(true,{owner:lease.owner});
  await control.assertDrained(lease,{queue:true});
  const snapshot=await databaseSnapshot(db),dbBytes=jsonBytes(snapshot),databaseSha256=sha256(dbBytes);
  await putBlob(root,databaseSha256,dbBytes);
  const objects=[];
  // Keep media locked throughout this first implementation. Reuse verified local
  // blobs only when the immutable object key and source identity both match.
  const previous=await readBackup(root).catch(error=>{if(error.code==='ENOENT'||error.message==='No complete backup')return null;throw error;});
  for(const ref of mediaReferences(snapshot)){
   await control.assertLease(lease);
   const old=previous?.storage===storage.identity?previous.objects.find(o=>o.key===ref.key):null;
   let bytes;
   if(old){try{bytes=await readFile(path.join(root,'blobs',old.sha256));if(sha256(bytes)!==old.sha256||bytes.length!==old.bytes)throw Error('Backup blob corrupted');}catch(error){if(error.code!=='ENOENT')throw error;}}
   if(!bytes)bytes=await storage.get(ref.key);
   if(ref.expectedBytes!=null&&bytes.length!==ref.expectedBytes)throw Error('Snapshot media size mismatch: '+ref.key);
   const digest=sha256(bytes);await putBlob(root,digest,bytes);objects.push({...ref,bytes:bytes.length,sha256:digest});
   await atomicFile(path.join(root,'runs',runId+'.json'),jsonBytes({runId,state:'copying',copied:objects.length,total:mediaReferences(snapshot).length}));
  }
  const manifest={version:1,state:'complete',runId,capturedAt:snapshot.capturedAt,appRevision,storage:storage.identity,mappingHash:mappingHash(snapshot),databaseSha256,objects};
  await verifyBackup(root,manifest);await control.assertDrained(lease,{queue:true});
  await control.fenced(lease,async(tx,check)=>{
   if(publish)await publish(manifest,lease,check);
   await atomicFile(path.join(root,'snapshots',runId+'.json'),jsonBytes(manifest));
   await tx.run("UPDATE backup_runs SET state='complete',manifest_hash=? WHERE id=?",[sha256(jsonBytes(manifest)),runId]);
  });complete=true;
  return manifest;
 }catch(error){await unlink(path.join(root,'snapshots',runId+'.json')).catch(()=>{});await db.run("UPDATE backup_runs SET state='failed',detail='Backup incomplete; inspect runner report' WHERE id=?",[runId]).catch(()=>{});throw error;}
 finally{
  // Failure releases only a healthy, drained lease. Ambiguous writes and dead
  // writers stay visible and protected until an operator reconciles them.
  try{if(!existingLease)await control.release(lease);}catch{if(complete)throw Error('Backup saved but maintenance lock needs recovery');}
 }
}
export async function exportBackup(root,destination,runId){
 const manifest=await readBackup(root,runId);await verifyBackup(root,manifest);
 await mkdir(destination,{recursive:false,mode:0o700});
 for(const digest of new Set([manifest.databaseSha256,...manifest.objects.map(o=>o.sha256)]))await putBlob(destination,digest,await readFile(path.join(root,'blobs',digest)));
 await atomicFile(path.join(destination,'snapshots',manifest.runId+'.json'),jsonBytes(manifest));
 await atomicFile(path.join(destination,'RESTORE.txt'),Buffer.from('Contains a complete independent website backup, including credentials and customer data. Keep private. Use the matching application revision: '+manifest.appRevision+'\nnode studio/tools/media-ops.mjs restore --repository THIS_DIRECTORY --target NEW_EMPTY_DIRECTORY\nSessions and operational locks are reset. No network credentials are required for local restore.\n'));
 await verifyBackup(destination,manifest);return manifest;
}
export async function restoreBackup(root,destination,runId){
 const manifest=await readBackup(root,runId),snapshot=await verifyBackup(root,manifest);
 // Refuse any existing destination; never overwrite a live DB or inherit .env.
 await mkdir(destination,{recursive:false,mode:0o700});
 const storage=createStorage(path.join(destination,'uploads'),{MEDIA_STORAGE_PROVIDER:'local'});
 for(const o of manifest.objects)await storage.put(o.key,await readFile(path.join(root,'blobs',o.sha256)));
 const db=await openDatabase(destination,{url:null});
 try{await db.transaction(async tx=>{
  for(const table of [...tables].reverse())await tx.run('DELETE FROM '+table);
  for(const table of tables){
   if(['sessions','rate_limits','photo_cleanup','media_control','media_writers','media_writes'].includes(table))continue;
   for(const original of snapshot.tables[table]){
    const row=table==='backup_runs'&&original.state==='running'?{...original,state:'failed',detail:'Restored snapshot of incomplete run'}:original;
    const columns=Object.keys(row);if(columns.some(c=>!/^[_a-z]+$/.test(c)))throw Error('Invalid snapshot column');
    await tx.run('INSERT INTO '+table+'('+columns.join(',')+') VALUES('+columns.map(()=>'?').join(',')+')',columns.map(c=>row[c]));
   }
  }
 });}finally{await db.close();}
 await atomicFile(path.join(destination,'RESTORED.json'),jsonBytes({runId:manifest.runId,appRevision:manifest.appRevision,sessionsRevoked:true,cleanupReset:true}));return manifest;
}
export async function copyToStorage(root,storage,{runId,reportFile,check=async()=>{},providerSettled=false}={}){
 const manifest=await readBackup(root,runId);await verifyBackup(root,manifest);
 if(reportFile){
  let prior;try{prior=JSON.parse(await readFile(reportFile,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  if(prior&&(prior.target!==storage.identity||prior.runId!==manifest.runId))throw Error('Copy report belongs to another target or snapshot');
  if(prior?.pending&&!providerSettled)throw Error('Previous PUT outcome is unknown; reconcile provider before resuming');
 }
 const report={version:1,runId:manifest.runId,target:storage.identity,mappingHash:manifest.mappingHash,verified:[],state:'copying'};
 for(const o of manifest.objects){
  await check();let found;
  try{found=await storage.get(o.key);}catch(error){if(!missing(error))throw error;}
  if(found){if(found.length!==o.bytes||sha256(found)!==o.sha256)throw Error('Destination content conflict: '+o.key);}
  else{
   // Never retry a timed-out PUT automatically. Persist the key before sending.
   report.pending=o.key;if(reportFile)await atomicFile(reportFile,jsonBytes(report));
   await storage.put(o.key,await readFile(path.join(root,'blobs',o.sha256)));
   found=await storage.get(o.key);if(found.length!==o.bytes||sha256(found)!==o.sha256)throw Error('Destination checksum mismatch: '+o.key);
  }
  const info=await storage.stat(o.key);if(info.contentType!==o.contentType||info.bytes!==o.bytes)throw Error('Destination metadata mismatch: '+o.key);
  report.verified.push(o.key);delete report.pending;if(reportFile)await atomicFile(reportFile,jsonBytes(report));
 }
 await check();report.unreferenced=(await storage.list()).filter(o=>!manifest.objects.some(ref=>ref.key===o.key));report.state='verified';report.verifiedAt=new Date().toISOString();if(reportFile)await atomicFile(reportFile,jsonBytes(report));return report;
}
export function manifestDelta(before,after){
 const old=new Map(before.objects.map(o=>[o.key,o.sha256])),current=new Map(after.objects.map(o=>[o.key,o.sha256]));
 return {added:[...current.keys()].filter(k=>!old.has(k)),changed:[...current.keys()].filter(k=>old.has(k)&&old.get(k)!==current.get(k)),removed:[...old.keys()].filter(k=>!current.has(k))};
}
export function retentionPlan(manifests,now=Date.now()){
 const sorted=[...manifests].map(validateManifest).sort((a,b)=>Date.parse(b.capturedAt)-Date.parse(a.capturedAt));
 const day=86400000,offset=7*3600000,cutoff=Math.floor((now+offset)/day)*day-offset-29*day;
 const keep=sorted.filter((m,i)=>i===0||Date.parse(m.capturedAt)>=cutoff),drop=sorted.filter(m=>!keep.includes(m));
 const refs=m=>[m.databaseSha256,...m.objects.map(o=>o.sha256)];
 const protectedBlobs=new Set(keep.flatMap(refs));
 return {keep,drop,unreferenced:[...new Set(drop.flatMap(refs))].filter(h=>!protectedBlobs.has(h))};
}
