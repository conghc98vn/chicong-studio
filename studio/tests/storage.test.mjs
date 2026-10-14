import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createStorage,derivedFileSizeLimit} from '../server/storage.mjs';
const env={SUPABASE_URL:'https://test-project.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'fixture-service-key',SUPABASE_BUCKET:'chicong-private'};
test('Cloud Storage keeps bucket private, sends server auth and stores/reads/deletes media',async()=>{const original=globalThis.fetch;const files=new Map();let exists=false;let sawPrivate=false;let authenticated=0;globalThis.fetch=async(url,options={})=>{assert.equal(options.headers.apikey,'fixture-service-key');assert.equal(options.headers.Authorization,'Bearer fixture-service-key');authenticated++;if(url.endsWith('/bucket/chicong-private'))return new Response(exists?JSON.stringify({public:false}):'{}',{status:exists?200:404});if(url.endsWith('/bucket')&&options.method==='POST'){const body=JSON.parse(options.body);sawPrivate=body.public===false;exists=true;return new Response('{}');}if(url.endsWith('/object/chicong-private')&&options.method==='DELETE'){for(const name of JSON.parse(options.body).prefixes)files.delete(name);return new Response('{}');}const name=url.split('/').at(-1);if(options.method==='POST'){files.set(name,options.body);return new Response('{}');}return new Response(files.get(name)||'',{status:files.has(name)?200:404});};try{const storage=createStorage('/unused',env);await storage.init();assert.ok(sawPrivate);const name='a'.repeat(32)+'.webp';await storage.put(name,Buffer.from('fixture-image'));assert.equal(String(await storage.get(name)),'fixture-image');await storage.remove(name);assert.equal(files.size,0);assert.ok(authenticated>=6);await assert.rejects(()=>storage.get('../../etc/passwd'));}finally{globalThis.fetch=original;}});
test('Production Storage refuses a public bucket',async()=>{const original=globalThis.fetch;globalThis.fetch=async()=>new Response(JSON.stringify({public:true}));try{await assert.rejects(()=>createStorage('/unused',env).init(),/must be private/);}finally{globalThis.fetch=original;}});
test('Cloud Storage creates a private bucket for Supabase HTTP 400 NoSuchBucket',async()=>{
 const original=globalThis.fetch;let created=false;let reads=0;
 globalThis.fetch=async(url,options={})=>{
  if(url.endsWith('/bucket')&&options.method==='POST'){
   const body=JSON.parse(options.body);
   assert.equal(body.public,false);assert.deepEqual(body.allowed_mime_types,['image/webp','image/jpeg']);assert.equal(body.file_size_limit,24*1024*1024);assert.equal(body.file_size_limit,derivedFileSizeLimit);
   created=true;return new Response('{}');
  }
  assert.ok(url.endsWith('/bucket/chicong-private'));reads++;
  return created?new Response(JSON.stringify({public:false})):new Response(JSON.stringify({statusCode:'404',code:'NoSuchBucket',error:'Bucket not found',message:'Bucket not found'}),{status:400});
 };
 try{await createStorage('/unused',env).init();assert.ok(created);assert.equal(reads,2);}finally{globalThis.fetch=original;}
});
test('Private cloud bucket adds JPEG and raises the old 8 MiB ceiling while preserving other MIME rules',async()=>{
 const original=globalThis.fetch;let info={public:false,allowed_mime_types:['image/webp','image/png'],file_size_limit:8*1024*1024},updates=0;
 globalThis.fetch=async(url,options={})=>{
  assert.ok(url.endsWith('/bucket/chicong-private'));
  if(options.method==='PUT'){updates++;assert.deepEqual(JSON.parse(options.body),{public:false,allowed_mime_types:['image/webp','image/png','image/jpeg'],file_size_limit:derivedFileSizeLimit});info=JSON.parse(options.body);}
  return new Response(JSON.stringify(info));
 };
 try{const storage=createStorage('/unused',env);await storage.init();await storage.init();assert.equal(updates,1);}finally{globalThis.fetch=original;}
});
test('Existing JPEG bucket raises only a smaller finite ceiling and keeps larger or unlimited limits',async()=>{
 const original=globalThis.fetch;
 try{for(const startingLimit of [8388608,derivedFileSizeLimit,64*1024*1024,null])for(const hasJpeg of [true,false]){
  let info={public:false,allowed_mime_types:hasJpeg?['image/webp','image/jpeg']:['image/webp'],file_size_limit:startingLimit},updates=0;
  const expectedLimit=startingLimit===8388608?derivedFileSizeLimit:startingLimit;
  globalThis.fetch=async(url,options={})=>{
   if(options.method==='PUT'){updates++;const policy=JSON.parse(options.body);assert.equal(policy.file_size_limit,expectedLimit);assert.equal(policy.public,false);assert.deepEqual(policy.allowed_mime_types,['image/webp','image/jpeg']);info=policy;}
   return new Response(JSON.stringify(info));
  };
  const storage=createStorage('/unused',env);await storage.init();await storage.init();assert.equal(updates,!hasJpeg||startingLimit===8388608?1:0);
 }}finally{globalThis.fetch=original;}
});
test('Bucket migration verifies the increased ceiling and fails when only the MIME update persists',async()=>{
 const original=globalThis.fetch;let puts=0;
 globalThis.fetch=async(url,options={})=>{
  if(options.method==='PUT'){puts++;assert.equal(JSON.parse(options.body).file_size_limit,derivedFileSizeLimit);return new Response('{}');}
  return new Response(JSON.stringify({public:false,allowed_mime_types:['image/webp','image/jpeg'],file_size_limit:8388608}));
 };
 try{await assert.rejects(createStorage('/unused',env).init(),/file size limit is too small/);assert.equal(puts,1);}finally{globalThis.fetch=original;}
});
test('JPEG-capable bucket policy is unchanged and rejected updates fail clearly',async()=>{
 const original=globalThis.fetch;
 try{
  for(const allowed_mime_types of [null,['image/*'],['*/*'],['image/webp','image/jpeg']]){
   let reads=0;globalThis.fetch=async(url,options={})=>{reads++;assert.equal(options.method,undefined);return new Response(JSON.stringify({public:false,allowed_mime_types,file_size_limit:null}));};
   await createStorage('/unused',env).init();assert.equal(reads,1);
  }
  globalThis.fetch=async(url,options={})=>options.method==='PUT'?new Response('{}',{status:403}):new Response(JSON.stringify({public:false,allowed_mime_types:['image/webp'],file_size_limit:8388608}));
  await assert.rejects(createStorage('/unused',env).init(),/Cannot enable JPEG downloads.*403/);
  globalThis.fetch=async()=>new Response(JSON.stringify({public:false,allowed_mime_types:['image/webp'],file_size_limit:8388608}));
  await assert.rejects(createStorage('/unused',env).init(),/does not allow JPEG/);
 }finally{globalThis.fetch=original;}
});
test('All storage operations reject invalid filenames before accessing disk or cloud',async()=>{
 const original=globalThis.fetch;let requests=0;globalThis.fetch=async()=>{requests++;throw Error('Unexpected network request');};
 try{for(const storage of [createStorage('/unused',{}),createStorage('/unused',env)])for(const name of ['../outside.webp','a'.repeat(32)+'.jpg','a'.repeat(32)+'-thumb.jpg','a'.repeat(32)+'-download.webp','a'.repeat(32)+'-download.jpg/../other','']){
  await assert.rejects(storage.put(name,Buffer.from('x')),/Invalid image/);await assert.rejects(storage.get(name),/Invalid image/);await assert.rejects(storage.remove(name),/Invalid image/);
 }assert.equal(requests,0);}finally{globalThis.fetch=original;}
});
test('JPEG storage round trip and cancellation work locally and use image/jpeg in cloud',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'download-storage-')),name='a'.repeat(32)+'-download.jpg',bytes=Buffer.from('jpeg-fixture'),original=globalThis.fetch;
 try{
  const local=createStorage(dir,{});await local.put(name,bytes);assert.deepEqual(await local.get(name),bytes);
  await assert.rejects(local.get(name,{signal:AbortSignal.abort()}),{name:'AbortError'});await local.remove(name);await assert.rejects(local.get(name),{code:'ENOENT'});
  const controller=new AbortController();let sawSignal=false;
  globalThis.fetch=async(url,options={})=>{
   if(options.method==='POST'){assert.equal(options.headers['Content-Type'],'image/jpeg');assert.deepEqual(options.body,bytes);return new Response('{}');}
   sawSignal=true;controller.abort();assert.equal(options.signal.aborted,true);options.signal.throwIfAborted();
  };
  const cloud=createStorage('/unused',env);await cloud.put(name,bytes);await assert.rejects(cloud.get(name,{signal:controller.signal}),{name:'AbortError'});assert.equal(sawSignal,true);
 }finally{globalThis.fetch=original;await rm(dir,{recursive:true,force:true});}
});
test('Cloud Storage never creates a bucket for authentication or other HTTP errors',async()=>{
 const original=globalThis.fetch;
 try{for(const status of [400,401,403,500]){
  let requests=0;
  globalThis.fetch=async(url,options={})=>{requests++;assert.notEqual(options.method,'POST');return new Response(JSON.stringify({code:'InvalidJWT'}),{status});};
  await assert.rejects(()=>createStorage('/unused',env).init(),new RegExp(`Cannot verify Storage bucket \\(HTTP ${status}\\)`));assert.equal(requests,1);
 }}finally{globalThis.fetch=original;}
});
