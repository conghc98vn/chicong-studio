import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchPhotoDownload,createPhotoDownloads} from '../web/photo-download.mjs';

const jpeg=new Uint8Array([255,216,255,217]);
const response=(body=jpeg,headers={})=>new Response(body,{headers:{'Content-Type':'image/jpeg','Content-Length':String(jpeg.length),...headers}});
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};

test('Photo download fetches same-origin private and public routes and preserves a Unicode filename',async()=>{
 for(const privateGallery of [true,false]){
  const calls=[],progress=[];
  const file=await fetchPhotoDownload('album / one','photo?one',{privateGallery,onProgress:(...args)=>progress.push(args),fetchImpl:async(url,options)=>{
   calls.push({url,options});return response(jpeg,{'Content-Disposition':"attachment; filename*=UTF-8''C%C3%B4%20d%C3%A2u.jpg"});
  }});
  assert.equal(calls[0].url,`/api/${privateGallery?'gallery':'albums'}/album%20%2F%20one/photos/photo%3Fone/download`);
  assert.equal(calls[0].options.method,'GET');assert.equal(calls[0].options.credentials,'same-origin');assert.equal(calls[0].options.cache,'no-store');
  assert.equal(file.filename,'Cô dâu.jpg');assert.equal(file.blob.type,'image/jpeg');assert.deepEqual(new Uint8Array(await file.blob.arrayBuffer()),jpeg);assert.deepEqual(progress,[[4,4]]);
 }
});

test('Photo download rejects JSON, invalid JPEG signatures, empty and truncated files',async()=>{
 for(const status of [401,404,429,503])await assert.rejects(fetchPhotoDownload('a','p',{fetchImpl:async()=>Response.json({error:'Actionable error'},{status})}),error=>error.status===status&&error.message==='Actionable error');
 for(const invalid of [new Response('<html>'),response(new TextEncoder().encode('<html>'),{'Content-Length':'6'})])await assert.rejects(fetchPhotoDownload('a','p',{fetchImpl:async()=>invalid}),/định dạng/);
 await assert.rejects(fetchPhotoDownload('a','p',{fetchImpl:async()=>response(new Uint8Array(),{'Content-Length':'0'})}),/trống/);
 await assert.rejects(fetchPhotoDownload('a','p',{fetchImpl:async()=>response(jpeg,{'Content-Length':'10'})}),/chưa đầy đủ/);
});

test('Photo download enforces declared and streamed byte ceilings and cancels failed bodies',async()=>{
 let cancelled=0;
 const stream=()=>new ReadableStream({start(controller){controller.enqueue(jpeg);},cancel(){cancelled++;}});
 for(const headers of [{'Content-Length':'4'},{}])await assert.rejects(fetchPhotoDownload('a','p',{maxBytes:3,fetchImpl:async()=>new Response(stream(),{headers:{'Content-Type':'image/jpeg',...headers}})}),error=>error.status===413);
 assert.equal(cancelled,2);
});

test('Photo download retries busy responses a bounded number of times and cancellation stops its delay',async()=>{
 let calls=0,waiting=0;
 const file=await fetchPhotoDownload('a','p',{onWaiting:()=>waiting++,fetchImpl:async()=>++calls===1?Response.json({error:'Busy'},{status:429,headers:{'Retry-After':'0.001'}}):response()});
 assert.equal(calls,2);assert.equal(waiting,1);assert.equal(file.blob.size,4);
 calls=0;
 await assert.rejects(fetchPhotoDownload('a','p',{fetchImpl:async()=>{calls++;return Response.json({error:'Busy'},{status:429,headers:{'Retry-After':'0.001'}});}}),error=>error.status===429);assert.equal(calls,3);
 const controller=new AbortController();calls=0;
 await assert.rejects(fetchPhotoDownload('a','p',{signal:controller.signal,onWaiting:()=>controller.abort(),fetchImpl:async()=>{calls++;return Response.json({error:'Busy'},{status:429,headers:{'Retry-After':'5'}});}}),{name:'AbortError'});assert.equal(calls,1);
});

test('Aborting a stalled stream cancels its reader without handing off a partial image',async()=>{
 const controller=new AbortController(),started=deferred();let cancelled=0;
 const pending=fetchPhotoDownload('a','p',{signal:controller.signal,onProgress:()=>started.resolve(),fetchImpl:async()=>new Response(new ReadableStream({start(stream){stream.enqueue(jpeg);},cancel(){cancelled++;}}),{headers:{'Content-Type':'image/jpeg'}})});
 await started.promise;controller.abort();await assert.rejects(pending,{name:'AbortError'});assert.equal(cancelled,1);
});

