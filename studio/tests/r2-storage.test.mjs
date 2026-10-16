import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createHash} from 'node:crypto';
import {createStorage} from '../server/storage.mjs';
import {createR2Storage} from '../server/r2-storage.mjs';
const env={R2_ENDPOINT:'https://'+'a'.repeat(32)+'.r2.cloudflarestorage.com',R2_BUCKET:'private-test',R2_ACCESS_KEY_ID:'fixture-access',R2_SECRET_ACCESS_KEY:'fixture-secret'},key='a'.repeat(32)+'.webp';
test('R2 rejects missing config and never falls back to local or Supabase',()=>{
 for(const change of [{R2_ENDPOINT:''},{R2_BUCKET:'../bad'},{R2_SECRET_ACCESS_KEY:''},{R2_ENDPOINT:'https://aws.example'}])assert.throws(()=>createR2Storage({...env,...change}));
 assert.throws(()=>createStorage('/unused',{NODE_ENV:'production',SUPABASE_URL:'https://test.supabase.co'}),/MEDIA_STORAGE_PROVIDER/);
 assert.throws(()=>createStorage('/unused',{NODE_ENV:'production',MEDIA_STORAGE_PROVIDER:'local'}),/persistent/);
 assert.throws(()=>createStorage('/unused',{MEDIA_STORAGE_PROVIDER:'typo'}));
 const storage=createStorage('/unused',{MEDIA_STORAGE_PROVIDER:'r2',...env,SUPABASE_URL:'invalid'});assert.equal(storage.provider,'r2');storage.close();
});
test('R2 preserves bytes and MIME, SHA metadata, paginated inventory, and never creates buckets',async()=>{
 const calls=[],files=new Map();const client={send:async command=>{
  const type=command.constructor.name,input=command.input;calls.push(type);assert.equal(input.Bucket,env.R2_BUCKET);
  if(type==='HeadBucketCommand')return {};
  if(type==='PutObjectCommand'){assert.equal(input.ContentType,'image/webp');assert.equal(input.Metadata.sha256,createHash('sha256').update(input.Body).digest('hex'));files.set(input.Key,input);return {};}
  if(type==='GetObjectCommand'){const o=files.get(input.Key);return {Body:Readable.from([o.Body]),ContentType:o.ContentType,ContentLength:o.Body.length,Metadata:o.Metadata};}
  if(type==='HeadObjectCommand'){const o=files.get(input.Key);return {ContentType:o.ContentType,ContentLength:o.Body.length,Metadata:o.Metadata};}
  if(type==='ListObjectsV2Command')return input.ContinuationToken?{Contents:[],IsTruncated:false}:{Contents:[{Key:key,Size:5}],IsTruncated:true,NextContinuationToken:'next'};
  if(type==='DeleteObjectCommand'){files.delete(input.Key);return {};}
  throw Error('Unexpected operation');
 }};
 const storage=createR2Storage(env,{client});await storage.init();await storage.put(key,Buffer.from('image'));assert.equal(String(await storage.get(key)),'image');assert.equal((await storage.stat(key)).bytes,5);assert.equal((await storage.list()).length,1);await storage.remove(key);await storage.remove(key);assert.equal(files.size,0);assert.ok(!calls.some(c=>c.includes('Create')));
 await assert.rejects(storage.put('../escape',Buffer.from('x')),/Invalid image/);
});
test('R2 total deadline includes stalled body; abort destroys stream and redacts provider error',async()=>{
 const body=new Readable({read(){}});const storage=createR2Storage(env,{timeoutMs:25,client:{send:async()=>({Body:body,ContentType:'image/webp',ContentLength:10})}});
 const start=Date.now();await assert.rejects(storage.get(key),{code:'STORAGE_TIMEOUT'});assert.ok(Date.now()-start<1000);assert.equal(body.destroyed,true);
 const forbidden=createR2Storage(env,{client:{send:async()=>{throw Object.assign(Error('fixture-secret'),{$metadata:{httpStatusCode:403}});}}});
 await assert.rejects(forbidden.get(key),e=>e.code==='STORAGE_FORBIDDEN'&&!e.message.includes('fixture-secret'));
 const controller=new AbortController(),stream=new Readable({read(){}}),cancel=createR2Storage(env,{client:{send:async()=>({Body:stream,ContentType:'image/webp'})}});
 const promise=cancel.get(key,{signal:controller.signal});setTimeout(()=>controller.abort(),10);await assert.rejects(promise,{code:'STORAGE_TIMEOUT'});assert.equal(stream.destroyed,true);
});
test('R2 catches incomplete bodies and wrong metadata; ambiguous PUT is distinct from missing GET',async()=>{
 for(const values of [{ContentLength:8},{ContentType:'text/html'},{Metadata:{sha256:'wrong'}}]){
  const storage=createR2Storage(env,{client:{send:async()=>({Body:Readable.from([Buffer.from('image')]),ContentType:'image/webp',ContentLength:5,...values})}});await assert.rejects(storage.get(key),{code:'STORAGE_UNAVAILABLE'});
 }
 const missing=createR2Storage(env,{client:{send:async()=>{throw {$metadata:{httpStatusCode:404}};}}});await assert.rejects(missing.get(key),{code:'STORAGE_NOT_FOUND'});
 const timeout=createR2Storage(env,{timeoutMs:15,client:{send:()=>new Promise(()=>{})}});await assert.rejects(timeout.put(key,Buffer.from('x')),e=>e.uncertain===true&&e.code==='STORAGE_TIMEOUT');
});
