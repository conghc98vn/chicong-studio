import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {sha256,jsonBytes,validateManifest,retentionPlan,putBlob,atomicFile,verifyBackup} from './media-backup.mjs';
const base='https://www.googleapis.com/drive/v3';
const safeId=value=>{if(!/^[-a-zA-Z0-9_]+$/.test(value||''))throw Error('Invalid Drive file/folder ID');return value;};
const fields='id,name,size,sha256Checksum,appProperties,parents,mimeType,trashed';
export function driveRepository(env,{fetchImpl=fetch,check=async()=>{}}={}){
 const folder=env.BACKUP_DRIVE_FOLDER_ID;
 if(folder)safeId(folder);
 for(const key of ['BACKUP_DRIVE_CLIENT_ID','BACKUP_DRIVE_CLIENT_SECRET','BACKUP_DRIVE_REFRESH_TOKEN','BACKUP_DRIVE_ACCOUNT_EMAIL'])if(!env[key])throw Error('Missing '+key);
 let token,expires=0,index;
 const accessToken=async()=>{
  if(token&&expires>Date.now()+60000)return token;
  const response=await fetchImpl('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',client_id:env.BACKUP_DRIVE_CLIENT_ID,client_secret:env.BACKUP_DRIVE_CLIENT_SECRET,refresh_token:env.BACKUP_DRIVE_REFRESH_TOKEN}),signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error('Drive OAuth refresh failed (HTTP '+response.status+')');const result=await response.json();
  if(!result.access_token)throw Error('Drive OAuth returned no token');token=result.access_token;expires=Date.now()+Number(result.expires_in||3600)*1000;return token;
 };
 const request=async(url,options={},kind='json')=>{
  await check();const credential=await accessToken();
  const signal=AbortSignal.timeout(60000);
  const response=await fetchImpl(url,{...options,headers:{...options.headers,Authorization:'Bearer '+credential},signal});
  if(!response.ok)throw Error('Drive request failed (HTTP '+response.status+')');
  const result=kind==='buffer'?Buffer.from(await response.arrayBuffer()):kind==='response'?response:response.status===204?null:await response.json();
  await check();return result;
 };
 const account=async()=>{
  const info=await request(base+'/about?fields=user(emailAddress),storageQuota');
  if(info.user?.emailAddress?.toLowerCase()!==env.BACKUP_DRIVE_ACCOUNT_EMAIL.toLowerCase())throw Error('Drive account differs from the configured backup owner');
  return info;
 };
 const initialize=async()=>{
  const info=await account();if(!folder)throw Error('Create and configure a dedicated backup folder first');
  const metadata=await request(base+'/files/'+folder+'?fields=id,mimeType,trashed,appProperties,permissions(type,role)');
  if(metadata.trashed||metadata.mimeType!=='application/vnd.google-apps.folder'||metadata.appProperties?.chicongBackup!=='v1'||!Array.isArray(metadata.permissions)||metadata.permissions.some(p=>p.type!=='user'||p.role!=='owner'))throw Error('Backup folder must be an unshared folder created by this tool');
  return info;
 };
 const createFolder=async()=>{await account();if(folder)throw Error('A backup folder is already configured');return request(base+'/files?fields=id',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'ChiCong website backups',mimeType:'application/vnd.google-apps.folder',appProperties:{chicongBackup:'v1'}})});};
 const list=async()=>{
  if(!folder)throw Error('Missing backup folder');const result=[],tokens=new Set();let pageToken;
  do{
   const query=new URLSearchParams({q:`'${folder}' in parents and trashed = false`,fields:`nextPageToken,incompleteSearch,files(${fields})`,pageSize:'1000',...(pageToken?{pageToken}:{})});
   const page=await request(base+'/files?'+query);
   // Retention may delete blobs shared by multiple snapshots. A partial listing
   // cannot establish which references remain and must never authorize deletion.
   if(page?.incompleteSearch||!Array.isArray(page?.files)||page.files.length>1000)throw Error('Drive backup listing is incomplete');
   result.push(...page.files);pageToken=page.nextPageToken;
   if(pageToken!=null&&(typeof pageToken!=='string'||!pageToken||pageToken.length>2048))throw Error('Drive backup listing is incomplete');
   if(pageToken&&tokens.has(pageToken))throw Error('Drive backup pagination cycle');
   if(pageToken)tokens.add(pageToken);
  }while(pageToken);
  const managed=[],ids=new Set(),names=new Set();
  for(const file of result){
   if(!file||typeof file!=='object')throw Error('Invalid Drive backup metadata');
   const properties=file.appProperties;
   // A malformed snapshot must not disappear from the reference set used by
   // retention. Reserved backup names also detect a lost ownership marker.
   if(properties?.chicongBackup!=='v1'&&!/^(blob|snapshot)-/.test(file.name||''))continue;
   const validName=properties?.kind==='blob'?file.name==='blob-'+properties.sha256:
    properties?.kind==='snapshot'&&/^snapshot-[-a-zA-Z0-9_]+$/.test(file.name);
   if(properties?.chicongBackup!=='v1'||!validName||!/^[a-f0-9]{64}$/.test(properties.sha256)||
    typeof file.id!=='string'||!/^[-a-zA-Z0-9_]+$/.test(file.id)||file.trashed||
    !Array.isArray(file.parents)||!file.parents.includes(folder)||
    !/^\d+$/.test(String(file.size))||!Number.isSafeInteger(Number(file.size))||Number(file.size)<1)
    throw Error('Invalid Drive backup metadata');
   if(ids.has(file.id)||names.has(file.name))throw Error('Duplicate Drive backup file; reconcile before continuing');
   ids.add(file.id);names.add(file.name);managed.push(file);
  }
  index=managed;return index;
 };
 const download=async file=>{
  const data=await request(base+'/files/'+safeId(file.id)+'?alt=media',{},'buffer');
  if(sha256(data)!==file.appProperties?.sha256||Number(file.size)!==data.length)throw Error('Drive file checksum mismatch');return data;
 };
 const upload=async(name,bytes,kind)=>{
  const digest=sha256(bytes);index??=await list();
  const existing=index.filter(f=>f.name===name);
  if(existing.length>1)throw Error('Duplicate Drive backup filename; reconcile before continuing');
  if(existing.length){if(existing[0].appProperties.sha256!==digest)throw Error('Drive backup name/content conflict');await download(existing[0]);return existing[0];}
  // A resumable session accepts a single bounded object body here. Failed uploads
  // are not retried blindly; the next run lists and verifies completed files.
  const response=await request('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields='+encodeURIComponent(fields),{method:'POST',headers:{'Content-Type':'application/json','X-Upload-Content-Type':'application/octet-stream','X-Upload-Content-Length':String(bytes.length)},body:JSON.stringify({name,parents:[folder],appProperties:{chicongBackup:'v1',kind,sha256:digest}})},'response');
  const location=response.headers.get('location');
  if(!location||new URL(location).origin!=='https://www.googleapis.com')throw Error('Invalid Drive resumable upload location');
  const file=await request(location,{method:'PUT',headers:{'Content-Type':'application/octet-stream','Content-Length':String(bytes.length)},body:bytes});
  if(file.appProperties?.sha256!==digest||Number(file.size)!==bytes.length)throw Error('Drive upload metadata mismatch');
  await download(file);index.push(file);return file;
 };
 const manifests=async()=>{
  const files=await list(),result=[];
  for(const file of files.filter(f=>f.appProperties.kind==='snapshot')){
   const manifest=validateManifest(JSON.parse(await download(file)));
   if(file.name!=='snapshot-'+manifest.runId)throw Error('Drive backup manifest/name mismatch');
   result.push({file,manifest});
  }
  return result;
 };
 const publish=async(root,manifest)=>{
  validateManifest(manifest);const info=await initialize();await verifyBackup(root,manifest);await list();
  const hashes=new Set([manifest.databaseSha256,...manifest.objects.map(o=>o.sha256)]);let required=0;
  for(const digest of hashes)if(!index.some(f=>f.name==='blob-'+digest))required+=(await readFile(path.join(root,'blobs',digest))).length;
  required+=jsonBytes(manifest).length+64*1024*1024;
  const quota=info.storageQuota;if(quota?.limit&&Number(quota.limit)-Number(quota.usage)<required)throw Error('Drive capacity insufficient; previous backups retained');
  for(const digest of hashes)await upload('blob-'+digest,await readFile(path.join(root,'blobs',digest)),'blob');
  await check();await upload('snapshot-'+manifest.runId,jsonBytes(manifest),'snapshot');
 };
 const prune=async()=>{
  await initialize();const entries=await manifests(),plan=retentionPlan(entries.map(e=>e.manifest));
  for(const m of plan.drop){const entry=entries.find(e=>e.manifest.runId===m.runId);await request(base+'/files/'+safeId(entry.file.id),{method:'DELETE'});}
  for(const digest of plan.unreferenced){for(const file of index.filter(f=>f.appProperties.kind==='blob'&&f.name==='blob-'+digest))await request(base+'/files/'+safeId(file.id),{method:'DELETE'});}
  index=null;return {kept:plan.keep.length,removed:plan.drop.length};
 };
 const exportLocal=async(root,runId)=>{
  await initialize();const entries=await manifests();entries.sort((a,b)=>Date.parse(b.manifest.capturedAt)-Date.parse(a.manifest.capturedAt));
  const chosen=runId?entries.find(e=>e.manifest.runId===runId):entries[0];if(!chosen)throw Error('No complete Drive backup');const manifest=chosen.manifest;
  for(const digest of new Set([manifest.databaseSha256,...manifest.objects.map(o=>o.sha256)])){
   const matches=index.filter(f=>f.appProperties.kind==='blob'&&f.name==='blob-'+digest);if(matches.length!==1)throw Error('Missing or duplicate Drive blob');await putBlob(root,digest,await download(matches[0]));
  }
  await verifyBackup(root,manifest);await atomicFile(path.join(root,'snapshots',manifest.runId+'.json'),jsonBytes(manifest));return manifest;
 };
 const age=async()=>{await initialize();const entries=await manifests();const last=entries.map(e=>e.manifest).sort((a,b)=>Date.parse(b.capturedAt)-Date.parse(a.capturedAt))[0];return {runId:last?.runId||null,capturedAt:last?.capturedAt||null,ageHours:last?(Date.now()-Date.parse(last.capturedAt))/3600000:null};};
 return {initialize,createFolder,publish,prune,exportLocal,age};
}
