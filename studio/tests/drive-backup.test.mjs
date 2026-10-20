import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {driveRepository} from '../tools/drive-backup.mjs';
import {tables,jsonBytes,sha256,putBlob,mappingHash,verifyBackup} from '../tools/media-backup.mjs';
const env={BACKUP_DRIVE_CLIENT_ID:'fixture-client',BACKUP_DRIVE_CLIENT_SECRET:'fixture-secret',BACKUP_DRIVE_REFRESH_TOKEN:'fixture-refresh',BACKUP_DRIVE_ACCOUNT_EMAIL:'fixture@example.test',BACKUP_DRIVE_FOLDER_ID:'folder'};
function mockDrive(){
 const files=new Map(),sessions=new Map(),deleted=[];let next=0,quota='5000000000000',refreshFailure=false,shared=false;
 const response=value=>new Response(JSON.stringify(value));
 const fetchImpl=async(url,options={})=>{
  url=new URL(url);
  if(url.hostname==='oauth2.googleapis.com'){if(refreshFailure)return new Response('{}',{status:400});return response({access_token:'fixture-access-token',expires_in:3600});}
  assert.equal(options.headers.Authorization,'Bearer fixture-access-token');
  if(url.pathname.endsWith('/about'))return response({user:{emailAddress:'fixture@example.test'},storageQuota:{limit:quota,usage:'0'}});
  if(url.pathname.endsWith('/files/folder'))return response({mimeType:'application/vnd.google-apps.folder',appProperties:{chicongBackup:'v1'},permissions:[{type:shared?'anyone':'user',role:shared?'reader':'owner'}]});
  if(url.searchParams.get('uploadType')==='resumable'){const id=String(++next);sessions.set(id,JSON.parse(options.body));return new Response(null,{headers:{location:'https://www.googleapis.com/upload-session/'+id}});}
  if(url.pathname.startsWith('/upload-session/')){const id=url.pathname.split('/').at(-1),bytes=Buffer.from(options.body),file={id,...sessions.get(id),size:String(bytes.length)};files.set(id,{file,bytes});return response(file);}
  if(url.pathname.endsWith('/files'))return response({files:[...files.values()].map(o=>o.file)});
  const id=url.pathname.split('/').at(-1);if(options.method==='DELETE'){deleted.push(id);files.delete(id);return new Response(null,{status:204});}
  if(url.searchParams.get('alt')==='media')return files.has(id)?new Response(files.get(id).bytes):new Response(null,{status:404});
  throw Error('Unexpected mock URL');
 };
 return {files,deleted,fetchImpl,set quota(v){quota=v;},set refreshFailure(v){refreshFailure=v;},set shared(v){shared=v;}};
}
async function snapshot(root,runId,capturedAt){
 const data={schemaVersion:2,capturedAt,tables:Object.fromEntries(tables.map(t=>[t,[]]))};const key='a'.repeat(32);data.tables.settings=[{key:'portrait',value:key}];
 const bytes=Buffer.from('image'),digest=sha256(bytes),dbBytes=jsonBytes(data),databaseSha256=sha256(dbBytes);await putBlob(root,digest,bytes);await putBlob(root,databaseSha256,dbBytes);
 return {version:1,state:'complete',runId,capturedAt,appRevision:'fixture',storage:'fixture-source',mappingHash:mappingHash(data),databaseSha256,objects:[{key:key+'.webp',bytes:5,contentType:'image/webp',sha256:digest}]};
}
test('Drive backup refreshes OAuth, verifies all bytes, deduplicates and exports without source storage',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'drive-backup-')),mock=mockDrive();try{
  const drive=driveRepository(env,{fetchImpl:mock.fetchImpl}),first=await snapshot(root,'first',new Date().toISOString());await drive.publish(root,first);assert.equal(mock.files.size,3);
  await drive.publish(root,first);assert.equal(mock.files.size,3);
  const exported=path.join(root,'offline');await drive.exportLocal(exported);await verifyBackup(exported,first);assert.equal((await drive.age()).runId,'first');
  mock.quota='1';const second=await snapshot(root,'second',new Date().toISOString());await assert.rejects(drive.publish(root,second),/capacity/);assert.equal(mock.files.size,3);assert.equal(mock.deleted.length,0);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('Drive retention removes only expired snapshot references and protects shared media',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'drive-retention-')),mock=mockDrive();try{
  const drive=driveRepository(env,{fetchImpl:mock.fetchImpl}),old=await snapshot(root,'old','2020-01-01T00:00:00Z'),current=await snapshot(root,'current',new Date().toISOString());await drive.publish(root,old);await drive.publish(root,current);
  assert.equal(mock.files.size,5);const result=await drive.prune();assert.deepEqual(result,{kept:1,removed:1});assert.equal(mock.files.size,3);assert.equal((await drive.age()).runId,'current');assert.ok([...mock.files.values()].some(o=>o.file.name==='blob-'+old.objects[0].sha256));
 }finally{await rm(root,{recursive:true,force:true});}
});
test('Drive rejects public folders, wrong account, failed refresh and lost lease before publication',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'drive-errors-'));try{
  const mock=mockDrive();mock.shared=true;await assert.rejects(driveRepository(env,{fetchImpl:mock.fetchImpl}).initialize(),/unshared/);mock.shared=false;
  await assert.rejects(driveRepository({...env,BACKUP_DRIVE_ACCOUNT_EMAIL:'wrong@example.test'},{fetchImpl:mock.fetchImpl}).initialize(),/owner/);
  mock.refreshFailure=true;await assert.rejects(driveRepository(env,{fetchImpl:mock.fetchImpl}).initialize(),/refresh/);mock.refreshFailure=false;
  const manifest=await snapshot(root,'lost',new Date().toISOString());await assert.rejects(driveRepository(env,{fetchImpl:mock.fetchImpl,check:async()=>{throw Error('lease lost');}}).publish(root,manifest),/lease lost/);assert.equal(mock.files.size,0);
 }finally{await rm(root,{recursive:true,force:true});}
});
