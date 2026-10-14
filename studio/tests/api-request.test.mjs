import test from 'node:test';
import assert from 'node:assert/strict';
import {api,uploadRequestTimeout} from '../web/api-request.mjs';
const pending=(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
test('Ordinary API requests retain their 12-second timeout',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const promise=api('/api/site',{}, {fetcher:pending}),check=assert.rejects(promise,e=>e.code==='REQUEST_TIMEOUT');t.mock.timers.tick(12000);await check;
});
test('Uploads survive the old deadline and complete with the original multipart identity',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let finish,signal;
 const form=new FormData();form.append('photos',new Blob(['image']),'photo.jpg');
 const promise=api('/api/admin/albums/album/photos',{method:'POST',body:form,headers:{'X-Upload-Keys':'["key"]'}},{timeout:uploadRequestTimeout,fetcher:async(_url,options)=>{signal=options.signal;assert.equal(options.body,form);assert.equal(options.headers['X-Upload-Keys'],'["key"]');assert.equal(options.headers['Content-Type'],undefined);return new Promise(resolve=>finish=resolve);}});
 t.mock.timers.tick(13000);assert.equal(signal.aborted,false);finish(Response.json({uploaded:1,results:[{index:0,success:true}]}));assert.equal((await promise).uploaded,1);
 t.mock.timers.tick(uploadRequestTimeout);assert.equal(signal.aborted,false,'Completion clears the deadline');
});
test('A stalled upload times out after three minutes without reporting success',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const promise=api('/upload',{}, {timeout:uploadRequestTimeout,fetcher:pending}),check=assert.rejects(promise,e=>e.code==='REQUEST_TIMEOUT');t.mock.timers.tick(180000);await check;
});
test('Proxy HTML failures retain HTTP status and JSON partial results remain available',async()=>{
 await assert.rejects(api('/upload',{}, {fetcher:async()=>new Response('<html>Bad gateway</html>',{status:502})}),e=>e.status===502&&e.message.includes('HTTP 502')&&!e.message.includes('<html>'));
 const data={error:'File invalid',results:[{index:0,success:false}]};await assert.rejects(api('/upload',{}, {fetcher:async()=>Response.json(data,{status:422})}),e=>e.status===422&&e.data.results.length===1);
 await assert.rejects(api('/upload',{}, {fetcher:async()=>new Response('invalid JSON')}),e=>e.code==='INVALID_RESPONSE');
});