test('Photo controller ignores repeated clicks and saves one complete file',async()=>{
 const release=deferred(),states=[],saved=[];let calls=0;
 const downloads=createPhotoDownloads({onState:state=>states.push(state),saveFile:file=>saved.push(file),fetchImpl:async()=>{calls++;await release.promise;return response();}});
 try{
  const pending=downloads.download({albumId:'a',photoId:'p'});assert.equal(downloads.busy,true);
  assert.equal(await downloads.download({albumId:'a',photoId:'p'}),false);assert.equal(calls,1);
  release.resolve();assert.equal(await pending,true);assert.equal(downloads.busy,false);assert.equal(saved.length,1);
  assert.deepEqual(states.map(state=>state.phase),['preparing','progress','saved','idle']);
 }finally{downloads.dispose();}
});

test('Photo controller keeps expired sessions and server errors in the current page',async()=>{
 let expired=0,saved=0;
 const states=[],downloads=createPhotoDownloads({onExpired:()=>expired++,onState:state=>states.push(state),saveFile:()=>saved++,fetchImpl:async()=>Response.json({error:'Expired'},{status:401})});
 try{assert.equal(await downloads.download({albumId:'a',photoId:'p'}),false);assert.equal(expired,1);assert.equal(saved,0);assert.equal(downloads.busy,false);}finally{downloads.dispose();}
 const errors=[],broken=createPhotoDownloads({onState:state=>errors.push(state),saveFile:()=>saved++,fetchImpl:async()=>{throw TypeError('network');}});
 try{assert.equal(await broken.download({albumId:'a',photoId:'p'}),false);assert.match(errors.find(state=>state.phase==='error').message,/Kết nối bị gián đoạn/);assert.equal(saved,0);}finally{broken.dispose();}
});

test('Closing or disposing a photo download cancels pending work and prevents file handoff',async()=>{
 for(const action of ['close','dispose']){
  let signal,saved=0;const started=deferred(),states=[];
  const downloads=createPhotoDownloads({onState:state=>states.push(state),saveFile:()=>saved++,fetchImpl:async(_url,options)=>{
   signal=options.signal;started.resolve();await new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
  }});
  try{
   const pending=downloads.download({albumId:'a',photoId:'p'});await started.promise;downloads[action]();assert.equal(await pending,false);
   assert.equal(signal.aborted,true);assert.equal(saved,0);assert.equal(downloads.busy,false);
   assert.equal(states.some(state=>state.phase==='cancelled'),action==='close');
  }finally{downloads.dispose();}
 }
});

test('Photo controller times out stalled work with an actionable retry message',async()=>{
 const states=[],downloads=createPhotoDownloads({timeout:5,onState:state=>states.push(state),saveFile:()=>assert.fail('Must not save'),fetchImpl:async(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))});
 try{assert.equal(await downloads.download({albumId:'a',photoId:'p'}),false);assert.match(states.find(state=>state.phase==='error').message,/mất quá lâu/);assert.equal(downloads.busy,false);}finally{downloads.dispose();}
});

test('Default saver uses a temporary Blob link and releases its object URL on page hide',async()=>{
 const listeners=new Map(),links=[],revoked=[],states=[];
 const windowImpl={addEventListener:(event,listener)=>listeners.set(event,listener),removeEventListener:(event)=>listeners.delete(event)};
 const documentImpl={body:{append:link=>links.push(link)},createElement:()=>({click(){this.clicked=true;},remove(){this.removed=true;}})};
 const urlImpl={createObjectURL:blob=>{assert.equal(blob.type,'image/jpeg');return 'blob:test';},revokeObjectURL:url=>revoked.push(url)};
 const downloads=createPhotoDownloads({windowImpl,documentImpl,urlImpl,onState:state=>states.push(state),fetchImpl:async()=>response(jpeg,{'Content-Disposition':'attachment; filename="../../bad.html"'})});
 try{
  assert.equal(await downloads.download({albumId:'a',photoId:'p'}),true);
  assert.equal(links.length,1);assert.equal(links[0].href,'blob:test');assert.match(links[0].download,/\.jpg$/);assert.doesNotMatch(links[0].download,/[\\/]/);assert.equal(links[0].clicked,true);assert.equal(links[0].removed,true);
  listeners.get('pagehide')();assert.deepEqual(revoked,['blob:test']);
 }finally{downloads.dispose();}
 assert.equal(listeners.size,0);
});
