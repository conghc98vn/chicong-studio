import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {uploadTrace} from '../server/upload-trace.mjs';
function fixture(logger){const req=Object.assign(new EventEmitter(),{method:'POST',path:'/api/admin/portrait',complete:false,get:()=> 'untrusted\nfilename.jpg secret'}),res=Object.assign(new EventEmitter(),{statusCode:200,headers:{},set(k,v){this.headers[k]=v;}});let next=false;uploadTrace(logger)(req,res,()=>next=true);assert.ok(next);return {req,res};}
test('Upload heartbeat reports the current stage and stops on response or disconnect',t=>{
 t.mock.timers.enable({apis:['setInterval']});
 for(const event of ['finish','close']){const entries=[],{req,res}=fixture(e=>entries.push(e));req.uploadTrace.mark('receive_body');t.mock.timers.tick(15000);assert.equal(entries.at(-1).event,'waiting');assert.equal(entries.at(-1).stage,'receive_body');assert.doesNotMatch(JSON.stringify(entries),/untrusted|filename|secret/);res.emit(event);const count=entries.length;t.mock.timers.tick(30000);assert.equal(entries.length,count);assert.equal(entries.at(-1).body_received,false);}
});
test('A broken logger cannot interrupt uploads; storage HTTP errors retain safe context',async()=>{
 const a=fixture(()=>{throw Error('logger down');});assert.equal(await a.req.uploadTrace.run('decode',async()=>42),42);a.res.emit('finish');
 const events=[],b=fixture(e=>events.push(e));await assert.rejects(b.req.uploadTrace.run('store_webp',async()=>{throw Object.assign(Error('private credentials'),{storageStatus:507});}));assert.equal(events.at(-1).storage_status,507);assert.doesNotMatch(JSON.stringify(events),/private|credentials/);b.res.emit('close');
});
