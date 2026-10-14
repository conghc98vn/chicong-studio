import test from 'node:test';
import assert from 'node:assert/strict';
import {UploadQueue} from '../web/upload-queue.mjs';
const ack=files=>({results:files.map((_,index)=>({index,success:true}))});
test('Uploads are sequential per photo and retry skips every acknowledged file',async()=>{
 const files=Array.from({length:66},()=>({name:'same.jpg',size:6*1024*1024,type:'image/jpeg'})),q=new UploadQueue(files);let n=0;
 await assert.rejects(q.run(async batch=>{assert.equal(batch.length,1);if(n++===3)throw Error('Offline');return ack(batch);}),/gián đoạn/);assert.equal(q.done.size,3);
 const retried=[];await q.run(async batch=>{assert.equal(batch.length,1);retried.push(...batch);return ack(batch);});assert.deepEqual(retried,files.slice(3));assert.equal(q.pending.length,0);
});
test('Partial success and failed responses preserve exactly the unacknowledged files',async()=>{
 const files=[{name:'same.jpg'},{name:'same.jpg'},{name:'other.jpg'}],q=new UploadQueue(files);
 await q.run(async batch=>({results:[{index:0,success:batch[0]!==files[1]}]}));assert.deepEqual(q.pending,[files[1]]);
 await q.run(async()=>{throw Object.assign(Error('invalid'),{status:422,data:{results:[{index:0,success:false}]}});});assert.deepEqual(q.pending,[files[1]]);assert.equal(q.matches([...files]),true);assert.equal(q.matches([{name:'same.jpg'},...files.slice(1)]),false);
});
test('An unacknowledged retry preserves each file key',async()=>{
 const files=Array.from({length:10},(_,i)=>({name:'photo'+i}));let next=0;const q=new UploadQueue(files,()=>String(next++));let firstKeys;
 await assert.rejects(q.run(async(batch,keys)=>{firstKeys=keys;throw Error('response lost');}),/gián đoạn/);const retried=[];
 await q.run(async(batch,keys)=>{retried.push(...keys);return ack(batch);});assert.deepEqual(retried,files.map(f=>q.keys.get(f)));assert.deepEqual(retried.slice(0,1),firstKeys);assert.equal(q.done.size,10);
});
test('Lightroom files retain order and invalid files do not block good ones',async()=>{
 const files=[{name:'big.jpg',size:9*1024*1024,type:'image/jpeg'},...Array.from({length:4},(_,i)=>({name:i+'.jpg',size:7*1024*1024,type:'image/jpeg'})),{name:'empty.jpg',size:0}];
 const q=new UploadQueue(files),batches=[];await q.run(async batch=>{batches.push(batch);return ack(batch);});
 assert.deepEqual(batches.map(b=>b.length),[1,1,1,1]);assert.equal(q.done.size,4);assert.equal(q.retryable.length,0);assert.equal(q.pending.length,2);assert.match(q.results.get(files[0]).error,/8 MB/);
});
test('Retry retains measurements, retries storage errors and skips permanent decode errors',async()=>{
 const files=[{name:'a.jpg'},{name:'b.jpg'},{name:'c.jpg'}],q=new UploadQueue(files),optimization={source_bytes:6000000,image_bytes:300000,thumb_bytes:50000,width:1600,height:2400};
 await q.run(async batch=>({results:[{index:0,...(batch[0]===files[0]?{success:true,optimization}:batch[0]===files[1]?{success:false,retryable:false,error:'Corrupt'}:{success:false,retryable:true,error:'Storage'})}]}));
 assert.deepEqual(q.retryable,[files[2]]);await q.run(async batch=>{assert.deepEqual(batch,[files[2]]);return ack(batch);});assert.equal(q.results.get(files[0]).optimization,optimization);assert.equal(q.done.size,2);
});
test('Timeout explains uncertain acknowledgement and preserves identity for retry',async()=>{
 const files=[{name:'a.jpg'}],q=new UploadQueue(files),key=q.keys.get(files[0]);
 await assert.rejects(q.run(async()=>{throw Object.assign(Error('timeout'),{code:'REQUEST_TIMEOUT'});}),/3 phút/);assert.equal(q.done.size,0);assert.equal(q.keys.get(files[0]),key);
 await q.run(async(batch,keys)=>{assert.deepEqual(keys,[key]);return ack(batch);});assert.equal(q.done.size,1);
});
