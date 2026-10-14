import test from 'node:test';
import assert from 'node:assert/strict';
import {maxUploadBytes} from '../web/upload-policy.mjs';
import {UploadQueue,uploadIssue} from '../web/upload-queue.mjs';
import {uploadSelection,uploadReport} from '../web/upload-report.mjs';
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
 const files=[{name:'big.jpg',size:maxUploadBytes+1,type:'image/jpeg'},...Array.from({length:4},(_,i)=>({name:i+'.jpg',size:10*1024*1024,type:'image/jpeg'})),{name:'empty.jpg',size:0}];
 const q=new UploadQueue(files),batches=[];await q.run(async batch=>{batches.push(batch);return ack(batch);});
 assert.deepEqual(batches.map(b=>b.length),[1,1,1,1]);assert.equal(q.done.size,4);assert.equal(q.retryable.length,0);assert.equal(q.pending.length,2);assert.match(q.results.get(files[0]).error,/20 MB/);
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
test('Prepared files accept unknown browser MIME and report actual transfer bytes alongside originals',async()=>{
 const files=[{name:'Ảnh cưới.jpg.CCPHOTO',type:'application/x-ccphoto',size:1000000},{name:'source.jpg',type:'image/jpeg',size:6000000}];
 assert.equal(uploadIssue(files[0]),null);
 assert.match(uploadSelection(files),/7 MB cần tải lên/);
 assert.match(uploadSelection(files),/1 ảnh đã chuẩn bị trên máy; không nén lại/);
 assert.doesNotMatch(uploadSelection(files),/trước tối ưu/);
 const q=new UploadQueue(files);await q.run(async batch=>ack(batch));assert.equal(q.done.size,2);
 assert.match(uploadIssue({...files[0],size:maxUploadBytes+1}),/Gói ảnh vượt quá/);
 assert.match(uploadIssue({...files[0],size:0}),/Tệp rỗng/);
 assert.match(uploadIssue({name:'photo.gif',size:100,type:'image/gif'}),/Chỉ hỗ trợ/);
 const metrics={source_bytes:6000000,image_bytes:300000,thumb_bytes:50000,download_bytes:650000,width:1600,height:2400};
 q.results.set(files[0],{success:true,optimization:metrics});
 assert.match(uploadReport(q),/Ảnh nguồn tương ứng:/);
 assert.doesNotMatch(uploadReport(q),/Tệp đầu vào đã lưu/);
});
test('Malformed acknowledgements stop the queue without falsely saving photos and retain retry keys',async()=>{
 const malformed=[null,{},[],{results:[]},{results:[null]},{results:[{index:0,success:'true'}]},{results:[{index:'0',success:true}]},{results:[{index:-1,success:true}]},{results:[{index:1,success:true}]},{results:[{index:0,success:true},{index:0,success:true}]},{results:[{index:0,success:false,retryable:'false'}]}];
 for(const response of malformed){
  const files=[{name:'first.jpg'},{name:'second.jpg'}],queue=new UploadQueue(files);const keys=files.map(file=>queue.keys.get(file));let sends=0;
  await assert.rejects(queue.run(async()=>{sends++;return response;}),error=>error.code==='INVALID_RESPONSE'&&/Giữ nguyên trang/.test(error.message));
  assert.equal(sends,1);assert.equal(queue.done.size,0);assert.equal(queue.results.get(files[0]).retryable,true);assert.match(queue.results.get(files[0]).error,/chưa xác nhận/);assert.equal(queue.results.has(files[1]),false);
  const retried=[];await queue.run(async(batch,retryKeys)=>{retried.push(...retryKeys);return ack(batch);});assert.deepEqual(retried,keys);assert.equal(queue.done.size,2);
 }
});
test('Transport and HTTP failures are visible per file and retain status for session recovery',async()=>{
 for(const error of [Object.assign(Error('Mạng bị ngắt. Mã kiểm tra: trace-id.'),{code:'UPLOAD_NETWORK_ERROR',requestId:'trace-id'}),Object.assign(Error('Vui lòng đăng nhập lại.'),{status:401,code:'UPLOAD_HTTP_ERROR'})]){
  const file={name:'<img>.jpg'},queue=new UploadQueue([file]);
  await assert.rejects(queue.run(async()=>{throw error;}),failure=>failure.status===error.status&&failure.requestId===error.requestId);
  assert.equal(queue.results.get(file).success,false);assert.equal(queue.results.get(file).retryable,true);assert.match(uploadReport(queue),/upload-file-error/);assert.doesNotMatch(uploadReport(queue),/<img>/);assert.match(uploadReport(queue),error.status?/đăng nhập/:/trace-id/);
 }
});
