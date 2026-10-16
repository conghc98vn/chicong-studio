#!/usr/bin/env node
// Opt-in, exact-staging large synthetic JPEG/prepared upload and receipt rehearsal.
// Load only the two named staging files; never load the application's .env.
import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {largeJpeg} from './fixtures/large-photo.mjs';
import {optimizePhoto} from '../server/image-optimizer.mjs';
import {encodePreparedPhoto,decodePreparedPhoto} from '../server/prepared-photo.mjs';
import {createR2Storage} from '../server/r2-storage.mjs';
import {atomicFile,jsonBytes,sha256} from '../tools/media-backup.mjs';

const base='https://chicong-r2-staging.onrender.com';
const env={...parseEnv(await readFile('.env.r2-staging','utf8')),...parseEnv(await readFile('.env.render-staging','utf8'))};
const prior=JSON.parse(await readFile('output/r2-implementation-2026-10-16/live-render-01/report.json','utf8'));
if(prior.base!==base||prior.success!==true||prior.syntheticOnly!==true||!prior.albumId||prior.photoIds?.length!==2||env.R2_BUCKET!=='chicong-staging'||env.MEDIA_STORAGE_PROVIDER!=='r2'||!env.STAGING_ADMIN_EMAIL||!env.STAGING_ADMIN_PASSWORD)throw Error('Exact successful staging fixture and explicit staging environments required');
const output=path.resolve(process.argv[2]||'output/r2-implementation-2026-10-16/live-render-large-01');
await mkdir(output,{recursive:true,mode:0o700});
const reportPath=path.join(output,'report.json');
let report;
try{report=JSON.parse(await readFile(reportPath,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
if(report&&(report.version!==1||report.base!==base||report.albumId!==prior.albumId))throw Error('Existing report belongs to another rehearsal');
report??={version:1,base,albumId:prior.albumId,syntheticOnly:true,startedAt:new Date().toISOString(),success:false,phase:'preparing',jobs:['jpeg','prepared'].map(kind=>{const uploadKey=randomUUID();return {kind,uploadKey,filename:'synthetic-large-'+kind+'-'+uploadKey+'.jpg',phase:'prepared',attempts:[]};})};
for(const job of report.jobs){assert.ok(['jpeg','prepared'].includes(job.kind));assert.match(job.uploadKey,/^[a-f0-9-]{32,64}$/);assert.equal(job.filename,'synthetic-large-'+job.kind+'-'+job.uploadKey+'.jpg');}
if(report.failure){report.previousFailures=[...(report.previousFailures||[]),report.failure];delete report.failure;}
const save=()=>atomicFile(reportPath,jsonBytes(report));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let admin='';
const raw=createR2Storage(env);
const request=(route,{method='GET',body,headers={}}={})=>fetch(base+route,{method,signal:AbortSignal.timeout(120000),headers:{Origin:base,Cookie:admin,...(body!==undefined&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{}),...headers},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)});
const json=async(route,body,method='GET',headers={})=>{const response=await request(route,{method,body,headers});assert.ok(response.ok,'Staging HTTP status '+response.status);return response.json();};
const albumDetail=()=>json('/api/admin/albums/'+report.albumId);
const summary=status=>({writers:status.writers.length,unknown:status.unknown.length,cleanup:Number(status.cleanup.count),locked:!!status.control.owner});
const waitDrained=async({cleanup=false,timeout=300000}={})=>{
 const deadline=Date.now()+timeout;
 while(Date.now()<deadline){const state=await json('/api/admin/media-status');assert.equal(state.control.owner,null,'Maintenance lock needs operator review');if(!state.writers.length){assert.equal(state.unknown.length,0,'Unknown writes need operator review');if(!cleanup||Number(state.cleanup.count)===0)return state;}await delay(1000);}
 throw Error('Staging writer or cleanup drain timed out');
};
const originalUnchanged=detail=>{const originals=detail.photos.filter(photo=>prior.photoIds.includes(photo.id));assert.equal(originals.length,2);assert.equal(originals.filter(photo=>photo.selected).length,1);};
const send=async(job,bytes)=>{const body=new FormData();body.append('photos',new Blob([bytes],{type:job.kind==='jpeg'?'image/jpeg':'application/x-chicong-photo'}),job.filename+(job.kind==='prepared'?'.ccphoto':''));return json('/api/admin/albums/'+report.albumId+'/photos',body,'POST',{'X-Upload-Keys':JSON.stringify([job.uploadKey]),'X-Duplicate-Policy':'skip'});};
try{
 if(report.success){console.log(JSON.stringify({success:true,skipped:true,report:reportPath}));}
 else{
  await save();
  const sourcePath=path.join(output,'source.jpg'),bundlePath=path.join(output,'prepared.ccphoto');
  let source,bundle;
  try{source=await readFile(sourcePath);}catch(error){if(error.code!=='ENOENT')throw error;source=await largeJpeg();await atomicFile(sourcePath,source);}
  assert.ok(source.length>10*1024*1024&&source.length<20*1024*1024);
  if(report.sourceHash)assert.equal(report.sourceHash,sha256(source));
  report.sourceHash=sha256(source);report.sourceBytes=source.length;
  const sourceMeta=await sharp(source).metadata();report.sourceDimensions={width:sourceMeta.width,height:sourceMeta.height};
  try{bundle=await readFile(bundlePath);}catch(error){if(error.code!=='ENOENT')throw error;const began=Date.now();const prepared=await optimizePhoto(source);report.localPrepareMs=Date.now()-began;bundle=encodePreparedPhoto({originalName:report.jobs.find(job=>job.kind==='prepared').filename,sourceHash:report.sourceHash,...prepared});await atomicFile(bundlePath,bundle);}
  const prepared=await decodePreparedPhoto(bundle);
  assert.equal(prepared.sourceHash,report.sourceHash);assert.equal(prepared.optimization.source_bytes,source.length);
  if(report.preparedHash)assert.equal(report.preparedHash,sha256(bundle));
  report.preparedHash=sha256(bundle);report.preparedBytes=bundle.length;await save();
  const login=await request('/api/admin/login',{method:'POST',body:{email:env.STAGING_ADMIN_EMAIL,password:env.STAGING_ADMIN_PASSWORD}});
  assert.equal(login.status,200);admin=login.headers.get('set-cookie')?.split(';')[0];assert.ok(admin);
  const initial=await waitDrained({cleanup:true});report.initialMediaStatus??=summary(initial);
  const before=await albumDetail();originalUnchanged(before);assert.ok(before.photos.every(photo=>prior.photoIds.includes(photo.id)||report.jobs.some(job=>job.filename===photo.original)),'Unexpected staging album content');
  report.initialObjectKeys??=(await raw.list()).map(object=>object.key).sort();
  report.phase='uploading';await save();
  for(const job of report.jobs){
   const bytes=job.kind==='jpeg'?source:bundle;
   if(job.phase==='prepared'||job.phase==='sending'){
    await waitDrained();
    // Persist identity and in-flight state before each send. Resumption and network
    // timeout retries always use the same key and source; never invent a new key.
    for(let retry=0;retry<2;retry++){
     job.phase='sending';const attempt={startedAt:new Date().toISOString(),pending:true};job.attempts.push(attempt);await save();const began=Date.now();
     try{const response=await send(job,bytes),result=response.results?.[0];assert.equal(result?.success,true);assert.match(result.id,/^[a-f0-9]{32}$/);job.photoId=result.id;job.optimization=result.optimization;attempt.milliseconds=Date.now()-began;attempt.receiptReused=!!result.reused;attempt.pending=false;job.phase='uploaded';await save();break;}
     catch(error){attempt.milliseconds=Date.now()-began;attempt.errorName=error.name;attempt.pending=false;await save();await waitDrained();if(retry===1)throw error;}
    }
   }
   if(job.phase==='uploaded'){
    await waitDrained();assert.equal(job.optimization.source_bytes,source.length);
    const expected=[['.webp','data','image_bytes','webp'],['-thumb.webp','thumbnail','thumb_bytes','webp'],['-download.jpg','download','download_bytes','jpeg']];job.objects=[];
    for(const [suffix,field,sizeField,format] of expected){
     const key=job.photoId+suffix,stored=await raw.get(key),meta=await raw.stat(key),digest=sha256(stored),decoded=await sharp(stored).metadata();
     assert.equal(meta.sha256,digest);assert.equal(meta.bytes,stored.length);assert.equal(stored.length,job.optimization[sizeField]);assert.equal(decoded.format,format);assert.ok(Math.max(decoded.width,decoded.height)<=2400);
     const matchesLocalPrepared=digest===sha256(prepared[field]);if(job.kind==='prepared')assert.equal(matchesLocalPrepared,true,'Prepared bytes must match local rendition exactly');
     job.objects.push({key,bytes:stored.length,sha256:digest,checksumVerified:true,width:decoded.width,height:decoded.height,matchesLocalPrepared});
    }
    const started=Date.now(),retried=(await send(job,bytes)).results?.[0];assert.equal(retried?.success,true);assert.equal(retried.id,job.photoId);assert.equal(retried.reused,true);assert.deepEqual(retried.optimization,job.optimization);job.retry={milliseconds:Date.now()-started,samePhotoId:true,receiptReused:true};
    const detail=await albumDetail();assert.equal(detail.photos.filter(photo=>photo.original===job.filename).length,1);originalUnchanged(detail);job.phase='verified';await save();
   }
  }
  report.phase='cleanup';await save();
  for(const job of report.jobs){
   if(job.phase==='verified'||job.phase==='deleting'){
    const detail=await albumDetail(),owned=detail.photos.find(photo=>photo.id===job.photoId);job.phase='deleting';await save();
    if(owned){assert.equal(owned.original,job.filename);assert.ok(!prior.photoIds.includes(owned.id));await json('/api/admin/photos/'+owned.id,{},'DELETE');}
    job.phase='deleted';await save();
   }
  }
  const finalState=await waitDrained({cleanup:true}),finalAlbum=await albumDetail();originalUnchanged(finalAlbum);assert.equal(finalAlbum.photos.length,2);
  for(const job of report.jobs)assert.ok(!finalAlbum.photos.some(photo=>photo.id===job.photoId));
  const remainingKeys=(await raw.list()).map(object=>object.key).sort();assert.deepEqual(remainingKeys,report.initialObjectKeys,'Only pre-existing staging objects should remain');
  report.finalMediaStatus=summary(finalState);report.remainingPhotos=2;report.remainingSelections=1;report.remainingR2Objects=remainingKeys.length;
  report.limitations='Random encoded pixels exercise bytes, processing and storage integrity; they do not represent customer photo color, detail or typical compression. Timings include the local network and current Render free-instance conditions.';
  report.success=true;report.phase='complete';report.finishedAt=new Date().toISOString();await save();
  console.log(JSON.stringify({success:true,sourceBytes:report.sourceBytes,preparedBytes:report.preparedBytes,jobs:report.jobs.map(job=>({kind:job.kind,attempts:job.attempts,retry:job.retry,verifiedObjects:job.objects.length})),finalMediaStatus:report.finalMediaStatus,report:reportPath}));
 }
}catch(error){report.failure={name:error.name,code:error.code||'STAGING_LARGE_SMOKE_FAILED',at:new Date().toISOString()};await save();console.error(JSON.stringify({success:false,phase:report.phase,failure:report.failure,report:reportPath}));process.exitCode=1;}
finally{raw.close();}
