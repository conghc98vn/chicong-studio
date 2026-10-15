import test from 'node:test';
import assert from 'node:assert/strict';
import {uploadRequest,uploadProgressText} from '../web/upload-request.mjs';
import {UploadQueue} from '../web/upload-queue.mjs';
function fixture(){const progress=[],xhr={upload:{},headers:{},open(method,url){this.method=method;this.url=url;},setRequestHeader(k,v){this.headers[k]=v;},send(body){this.body=body;}};const body=new FormData();body.append('photos',new Blob(['sample']),'sample.jpg');const promise=uploadRequest('/upload',{body,headers:{'X-Upload-Keys':'["file-key"]'},onProgress:p=>progress.push(p)},{xhrFactory:()=>xhr,requestId:'trace-id'});return {xhr,promise,body,progress};}
test('Upload tracks sending separately from processing and only resolves on acknowledgement',async()=>{
 const {xhr,promise,body,progress}=fixture();assert.equal(xhr.method,'POST');assert.equal(xhr.body,body);assert.equal(xhr.timeout,180000);assert.equal(xhr.headers['X-Upload-Keys'],'["file-key"]');assert.equal(xhr.headers['X-Upload-Id'],'trace-id');assert.equal(xhr.headers['Content-Type'],undefined);
 xhr.upload.onprogress({loaded:50,total:100,lengthComputable:true});assert.equal(progress.at(-1).phase,'sending');assert.match(uploadProgressText('a.jpg',progress.at(-1)),/50%/);
 xhr.upload.onload();assert.equal(progress.at(-1).phase,'processing');assert.match(uploadProgressText('a.jpg',progress.at(-1)),/chờ máy chủ/);
 assert.match(uploadProgressText('a.jpg.ccphoto',progress.at(-1)),/kiểm tra và lưu ảnh/);
 assert.doesNotMatch(uploadProgressText('a.jpg.ccphoto',progress.at(-1)),/tối ưu/);
 xhr.status=201;xhr.responseText=JSON.stringify({uploaded:1,results:[{index:0,success:true}]});xhr.onload();assert.equal((await promise).uploaded,1);assert.equal(xhr.upload.onload,null);assert.equal(xhr.ontimeout,null);
});
test('Timeout identifies an unfinished transfer versus a missing acknowledgement',async()=>{
 for(const sent of [false,true]){const {xhr,promise}=fixture();if(sent)xhr.upload.onload();const check=assert.rejects(promise,e=>e.code==='UPLOAD_TIMEOUT'&&e.uploadSent===sent&&e.requestId==='trace-id'&&e.message.includes(sent?'Đã gửi dữ liệu':'Chưa gửi xong'));xhr.ontimeout();await check;}
});
test('HTTP, malformed response and connection failures remain distinguishable',async()=>{
 for(const [status,body,code]of [[502,'<html>bad gateway</html>','UPLOAD_HTTP_ERROR'],[422,JSON.stringify({error:'invalid',results:[{index:0,success:false}]}),'UPLOAD_HTTP_ERROR'],[200,'bad json','INVALID_RESPONSE'],[200,'[]','INVALID_RESPONSE'],[200,'null','INVALID_RESPONSE']]){
  const {xhr,promise}=fixture();const check=assert.rejects(promise,e=>e.code===code&&e.message.includes('trace-id')&&!e.message.includes('<html>')&&(status!==422||e.data.results.length===1));xhr.status=status;xhr.responseText=body;xhr.onload();await check;
 }
 for(const event of ['onerror','onabort']){const {xhr,promise}=fixture(),check=assert.rejects(promise,e=>e.code==='UPLOAD_NETWORK_ERROR');xhr[event]();await check;}
});
test('Queue preserves diagnostics and stable retry keys after a transfer timeout',async()=>{
 const file={name:'a.jpg',size:10,type:'image/jpeg'},queue=new UploadQueue([file]),key=queue.keys.get(file);
 await assert.rejects(queue.run(async()=>{throw Object.assign(Error('Chưa gửi xong. Mã kiểm tra: trace-id.'),{code:'UPLOAD_TIMEOUT'});}),/trace-id.*Giữ nguyên trang/);
 assert.equal(queue.done.size,0);await queue.run(async(files,keys)=>{assert.deepEqual(keys,[key]);return {results:[{index:0,success:true}]};});assert.equal(queue.done.size,1);
});
test('uploadRequest abort method cancels XHR and rejects with UPLOAD_NETWORK_ERROR',async()=>{
 const {xhr,promise}=fixture();
 const check=assert.rejects(promise,e=>e.code==='UPLOAD_NETWORK_ERROR');
 promise.abort();
 await check;
});

