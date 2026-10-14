import test from 'node:test';
import assert from 'node:assert/strict';
import {selectedDownloadParts,downloadFilename,fetchGalleryDownload} from '../web/gallery-download.mjs';

test('Selected download uses every selected photo in order and divides packages at 50',()=>{
 const photos=Array.from({length:103},(_,index)=>({id:String(index),selected:index!==0,section_id:index%2?'ceremony':'portraits'}));
 photos.push({...photos[1]});
 const parts=selectedDownloadParts(photos);
 assert.deepEqual(parts.map(part=>[part.first,part.last,part.ids.length]),[[1,50,50],[51,100,50],[101,102,2]]);
 assert.deepEqual(parts.flatMap(part=>part.ids),photos.slice(1,103).map(photo=>photo.id));
 assert.deepEqual(selectedDownloadParts([{id:'none',selected:false}]),[]);
});

test('Download filenames preserve Unicode and force expected extension without path traversal',()=>{
 assert.equal(downloadFilename("attachment; filename*=UTF-8''C%C3%B4%20d%C3%A2u.jpg",'image/jpeg'),'Cô dâu.jpg');
 assert.equal(downloadFilename('attachment; filename="../../evil.html"','application/zip'),'-..-evil.zip');
 assert.equal(downloadFilename('', 'image/jpeg'),'anh-da-chon.jpg');
 assert.equal(downloadFilename('attachment; filename="photo.jpg"; filename*=UTF-8\'\'%ZZ','image/jpeg'),'photo.jpg');
});

test('Download sends selected snapshot and reads a complete JPEG with progress',async()=>{
 const calls=[],progress=[];
 const result=await fetchGalleryDownload('album-one',['selected-one'],{onProgress:(...args)=>progress.push(args),fetchImpl:async(url,options)=>{
  calls.push({url,options});
  return new Response(new Uint8Array([255,216,255,217]),{headers:{'Content-Type':'image/jpeg','Content-Length':'4','Content-Disposition':'attachment; filename="original.jpg"'}});
 }});
 assert.equal(calls[0].url,'/api/gallery/album-one/download');
 assert.deepEqual(JSON.parse(calls[0].options.body),{photos:['selected-one']});
 assert.equal(calls[0].options.credentials,'same-origin');assert.equal(calls[0].options.cache,'no-store');
 assert.equal(result.filename,'original.jpg');assert.equal(result.blob.type,'image/jpeg');assert.equal(result.blob.size,4);
 assert.deepEqual(progress,[[4,4]]);
});

test('Download keeps actionable server statuses and rejects non-file or incomplete responses',async()=>{
 for(const status of [401,409,422,429])await assert.rejects(fetchGalleryDownload('a',['p'],{fetchImpl:async()=>Response.json({error:'Please retry'},{status})}),error=>error.status===status&&error.message==='Please retry');
 await assert.rejects(fetchGalleryDownload('a',['p'],{fetchImpl:async()=>new Response('<html>',{headers:{'Content-Type':'text/html'}})}),/định dạng/);
 await assert.rejects(fetchGalleryDownload('a',['p'],{fetchImpl:async()=>new Response('short',{headers:{'Content-Type':'image/jpeg','Content-Length':'20'}})}),/chưa đầy đủ/);
 await assert.rejects(fetchGalleryDownload('a',['p'],{fetchImpl:async()=>new Response('',{headers:{'Content-Type':'image/jpeg'}})}),/trống/);
});

test('Download rejects oversized declared and streamed responses and cancels body consumption',async()=>{
 let cancelled=0;
 const stream=()=>new ReadableStream({start(controller){controller.enqueue(new Uint8Array(10));},cancel(){cancelled++;}});
 await assert.rejects(fetchGalleryDownload('a',['p','q'],{maxBytes:5,fetchImpl:async()=>new Response(stream(),{headers:{'Content-Type':'application/zip','Content-Length':'10'}})}),/quá lớn/);
 await assert.rejects(fetchGalleryDownload('a',['p','q'],{maxBytes:5,fetchImpl:async()=>new Response(stream(),{headers:{'Content-Type':'application/zip'}})}),/quá lớn/);
 assert.equal(cancelled,2);
});

test('Download does not hand back a file when user cancelled during transfer',async()=>{
 const controller=new AbortController();let cancelled=false;
 const stream=new ReadableStream({start(s){s.enqueue(new Uint8Array([1]));},cancel(){cancelled=true;}});
 await assert.rejects(fetchGalleryDownload('a',['p'],{signal:controller.signal,onProgress:()=>controller.abort(),fetchImpl:async()=>new Response(stream,{headers:{'Content-Type':'image/jpeg'}})}),{name:'AbortError'});
 assert.equal(cancelled,true);
});

test('Busy downloads honor Retry-After with bounded retries and keep the same selection',async()=>{
 const payloads=[];let waiting=0;
 const result=await fetchGalleryDownload('a',['p'],{onWaiting:()=>waiting++,fetchImpl:async(url,options)=>{
  payloads.push(options.body);
  return payloads.length===1?Response.json({error:'Busy'},{status:429,headers:{'Retry-After':'0.01'}}):new Response('jpeg',{headers:{'Content-Type':'image/jpeg'}});
 }});
 assert.equal(result.blob.size,4);assert.equal(waiting,1);assert.equal(payloads.length,2);assert.equal(payloads[0],payloads[1]);
 let requests=0;
 await assert.rejects(fetchGalleryDownload('a',['p'],{fetchImpl:async()=>{requests++;return Response.json({error:'Busy'},{status:429,headers:{'Retry-After':'0.01'}});}}),error=>error.status===429);
 assert.equal(requests,3,'A busy server cannot cause an endless retry loop');
});

test('Cancelling during a busy download delay prevents another request',async()=>{
 const controller=new AbortController();let requests=0;
 await assert.rejects(fetchGalleryDownload('a',['p'],{signal:controller.signal,onWaiting:()=>setTimeout(()=>controller.abort(),5),fetchImpl:async()=>{
  requests++;return Response.json({error:'Busy'},{status:429,headers:{'Retry-After':'5'}});
 }}),{name:'AbortError'});
 assert.equal(requests,1);
});

 test('Smaller download packages preserve every selected photo and stay within server bounds',()=>{
 const photos=Array.from({length:51},(_,i)=>({id:String(i),selected:true}));
 for(const size of [1,12,25,50,100]){const parts=selectedDownloadParts(photos,size);assert.deepEqual(parts.flatMap(part=>part.ids),photos.map(photo=>photo.id));assert.ok(parts.every(part=>part.ids.length<=Math.min(size,50)));}
 });
