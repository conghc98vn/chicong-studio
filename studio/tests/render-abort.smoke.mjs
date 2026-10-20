#!/usr/bin/env node
// Explicit staging-only, synthetic upload cancellation/retry smoke. No .env loading.
import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {atomicFile,jsonBytes,sha256} from '../tools/media-backup.mjs';

const base='https://chicong-r2-staging.onrender.com';
const output=path.resolve(process.argv[2]||'output/r2-implementation-2026-10-16/live-render-abort-01');
const sourcePath=path.resolve('output/r2-implementation-2026-10-16/live-render-01/report.json');
const prior=JSON.parse(await readFile(sourcePath,'utf8'));
if(prior.base!==base||prior.success!==true||prior.syntheticOnly!==true||!prior.albumId||prior.photoIds?.length!==2||process.env.R2_BUCKET!=='chicong-staging'||process.env.MEDIA_STORAGE_PROVIDER!=='r2'||!process.env.STAGING_ADMIN_EMAIL||!process.env.STAGING_ADMIN_PASSWORD)throw Error('Use the exact successful staging fixture and explicit staging environments');
await mkdir(output,{recursive:true,mode:0o700});
const reportPath=path.join(output,'report.json');
let report;
try{report=JSON.parse(await readFile(reportPath,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
if(report&&(report.base!==base||report.albumId!==prior.albumId||report.version!==1))throw Error('Existing report belongs to another rehearsal');
report??={version:1,base,albumId:prior.albumId,syntheticOnly:true,startedAt:new Date().toISOString(),success:false,uploadKey:randomUUID(),attempts:[]};
report.filename??='synthetic-abort-'+report.uploadKey+'.jpg';
assert.match(report.uploadKey,/^[a-f0-9-]{32,64}$/);assert.equal(report.filename,'synthetic-abort-'+report.uploadKey+'.jpg');
if(report.failure){report.previousFailures=[...(report.previousFailures||[]),report.failure];delete report.failure;}
const save=()=>atomicFile(reportPath,jsonBytes(report));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let admin='';
const request=(route,{method='GET',body,headers={},signal}={})=>fetch(base+route,{method,signal:signal||AbortSignal.timeout(120000),headers:{Origin:base,Cookie:admin,...(body!==undefined&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{}),...headers},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)});
const json=async(route,body,method='GET',options={})=>{const response=await request(route,{...options,method,body});assert.ok(response.ok,'Staging HTTP status '+response.status);return response.json();};
const mediaStatus=()=>json('/api/admin/media-status');
const albumDetail=()=>json('/api/admin/albums/'+report.albumId);
const summary=status=>({writers:status.writers.length,unknown:status.unknown.length,cleanup:Number(status.cleanup.count),locked:!!status.control.owner});
const waitDrained=async({timeout=180000,cleanup=false,onStatus=()=>{}}={})=>{
 const end=Date.now()+timeout;
 while(Date.now()<end){const state=await mediaStatus();onStatus(state);assert.equal(state.control.owner,null,'Maintenance lock needs operator review');if(!state.writers.length){assert.equal(state.unknown.length,0,'Unknown writes need operator review');if(!cleanup||Number(state.cleanup.count)===0)return state;}await delay(600);}
 throw Error('Staging writer or cleanup drain timed out');
};
const originalUnchanged=detail=>{
 const originals=detail.photos.filter(photo=>prior.photoIds.includes(photo.id));
 assert.equal(originals.length,2);assert.equal(originals.filter(photo=>photo.selected).length,1);
};
const form=bytes=>{const body=new FormData();body.append('photos',new Blob([bytes],{type:'image/jpeg'}),report.filename);return body;};
const uploadHeaders={'X-Upload-Keys':JSON.stringify([report.uploadKey]),'X-Duplicate-Policy':'skip'};
const uploadRoute='/api/admin/albums/'+report.albumId+'/photos';
try{
 if(report.success){await save();console.log(JSON.stringify({success:true,skipped:true,report:reportPath}));}
 else{
  await save();
  const login=await request('/api/admin/login',{method:'POST',body:{email:process.env.STAGING_ADMIN_EMAIL,password:process.env.STAGING_ADMIN_PASSWORD}});
  assert.equal(login.status,200);admin=login.headers.get('set-cookie')?.split(';')[0];assert.ok(admin);
  const initial=await waitDrained({cleanup:true});report.initialMediaStatus=summary(initial);
  const before=await albumDetail();originalUnchanged(before);assert.ok(before.photos.every(photo=>prior.photoIds.includes(photo.id)||photo.original===report.filename),'Unexpected staging album content');
  const width=2400,height=1600,pixels=Buffer.alloc(width*height*3);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*3;pixels[i]=(x+y)%256;pixels[i+1]=(x*3+y*2)%256;pixels[i+2]=((x>>3)^(y>>3))*7%256;}
  const source=await sharp(pixels,{raw:{width,height,channels:3}}).jpeg({quality:90}).toBuffer();
  if(report.sourceHash)assert.equal(report.sourceHash,sha256(source));
  report.sourceHash=sha256(source);report.sourceBytes=source.length;await save();
  if(!report.phase){
   // A resumed process uses the persisted key/name. It never starts a different
   // upload when the previous response or process exit had an uncertain outcome.
   let existing=before.photos.find(photo=>photo.original===report.filename);
   if(existing&&report.attempts.length){
    const attempt=report.attempts.at(-1);attempt.photoPresentAfterDrain=true;attempt.photoId=existing.id;attempt.completionRecoveredAfterInterruption=true;report.photoId=existing.id;await save();
   }
   for(let number=report.attempts.length;!existing&&number<2;number++){
    const attempt={number:number+1,startedAt:new Date().toISOString(),writerObservedBeforeAbort:false,writerObservedAfterAbort:false};report.attempts.push(attempt);await save();
    const controller=new AbortController(),started=Date.now();let settled=false;
    const pending=request(uploadRoute,{method:'POST',body:form(source),headers:uploadHeaders,signal:AbortSignal.any([controller.signal,AbortSignal.timeout(120000)])}).then(async response=>({status:response.status,result:await response.json()})).catch(error=>({errorName:error.name})).finally(()=>{settled=true;});
    let writer;
    const observationDeadline=Date.now()+15000;
    while(!settled&&Date.now()<observationDeadline){
     const state=await mediaStatus();assert.equal(state.control.owner,null);
     const uploadWriters=state.writers.filter(row=>row.kind==='admin-media');
     assert.ok(uploadWriters.length<=1,'Concurrent admin media operations make this rehearsal inconclusive');
     writer=uploadWriters[0];
     if(writer&&Date.now()-started>=(number===0?3000:5000))break;
     await delay(300);
    }
    attempt.writerObservedBeforeAbort=!!writer;attempt.abortAtMs=Date.now()-started;
    controller.abort();const outcome=await pending;
    attempt.clientAborted=outcome.errorName==='AbortError';attempt.clientOutcome=outcome.errorName||outcome.status;
    const abortedAt=Date.now();
    await waitDrained({onStatus:state=>{
     if(writer&&state.writers.some(row=>row.id===writer.id)){attempt.writerObservedAfterAbort=true;attempt.lastSameWriterAfterAbortMs=Date.now()-abortedAt;}
    }});
    attempt.drainedAfterAbortMs=Date.now()-abortedAt;
    const detail=await albumDetail();existing=detail.photos.find(photo=>photo.original===report.filename);attempt.photoPresentAfterDrain=!!existing;
    if(existing){report.photoId=existing.id;attempt.photoId=existing.id;}
    await save();
    if(attempt.writerObservedAfterAbort)break;
    // If no handler ran and no photo exists, repeat once, observing longer.
    if(existing||settled&&!attempt.clientAborted)break;
   }
   report.phase='upload-drained';await save();
  }
  if(report.phase==='upload-drained'){
   await waitDrained();
   const preRetry=await albumDetail(),existing=preRetry.photos.filter(photo=>photo.original===report.filename);assert.equal(existing.length,1,'Aborted upload did not complete exactly once');
   report.photoId=existing[0].id;
   const began=Date.now(),retry=await json(uploadRoute,form(source),'POST',{headers:uploadHeaders});
   const result=retry.results?.[0];assert.equal(result?.success,true);assert.equal(result.id,report.photoId);assert.equal(result.reused,true);
   report.retry={milliseconds:Date.now()-began,samePhotoId:true,receiptReused:true};
   const secondRetry=await json(uploadRoute,form(source),'POST',{headers:uploadHeaders});assert.equal(secondRetry.results?.[0]?.id,report.photoId);assert.equal(secondRetry.results?.[0]?.reused,true);
   const after=await albumDetail();assert.equal(after.photos.filter(photo=>photo.original===report.filename).length,1);assert.equal(after.photos.length,3);originalUnchanged(after);
   report.phase='verified-before-cleanup';await save();
  }
  if(report.phase==='verified-before-cleanup'){
   const detail=await albumDetail(),owned=detail.photos.find(photo=>photo.id===report.photoId);
   if(owned){assert.equal(owned.original,report.filename);assert.ok(!prior.photoIds.includes(owned.id));await json('/api/admin/photos/'+owned.id,{},'DELETE');}
   report.phase='cleanup-pending';await save();
  }
  if(report.phase==='cleanup-pending'){
   const finalState=await waitDrained({cleanup:true}),finalAlbum=await albumDetail();
   originalUnchanged(finalAlbum);assert.equal(finalAlbum.photos.length,2);assert.ok(!finalAlbum.photos.some(photo=>photo.id===report.photoId));
   report.finalMediaStatus=summary(finalState);report.remainingPhotos=2;report.remainingSelections=1;
   report.abortTrackingObserved=report.attempts.some(attempt=>attempt.clientAborted&&attempt.writerObservedBeforeAbort&&attempt.writerObservedAfterAbort&&attempt.photoPresentAfterDrain);
   report.success=report.abortTrackingObserved&&report.retry?.receiptReused===true;
   report.phase='complete';report.finishedAt=new Date().toISOString();await save();
   if(!report.success)process.exitCode=2;
  }
  console.log(JSON.stringify({success:report.success,abortTrackingObserved:report.abortTrackingObserved,attempts:report.attempts.map(({number,abortAtMs,clientAborted,writerObservedBeforeAbort,writerObservedAfterAbort,lastSameWriterAfterAbortMs,drainedAfterAbortMs,photoPresentAfterDrain})=>({number,abortAtMs,clientAborted,writerObservedBeforeAbort,writerObservedAfterAbort,lastSameWriterAfterAbortMs,drainedAfterAbortMs,photoPresentAfterDrain})),retry:report.retry,finalMediaStatus:report.finalMediaStatus,report:reportPath}));
  if(!report.success)process.exitCode=2;
 }
}catch(error){
 // Preserve journal state for retry/reconciliation without leaking provider,
 // authentication or raw HTTP response details into logs or reports.
 report.failure={name:error.name,code:error.code||'STAGING_ABORT_SMOKE_FAILED',at:new Date().toISOString()};await save();console.error(JSON.stringify({success:false,phase:report.phase||'observing',failure:report.failure,report:reportPath}));process.exitCode=1;
}
